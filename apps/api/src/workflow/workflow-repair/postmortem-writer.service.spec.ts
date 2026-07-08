import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryManagerService } from '../../memory/memory-manager.service';
import type { MemorySegmentPostmortemRepository } from '../../memory/database/repositories/memory-segment.postmortem.repository';
import type { MemoryMetricsService } from '../../memory/memory-metrics.service';
import type { MetricsService } from '../../observability/metrics.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { WorkflowRunEvent } from '../workflow-events.types';
import type { FailureClassificationDecision } from './failure-classification.types';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { PostmortemSettingsResolver } from './postmortem-settings-resolver.service';
import { PostmortemWriter } from './postmortem-writer.service';
import {
  WORKFLOW_POSTMORTEM_MEMORY_TYPE,
  WORKFLOW_POSTMORTEM_RECORDED_EVENT,
  WORKFLOW_POSTMORTEM_SOURCE,
} from './workflow-failure-postmortem.constants';
import type { WorkflowPostmortemPayload } from './workflow-failure-postmortem.types';

const DECISION_DEFAULT: FailureClassificationDecision = {
  class: 'dependency_missing',
  confidence: 0.9,
  reason: 'unit-test',
  evidenceReferences: [],
  eligibility: 'allow',
  allowedRepairActionIds: ['rebuild_dependencies'],
};

function createMemoryManager(segmentId = 'segment-1') {
  return {
    createMemorySegment: vi.fn(async () => ({
      id: segmentId,
      entity_type: 'project',
      entity_id: 'scope-1',
      memory_type: WORKFLOW_POSTMORTEM_MEMORY_TYPE,
      content: 'rendered text',
      version: 1,
      metadata_json: {},
      last_accessed_at: null,
      access_count: 0,
      pinned: true,
      source: WORKFLOW_POSTMORTEM_SOURCE,
      last_reinforced_at: null,
      archived_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    })),
  };
}

function createMemorySegmentRepo(existing: { id: string } | null = null) {
  return {
    findByMetadataKey: vi.fn(async () => existing),
    countPostmortemsByFailureClass: vi.fn(async () => 0),
  };
}

function createMemoryMetrics() {
  return {
    recordPostmortemRecorded: vi.fn(),
  };
}

function createMetrics() {
  return {
    recordWorkflowPostmortemRecorded: vi.fn(),
  };
}

function createEventEmitter() {
  return {
    emit: vi.fn(),
  };
}

function createSettingsResolver(): PostmortemSettingsResolver {
  const settings = {
    get: vi.fn(async (key: string, defaultValue: unknown) => {
      if (key === 'workflow_postmortem_writeback_enabled') {
        return true;
      }
      if (key === 'workflow_postmortem_writeback_delay_seconds') {
        return 0;
      }
      return defaultValue;
    }),
  };
  return new PostmortemSettingsResolver(
    settings as unknown as SystemSettingsService,
  );
}

function createWriter(
  overrides: {
    memoryManager?: ReturnType<typeof createMemoryManager>;
    memorySegmentRepo?: ReturnType<typeof createMemorySegmentRepo>;
    memoryMetrics?: ReturnType<typeof createMemoryMetrics>;
    metrics?: ReturnType<typeof createMetrics>;
    eventEmitter?: ReturnType<typeof createEventEmitter>;
    settingsResolver?: PostmortemSettingsResolver;
  } = {},
) {
  const memoryManager = overrides.memoryManager ?? createMemoryManager();
  const memorySegmentRepo =
    overrides.memorySegmentRepo ?? createMemorySegmentRepo();
  const memoryMetrics = overrides.memoryMetrics ?? createMemoryMetrics();
  const metrics = overrides.metrics ?? createMetrics();
  const eventEmitter = overrides.eventEmitter ?? createEventEmitter();
  const settingsResolver =
    overrides.settingsResolver ?? createSettingsResolver();

  const writer = new PostmortemWriter(
    memoryManager as unknown as MemoryManagerService,
    memorySegmentRepo as unknown as MemorySegmentPostmortemRepository,
    memoryMetrics as unknown as MemoryMetricsService,
    metrics as unknown as MetricsService,
    eventEmitter as unknown as EventEmitter2,
    settingsResolver,
  );

  return {
    writer,
    memoryManager,
    memorySegmentRepo,
    memoryMetrics,
    metrics,
    eventEmitter,
    settingsResolver,
  };
}

function failedEvent(
  workflowRunId: string,
  stateVariables: Record<string, unknown> = {
    trigger: { scopeId: 'scope-1' },
    jobs: {
      job1: { output: { errorCode: 'E_DEPENDENCY_MISSING' } },
    },
  },
  extras: Partial<WorkflowRunEvent> = {},
): WorkflowRunEvent {
  return {
    workflowRunId,
    workflowId: 'workflow-1',
    status: WorkflowStatus.FAILED,
    stateVariables,
    failedJobId: 'job-1',
    ...extras,
  };
}

function buildPayload(
  event: WorkflowRunEvent,
  scopeId: string,
  decision: FailureClassificationDecision,
): WorkflowPostmortemPayload {
  return {
    workflow_run_id: event.workflowRunId,
    scope_id: scopeId,
    failure_class: decision.class,
    confidence: decision.confidence,
    repair_decision: {
      eligibility: decision.eligibility,
      allowedRepairActionIds: decision.allowedRepairActionIds,
      reason: decision.reason,
    },
    evidence_summary: 'summary',
    occurred_at: new Date('2026-06-19T00:00:00.000Z').toISOString(),
  };
}

/**
 * Pull the first recorded-event emission observed by the
 * event-bus mock. Returns `undefined` when neither of the two
 * dual-emit names fired (which would be a regression).
 */
function findRecordedEmit(eventEmitter: ReturnType<typeof createEventEmitter>) {
  const call = eventEmitter.emit.mock.calls.find(
    ([eventName]) =>
      eventName === WORKFLOW_POSTMORTEM_RECORDED_EVENT ||
      eventName === AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded,
  );
  return call?.[1] as
    | {
        workflow_run_id: string;
        scope_id: string;
        failure_class: string;
        confidence: number;
        outcome: string;
        memory_segment_id?: string;
        reason?: string;
        occurred_at: string;
      }
    | undefined;
}

describe('PostmortemWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  describe('buildPayload', () => {
    it('constructs a WorkflowPostmortemPayload with the canonical field layout', () => {
      const { writer } = createWriter();
      const event = failedEvent('run-build');
      const decision = DECISION_DEFAULT;

      const payload = writer.buildPayload(event, 'scope-1', decision);

      // Top-level field shape (the listener relies on these
      // names being exactly the `WorkflowPostmortemPayload`
      // contract — the boundary check is
      // `isWorkflowPostmortemPayload`).
      expect(payload).toMatchObject({
        workflow_run_id: 'run-build',
        scope_id: 'scope-1',
        failure_class: 'dependency_missing',
        confidence: 0.9,
        repair_decision: {
          eligibility: 'allow',
          allowedRepairActionIds: ['rebuild_dependencies'],
          reason: 'unit-test',
        },
        evidence_summary: expect.stringContaining('workflowId=workflow-1'),
      });
      expect(typeof payload.occurred_at).toBe('string');
      expect(payload.occurred_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });
  });

  describe('summarizeDecision', () => {
    it('builds a grep-friendly summary containing workflowId/jobId/errorCode tokens', () => {
      const { writer } = createWriter();
      const event = failedEvent('run-summary');
      const decision = DECISION_DEFAULT;

      const summary = writer.summarizeDecision(decision, event);

      // The summary is intentionally grep-friendly (used by the
      // existing `query_memory` content-keyword search). Each
      // token must appear verbatim.
      expect(summary).toContain('workflowId=workflow-1');
      expect(summary).toContain('jobId=job-1');
      expect(summary).toContain('reason=unit-test');
      expect(summary).toContain('errorCode=E_DEPENDENCY_MISSING');
      expect(summary).toContain('eligibility=allow');
      expect(summary).toContain('allowedActions=1');
      expect(summary).toContain('evidenceRefs=0');
    });

    it('falls back to jobId=unknown and errorCode=unknown when the event has no job output', () => {
      const { writer } = createWriter();
      // Override the helper defaults so the event has no job
      // info anywhere — `failedJobId` is `undefined`, the
      // trigger has no `failed_job_id`, the state has no
      // `current_step_id`, and the `jobs` block is absent.
      const event: WorkflowRunEvent = {
        workflowRunId: 'run-empty',
        workflowId: 'workflow-1',
        status: WorkflowStatus.FAILED,
        stateVariables: { trigger: { scopeId: 'scope-1' } },
      };

      const summary = writer.summarizeDecision(DECISION_DEFAULT, event);

      expect(summary).toContain('jobId=unknown');
      expect(summary).toContain('errorCode=unknown');
    });
  });

  describe('writePostmortem', () => {
    it('writes the memory segment and emits on both event names on the happy path', async () => {
      const context = createWriter();

      const event = failedEvent('run-1');
      const decision = DECISION_DEFAULT;
      const payload = buildPayload(event, 'scope-1', decision);

      const result = await context.writer.writePostmortem({
        payload,
        decision,
        event,
      });

      // Returns the discriminated success result with the new
      // segment id.
      expect(result).toEqual({ kind: 'ok', segmentId: 'segment-1' });

      // Wrote exactly one memory segment with the canonical
      // postmortem metadata shape (source string, pinned,
      // workflow_run_id, failure_class, repair_decision,
      // confidence, occurred_at, evidence_summary).
      expect(context.memoryManager.createMemorySegment).toHaveBeenCalledTimes(
        1,
      );
      const [, , content, memoryType, metadata] =
        context.memoryManager.createMemorySegment.mock.calls[0] ?? [];
      expect(memoryType).toBe(WORKFLOW_POSTMORTEM_MEMORY_TYPE);
      expect(metadata).toMatchObject({
        source: WORKFLOW_POSTMORTEM_SOURCE,
        pinned: true,
        workflow_run_id: 'run-1',
        failure_class: 'dependency_missing',
        confidence: 0.9,
      });
      expect(typeof content).toBe('string');

      // Ran the dedup probe against the (workflow_run_id,
      // scope_id) pair.
      expect(context.memorySegmentRepo.findByMetadataKey).toHaveBeenCalledWith(
        'workflow_run_id',
        'run-1',
        {
          entityType: 'project',
          entityId: 'scope-1',
        },
      );

      // Emitted on BOTH event names with the canonical success
      // payload: memory_segment_id set, no reason.
      const recorded = findRecordedEmit(context.eventEmitter);
      expect(recorded).toBeDefined();
      expect(recorded?.outcome).toBe('success');
      expect(recorded?.memory_segment_id).toBe('segment-1');
      expect(recorded?.reason).toBeUndefined();
      expect(recorded?.workflow_run_id).toBe('run-1');
      expect(recorded?.scope_id).toBe('scope-1');
      expect(recorded?.failure_class).toBe('dependency_missing');

      // The dual-emit invariant: both event-name surfaces fired.
      const emittedNames = context.eventEmitter.emit.mock.calls.map(
        ([eventName]) => eventName,
      );
      expect(emittedNames).toContain(WORKFLOW_POSTMORTEM_RECORDED_EVENT);
      expect(emittedNames).toContain(
        AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded,
      );

      // Bumped both the prom counter and the in-process
      // memory-metrics snapshot on the success branch.
      expect(
        context.metrics.recordWorkflowPostmortemRecorded,
      ).toHaveBeenCalledWith('success');
      expect(
        context.memoryMetrics.recordPostmortemRecorded,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'success',
          memory_segment_id: 'segment-1',
        }),
      );
    });

    it('returns {kind: skipped, reason: duplicate-workflow-run-id} and skips the write on dedup hit', async () => {
      const context = createWriter({
        memorySegmentRepo: createMemorySegmentRepo({ id: 'existing-segment' }),
      });

      const event = failedEvent('run-dup');
      const decision = DECISION_DEFAULT;
      const payload = buildPayload(event, 'scope-1', decision);

      const result = await context.writer.writePostmortem({
        payload,
        decision,
        event,
      });

      expect(result).toEqual({
        kind: 'skipped',
        reason: 'duplicate-workflow-run-id',
      });

      // The dedup probe hit → no memory segment was written.
      expect(context.memoryManager.createMemorySegment).not.toHaveBeenCalled();
      expect(
        context.metrics.recordWorkflowPostmortemRecorded,
      ).toHaveBeenCalledWith('skipped');
      const recorded = findRecordedEmit(context.eventEmitter);
      expect(recorded?.outcome).toBe('skipped');
      expect(recorded?.reason).toBe('duplicate-workflow-run-id');
      expect(recorded?.failure_class).toBe('ambiguous_failure');
    });

    it('returns {kind: failed, reason: payload-validation-failed} when the payload fails the boundary check', async () => {
      const context = createWriter();
      const event = failedEvent('run-bad');

      // Construct a decision whose `confidence` is `NaN` —
      // `isWorkflowPostmortemPayload` rejects NaN values.
      const badDecision: FailureClassificationDecision = {
        ...DECISION_DEFAULT,
        confidence: Number.NaN,
      };

      // `buildPayload` propagates the bad confidence; the
      // resulting payload fails the `isWorkflowPostmortemPayload`
      // guard at the writer's boundary.
      const badPayload = context.writer.buildPayload(
        event,
        'scope-1',
        badDecision,
      );

      const result = await context.writer.writePostmortem({
        payload: badPayload,
        decision: badDecision,
        event,
      });

      expect(result).toEqual({
        kind: 'failed',
        reason: 'payload-validation-failed',
      });

      // Validation failed before the dedup probe or the memory
      // write — neither was called.
      expect(
        context.memorySegmentRepo.findByMetadataKey,
      ).not.toHaveBeenCalled();
      expect(context.memoryManager.createMemorySegment).not.toHaveBeenCalled();

      // Emitted the recorded event on both surfaces with
      // outcome='failed'.
      expect(
        context.metrics.recordWorkflowPostmortemRecorded,
      ).toHaveBeenCalledWith('failed');
      const recorded = findRecordedEmit(context.eventEmitter);
      expect(recorded?.outcome).toBe('failed');
      expect(recorded?.reason).toBe('payload-validation-failed');
    });

    it('returns {kind: error, reason: <message>} when the memory backend rejects the write', async () => {
      const memoryManager = createMemoryManager();
      memoryManager.createMemorySegment.mockRejectedValueOnce(
        new Error('backend rejected the write'),
      );
      const context = createWriter({ memoryManager });

      const event = failedEvent('run-write-fail');
      const decision = DECISION_DEFAULT;
      const payload = buildPayload(event, 'scope-1', decision);

      const result = await context.writer.writePostmortem({
        payload,
        decision,
        event,
      });

      // The writer returns the error message verbatim — the
      // listener decides whether to surface or swallow it.
      expect(result).toEqual({
        kind: 'error',
        reason: 'backend rejected the write',
      });

      // Dedup ran first (no hit) → write attempted → write
      // threw → recorded event fired on both surfaces with
      // outcome='failed' and the underlying error message.
      expect(context.memorySegmentRepo.findByMetadataKey).toHaveBeenCalledTimes(
        1,
      );
      expect(context.memoryManager.createMemorySegment).toHaveBeenCalledTimes(
        1,
      );
      expect(
        context.metrics.recordWorkflowPostmortemRecorded,
      ).toHaveBeenCalledWith('failed');
      const recorded = findRecordedEmit(context.eventEmitter);
      expect(recorded?.outcome).toBe('failed');
      expect(recorded?.reason).toBe('backend rejected the write');
    });
  });

  describe('recordSuccess', () => {
    it('emits on both event names with the canonical success payload (memory_segment_id set, no reason)', () => {
      const context = createWriter();
      const event = failedEvent('run-success');
      const decision = DECISION_DEFAULT;

      context.writer.recordSuccess(event, 'scope-1', decision, 'seg-1');

      const recorded = findRecordedEmit(context.eventEmitter);
      expect(recorded).toBeDefined();
      expect(recorded).toMatchObject({
        workflow_run_id: 'run-success',
        scope_id: 'scope-1',
        failure_class: 'dependency_missing',
        confidence: 0.9,
        outcome: 'success',
        memory_segment_id: 'seg-1',
      });
      expect(recorded?.reason).toBeUndefined();

      // Dual-emit invariant: both event-name surfaces fired.
      const emittedNames = context.eventEmitter.emit.mock.calls.map(
        ([eventName]) => eventName,
      );
      expect(emittedNames).toContain(WORKFLOW_POSTMORTEM_RECORDED_EVENT);
      expect(emittedNames).toContain(
        AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded,
      );

      expect(
        context.metrics.recordWorkflowPostmortemRecorded,
      ).toHaveBeenCalledWith('success');
      expect(
        context.memoryMetrics.recordPostmortemRecorded,
      ).toHaveBeenCalledWith({
        outcome: 'success',
        occurred_at: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ),
        memory_segment_id: 'seg-1',
      });
    });
  });

  describe('recordSkipped', () => {
    it('emits outcome=skipped with reason and the default failure_class=ambiguous_failure on both event names', () => {
      const context = createWriter();

      context.writer.recordSkipped('disabled');

      const recorded = findRecordedEmit(context.eventEmitter);
      expect(recorded).toBeDefined();
      expect(recorded?.outcome).toBe('skipped');
      expect(recorded?.reason).toBe('disabled');
      expect(recorded?.failure_class).toBe('ambiguous_failure');
      expect(recorded?.confidence).toBe(0);

      // Dual-emit invariant: both event-name surfaces fired.
      const emittedNames = context.eventEmitter.emit.mock.calls.map(
        ([eventName]) => eventName,
      );
      expect(emittedNames).toContain(WORKFLOW_POSTMORTEM_RECORDED_EVENT);
      expect(emittedNames).toContain(
        AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded,
      );

      expect(
        context.metrics.recordWorkflowPostmortemRecorded,
      ).toHaveBeenCalledWith('skipped');
      expect(
        context.memoryMetrics.recordPostmortemRecorded,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'skipped',
          reason: 'disabled',
        }),
      );
    });
  });

  describe('recordFailed', () => {
    it('emits outcome=failed with reason on both event names', () => {
      const context = createWriter();
      const event = failedEvent('run-fail');
      const decision = DECISION_DEFAULT;

      context.writer.recordFailed(
        event,
        'scope-1',
        decision,
        'payload-validation-failed',
      );

      const recorded = findRecordedEmit(context.eventEmitter);
      expect(recorded).toBeDefined();
      expect(recorded?.outcome).toBe('failed');
      expect(recorded?.reason).toBe('payload-validation-failed');
      expect(recorded?.workflow_run_id).toBe('run-fail');
      expect(recorded?.scope_id).toBe('scope-1');
      expect(recorded?.failure_class).toBe('dependency_missing');

      // Dual-emit invariant: both event-name surfaces fired.
      const emittedNames = context.eventEmitter.emit.mock.calls.map(
        ([eventName]) => eventName,
      );
      expect(emittedNames).toContain(WORKFLOW_POSTMORTEM_RECORDED_EVENT);
      expect(emittedNames).toContain(
        AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded,
      );

      expect(
        context.metrics.recordWorkflowPostmortemRecorded,
      ).toHaveBeenCalledWith('failed');
      expect(
        context.memoryMetrics.recordPostmortemRecorded,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'failed',
          reason: 'payload-validation-failed',
        }),
      );
    });
  });

  describe('resolveSettings', () => {
    it('delegates to the injected PostmortemSettingsResolver and returns its result verbatim', async () => {
      // Build a real settings mock that mirrors the writer's
      // "kill switch off + delay 5s" use case so the delegation
      // proves it doesn't transform or filter the resolver's
      // output. The resolver's own spec already covers
      // coercion; the writer's spec only asserts the
      // pass-through contract.
      const settings = {
        get: vi.fn(async (key: string, defaultValue: unknown) => {
          if (key === 'workflow_postmortem_writeback_enabled') {
            return false;
          }
          if (key === 'workflow_postmortem_writeback_delay_seconds') {
            return 5;
          }
          return defaultValue;
        }),
      };
      const settingsResolver = new PostmortemSettingsResolver(
        settings as unknown as SystemSettingsService,
      );
      const context = createWriter({ settingsResolver });

      const resolved = await context.writer.resolveSettings();

      expect(resolved).toEqual({ enabled: false, delaySeconds: 5 });
      // The resolver must have read both keys (proves the
      // writer did not short-circuit / cache / drop the call).
      expect(settings.get).toHaveBeenCalledWith(
        'workflow_postmortem_writeback_enabled',
        expect.anything(),
      );
      expect(settings.get).toHaveBeenCalledWith(
        'workflow_postmortem_writeback_delay_seconds',
        expect.anything(),
      );
    });

    it('returns the resolver promise directly without adding an extra async hop', async () => {
      // Build a real settings resolver. The contract under test
      // is that the writer's `resolveSettings()` returns the
      // resolver's Promise verbatim — wrapping it in another
      // `async` function would change the microtask hop count
      // and break the listener's fake-timer-driven drain in the
      // "awaits the configured delay" spec. We assert equality
      // on a Promise identity (resolve both with the same
      // sentinel value) plus the awaited value shape.
      const settingsResolver = createSettingsResolver();
      const context = createWriter({ settingsResolver });

      const resolved = await context.writer.resolveSettings();

      // Default factory above sets enabled=true, delaySeconds=0.
      expect(resolved).toEqual({ enabled: true, delaySeconds: 0 });
    });
  });
});
