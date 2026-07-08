import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowFailureClassificationService } from './workflow-failure-classification.service';
import type { FailureClassificationDecision } from './failure-classification.types';
import type { WorkflowRunEvent } from '../workflow-events.types';
import type { MemoryManagerService } from '../../memory/memory-manager.service';
import type { MemorySegmentPostmortemRepository } from '../../memory/database/repositories/memory-segment.postmortem.repository';
import type { MemoryMetricsService } from '../../memory/memory-metrics.service';
import type { MetricsService } from '../../observability/metrics.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import {
  WORKFLOW_POSTMORTEM_MEMORY_TYPE,
  WORKFLOW_POSTMORTEM_RECORDED_EVENT,
  WORKFLOW_POSTMORTEM_SOURCE,
} from './workflow-failure-postmortem.constants';
import { WorkflowFailurePostmortemListener } from './workflow-failure-postmortem.listener';
import { WorkflowPostmortemLearningAggregatorService as RealWorkflowPostmortemLearningAggregatorService } from './workflow-failure-postmortem-learning-aggregator.service';
import type { WorkflowPostmortemLearningAggregatorService } from './workflow-failure-postmortem-learning-aggregator.service';
import { PostmortemMemoryBackfiller } from './postmortem-memory-backfiller.service';
import { PostmortemSettingsResolver } from './postmortem-settings-resolver.service';
import { PostmortemWriter } from './postmortem-writer.service';

const DECISION_DEFAULT: FailureClassificationDecision = {
  class: 'dependency_missing',
  confidence: 0.9,
  reason: 'unit-test',
  evidenceReferences: [],
  eligibility: 'allow',
  allowedRepairActionIds: ['rebuild_dependencies'],
};

function createClassification(
  override: (
    decision: FailureClassificationDecision,
  ) => FailureClassificationDecision = (d) => d,
) {
  return {
    classifyRunFailure: vi
      .fn()
      .mockImplementation(async () => override(DECISION_DEFAULT)),
  };
}

function createSettings(
  options: {
    enabled?: boolean;
    delaySeconds?: number;
    threshold?: number;
    windowDays?: number;
  } = {},
) {
  const enabled = options.enabled ?? true;
  const delaySeconds = options.delaySeconds ?? 0;
  const threshold = options.threshold ?? 3;
  const windowDays = options.windowDays ?? 30;
  return {
    get: vi.fn(async (key: string) => {
      if (key === 'workflow_postmortem_writeback_enabled') {
        return enabled;
      }
      if (key === 'workflow_postmortem_writeback_delay_seconds') {
        return delaySeconds;
      }
      if (key === 'workflow_postmortem_occurrence_threshold') {
        return threshold;
      }
      if (key === 'workflow_postmortem_occurrence_window_days') {
        return windowDays;
      }
      return undefined;
    }),
  };
}

// Alias for the recurrence-signal tests so the meaning of the
// settings object is obvious without needing to read every key.
function createSettingsWithAggregators(options: {
  threshold?: number;
  windowDays?: number;
}) {
  return createSettings(options);
}

function createMemoryManager() {
  return {
    createMemorySegment: vi.fn(async () => ({
      id: 'segment-1',
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

function createMemorySegmentRepo(existing = null) {
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

function createLearningAggregator() {
  return {
    recordPostmortemRecurrence: vi.fn(async () => ({
      thresholdCrossed: false,
      reason: 'below-threshold',
      count: 0,
      threshold: 3,
      windowDays: 30,
    })),
  };
}

/**
 * Build a real {@link PostmortemWriter} wired around the supplied
 * underlying mocks. Exposes both the writer instance AND the
 * underlying mocks so the spec can assert on the listener's
 * external contract (memory write, dedup probe, prom counter,
 * dual-emit) through the same `context.memoryManager`,
 * `context.eventEmitter`, etc. accessors the original
 * 8-arg-ctor spec used.
 */
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
    overrides.settingsResolver ??
    new PostmortemSettingsResolver(
      createSettings() as unknown as SystemSettingsService,
    );

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

/**
 * Build a real {@link PostmortemMemoryBackfiller} wrapping the
 * supplied aggregator mock. Exposes both the backfiller
 * instance AND the aggregator mock so the spec can assert on
 * the listener's external contract (recurrence signal call,
 * failure swallow) through the same `context.backfiller` /
 * `context.learningAggregator` accessors.
 */
function createBackfiller(
  overrides: {
    aggregator?: ReturnType<typeof createLearningAggregator>;
  } = {},
) {
  const aggregator = overrides.aggregator ?? createLearningAggregator();
  const backfiller = new PostmortemMemoryBackfiller(
    aggregator as unknown as WorkflowPostmortemLearningAggregatorService,
  );
  return { backfiller, aggregator };
}

function createListener(
  overrides: {
    classification?: ReturnType<typeof createClassification>;
    settings?: ReturnType<typeof createSettings>;
    memoryManager?: ReturnType<typeof createMemoryManager>;
    memorySegmentRepo?: ReturnType<typeof createMemorySegmentRepo>;
    memoryMetrics?: ReturnType<typeof createMemoryMetrics>;
    metrics?: ReturnType<typeof createMetrics>;
    eventEmitter?: ReturnType<typeof createEventEmitter>;
    writer?: ReturnType<typeof createWriter>['writer'];
    learningAggregator?: ReturnType<typeof createLearningAggregator>;
    backfiller?: PostmortemMemoryBackfiller;
  } = {},
) {
  const classification = overrides.classification ?? createClassification();
  const settings = overrides.settings ?? createSettings();

  const memoryManager = overrides.memoryManager ?? createMemoryManager();
  const memorySegmentRepo =
    overrides.memorySegmentRepo ?? createMemorySegmentRepo();
  const memoryMetrics = overrides.memoryMetrics ?? createMemoryMetrics();
  const metrics = overrides.metrics ?? createMetrics();
  const eventEmitter = overrides.eventEmitter ?? createEventEmitter();

  const writer =
    overrides.writer ??
    new PostmortemWriter(
      memoryManager as unknown as MemoryManagerService,
      memorySegmentRepo as unknown as MemorySegmentPostmortemRepository,
      memoryMetrics as unknown as MemoryMetricsService,
      metrics as unknown as MetricsService,
      eventEmitter as unknown as EventEmitter2,
      new PostmortemSettingsResolver(
        settings as unknown as SystemSettingsService,
      ),
    );

  const learningAggregator =
    overrides.learningAggregator ?? createLearningAggregator();
  const backfiller =
    overrides.backfiller ??
    new PostmortemMemoryBackfiller(
      learningAggregator as unknown as WorkflowPostmortemLearningAggregatorService,
    );

  const listener = new WorkflowFailurePostmortemListener(
    classification as unknown as WorkflowFailureClassificationService,
    writer,
    backfiller,
  );

  return {
    listener,
    classification,
    settings,
    writer,
    memoryManager,
    memorySegmentRepo,
    memoryMetrics,
    metrics,
    eventEmitter,
    backfiller,
    learningAggregator,
  };
}

function failedEvent(
  workflowRunId: string,
  stateVariables: Record<string, unknown> = {
    trigger: { scopeId: 'scope-1' },
  },
): WorkflowRunEvent {
  return {
    workflowRunId,
    workflowId: 'workflow-1',
    status: WorkflowStatus.FAILED,
    stateVariables,
  };
}

function findRecordedEventEmit(
  eventEmitter: ReturnType<typeof createEventEmitter>,
) {
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

describe('WorkflowFailurePostmortemListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('writes a postmortem memory segment for a FAILED run when enabled', async () => {
    const context = createListener();

    await context.listener.handleWorkflowRunFailed(failedEvent('run-1'));

    expect(context.classification.classifyRunFailure).toHaveBeenCalledWith(
      'run-1',
    );
    expect(context.memoryManager.createMemorySegment).toHaveBeenCalledTimes(1);
    const call = context.memoryManager.createMemorySegment.mock.calls[0];
    expect(call).toBeDefined();
    const [entityType, entityId, content, memoryType, metadata] = call ?? [];
    expect(entityType).toBe('project');
    expect(entityId).toBe('scope-1');
    expect(content).toContain('Source: workflow_failure_postmortem');
    expect(content).toContain('Workflow run: run-1');
    expect(content).toContain('Project: scope-1');
    expect(content).toContain('Failure class: dependency_missing');
    expect(memoryType).toBe(WORKFLOW_POSTMORTEM_MEMORY_TYPE);
    expect(metadata).toMatchObject({
      source: WORKFLOW_POSTMORTEM_SOURCE,
      pinned: true,
      workflow_run_id: 'run-1',
      failure_class: 'dependency_missing',
      confidence: 0.9,
      occurred_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ),
      repair_decision: {
        eligibility: 'allow',
        allowedRepairActionIds: ['rebuild_dependencies'],
        reason: 'unit-test',
      },
    });

    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).toHaveBeenCalledWith('success');
    expect(context.memoryMetrics.recordPostmortemRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'success',
        memory_segment_id: 'segment-1',
      }),
    );

    const recorded = findRecordedEventEmit(context.eventEmitter);
    expect(recorded).toBeDefined();
    expect(recorded?.outcome).toBe('success');
    expect(recorded?.memory_segment_id).toBe('segment-1');
    expect(recorded?.workflow_run_id).toBe('run-1');
    expect(recorded?.scope_id).toBe('scope-1');
    expect(recorded?.failure_class).toBe('dependency_missing');
  });

  it('skips when the event status is not FAILED (defensive CANCELLED handling)', async () => {
    const context = createListener();

    await context.listener.handleWorkflowRunFailed({
      workflowRunId: 'run-cancelled',
      workflowId: 'workflow-1',
      status: WorkflowStatus.CANCELLED,
      stateVariables: { trigger: { scopeId: 'scope-1' } },
    });

    expect(context.classification.classifyRunFailure).not.toHaveBeenCalled();
    expect(context.memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).not.toHaveBeenCalled();
  });

  it('skips when a postmortem already exists for the workflow_run_id', async () => {
    const context = createListener({
      memorySegmentRepo: createMemorySegmentRepo({ id: 'existing-segment' }),
    });

    await context.listener.handleWorkflowRunFailed(failedEvent('run-dup'));

    expect(context.memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).toHaveBeenCalledWith('skipped');
    expect(context.memoryMetrics.recordPostmortemRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'skipped',
        reason: 'duplicate-workflow-run-id',
      }),
    );
    const recorded = findRecordedEventEmit(context.eventEmitter);
    expect(recorded?.outcome).toBe('skipped');
    expect(recorded?.reason).toBe('duplicate-workflow-run-id');
  });

  it('skips when scope_id cannot be resolved from the event payload', async () => {
    const context = createListener();

    await context.listener.handleWorkflowRunFailed(
      failedEvent('run-no-scope', {}),
    );

    expect(context.classification.classifyRunFailure).not.toHaveBeenCalled();
    expect(context.memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).toHaveBeenCalledWith('skipped');
    expect(context.memoryMetrics.recordPostmortemRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'skipped',
        reason: 'scope-resolution-failed',
      }),
    );
    const recorded = findRecordedEventEmit(context.eventEmitter);
    expect(recorded?.outcome).toBe('skipped');
    expect(recorded?.reason).toBe('scope-resolution-failed');
  });

  it('skips when the constructed payload fails isWorkflowPostmortemPayload validation', async () => {
    const context = createListener({
      classification: createClassification(() => ({
        class:
          'definitely-not-a-valid-class' as unknown as FailureClassificationDecision['class'],
        confidence: Number.NaN,
        reason: 'unit-test',
        evidenceReferences: [],
        eligibility: 'allow',
        allowedRepairActionIds: ['rebuild_dependencies'],
      })),
    });

    await context.listener.handleWorkflowRunFailed(failedEvent('run-bad'));

    expect(context.memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).toHaveBeenCalledWith('failed');
    expect(context.memoryMetrics.recordPostmortemRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        reason: 'payload-validation-failed',
      }),
    );
    const recorded = findRecordedEventEmit(context.eventEmitter);
    expect(recorded?.outcome).toBe('failed');
    expect(recorded?.reason).toBe('payload-validation-failed');
  });

  it('skips when the kill switch is disabled', async () => {
    const context = createListener({
      settings: createSettings({ enabled: false }),
    });

    await context.listener.handleWorkflowRunFailed(failedEvent('run-disabled'));

    expect(context.classification.classifyRunFailure).not.toHaveBeenCalled();
    expect(context.memorySegmentRepo.findByMetadataKey).not.toHaveBeenCalled();
    expect(context.memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).toHaveBeenCalledWith('skipped');
    expect(context.memoryMetrics.recordPostmortemRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'skipped',
        reason: 'disabled',
      }),
    );
    const recorded = findRecordedEventEmit(context.eventEmitter);
    expect(recorded?.outcome).toBe('skipped');
    expect(recorded?.reason).toBe('disabled');
  });

  it('records a failed outcome when the memory write throws', async () => {
    const memoryManager = createMemoryManager();
    memoryManager.createMemorySegment.mockRejectedValueOnce(
      new Error('backend rejected the write'),
    );
    const context = createListener({ memoryManager });

    await expect(
      context.listener.handleWorkflowRunFailed(failedEvent('run-write-fail')),
    ).resolves.toBeUndefined();
    expect(context.memoryManager.createMemorySegment).toHaveBeenCalledTimes(1);
    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).toHaveBeenCalledWith('failed');
    expect(context.memoryMetrics.recordPostmortemRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        reason: 'backend rejected the write',
      }),
    );
    const recorded = findRecordedEventEmit(context.eventEmitter);
    expect(recorded?.outcome).toBe('failed');
    expect(recorded?.reason).toBe('backend rejected the write');
  });

  it('awaits the configured delay before writing the postmortem', async () => {
    vi.useFakeTimers();
    try {
      const context = createListener({
        settings: createSettings({ delaySeconds: 1 }),
      });
      const promise = context.listener.handleWorkflowRunFailed(
        failedEvent('run-delay'),
      );

      // Drain pending microtasks so the postmortem code path
      // reaches the `await sleep(...)` line BEFORE the timer
      // advances. createMemorySegment must not have been called yet.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(context.memoryManager.createMemorySegment).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      await promise;

      expect(context.memoryManager.createMemorySegment).toHaveBeenCalledTimes(
        1,
      );
      expect(
        context.metrics.recordWorkflowPostmortemRecorded,
      ).toHaveBeenCalledWith('success');
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips when stateVariables is missing entirely (undefined)', async () => {
    const context = createListener();

    await context.listener.handleWorkflowRunFailed({
      workflowRunId: 'run-no-state',
      workflowId: 'workflow-1',
      status: WorkflowStatus.FAILED,
      // Defensive: some upstream publishers may hand us an event
      // without a stateVariables field at all. The handler must
      // not throw.
      stateVariables: undefined as unknown as Record<string, unknown>,
    });

    expect(context.classification.classifyRunFailure).not.toHaveBeenCalled();
    expect(context.memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).toHaveBeenCalledWith('skipped');
    const recorded = findRecordedEventEmit(context.eventEmitter);
    expect(recorded?.outcome).toBe('skipped');
    expect(recorded?.reason).toBe('scope-resolution-failed');
  });

  it('resolves scope_id from the snake_case fallback when the camelCase key is missing', async () => {
    const context = createListener();

    await context.listener.handleWorkflowRunFailed(
      failedEvent('run-snake', {
        trigger: { scope_id: 'scope-from-snake' },
      }),
    );

    expect(context.memoryManager.createMemorySegment).toHaveBeenCalledTimes(1);
    const call = context.memoryManager.createMemorySegment.mock.calls[0];
    expect(call?.[1]).toBe('scope-from-snake');
  });

  it('records a failed outcome when the classification service throws', async () => {
    const classification = createClassification();
    classification.classifyRunFailure.mockRejectedValueOnce(
      new Error('classifier offline'),
    );
    const context = createListener({ classification });

    await expect(
      context.listener.handleWorkflowRunFailed(
        failedEvent('run-classify-fail'),
      ),
    ).resolves.toBeUndefined();
    expect(context.memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).toHaveBeenCalledWith('failed');
    expect(context.memoryMetrics.recordPostmortemRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        reason: expect.stringContaining('classifier offline'),
      }),
    );
  });

  it('records the postmortem recurrence after a successful write (below threshold)', async () => {
    const countPostmortems = vi.fn().mockResolvedValue(2);
    const settings = createSettingsWithAggregators({
      threshold: 3,
      windowDays: 30,
    });
    const memorySegmentRepo = createMemorySegmentRepo();
    memorySegmentRepo.countPostmortemsByFailureClass = countPostmortems;

    const realAggregator = new RealWorkflowPostmortemLearningAggregatorService(
      memorySegmentRepo as unknown as MemorySegmentPostmortemRepository,
      settings as unknown as SystemSettingsService,
    );

    // Spy that delegates to the real recurrence service. The
    // listener sees a plain `{ recordRecurrence }` shape on the
    // backfiller; the spy records every call so we can assert
    // on the args + count.
    const realBackfiller = new PostmortemMemoryBackfiller(realAggregator);
    const recordRecurrence = vi.spyOn(realBackfiller, 'recordRecurrence');

    const context = createListener({
      memorySegmentRepo,
      settings,
      backfiller: realBackfiller,
    });

    await context.listener.handleWorkflowRunFailed(failedEvent('run-below'));

    expect(recordRecurrence).toHaveBeenCalledTimes(1);
    const recurrenceCall = recordRecurrence.mock.calls[0]?.[0];
    expect(recurrenceCall).toMatchObject({
      scopeId: 'scope-1',
      failureClass: 'dependency_missing',
      triggeredByWorkflowRunId: 'run-below',
    });
    expect(recurrenceCall.triggeredAt).toBeInstanceOf(Date);

    // The recurrence count was read with the right (scope, class, since) shape.
    expect(countPostmortems).toHaveBeenCalledTimes(1);
    const [entityType, entityId, failureClass, sinceIso] =
      countPostmortems.mock.calls[0] ?? [];
    expect(entityType).toBe('project');
    expect(entityId).toBe('scope-1');
    expect(failureClass).toBe('dependency_missing');
    expect(typeof sinceIso).toBe('string');
    // sinceIso must be in the past relative to triggeredAt (windowDays=30).
    expect(new Date(sinceIso as string).getTime()).toBeLessThanOrEqual(
      recurrenceCall.triggeredAt.getTime(),
    );

    const result = await recordRecurrence.mock.results[0]?.value;
    expect(result).toMatchObject({ thresholdCrossed: false });
  });

  it('reports a threshold crossing when the recurrence count meets the threshold', async () => {
    const countPostmortems = vi.fn().mockResolvedValue(3);
    const settings = createSettingsWithAggregators({
      threshold: 3,
      windowDays: 30,
    });
    const memorySegmentRepo = createMemorySegmentRepo();
    memorySegmentRepo.countPostmortemsByFailureClass = countPostmortems;

    const realAggregator = new RealWorkflowPostmortemLearningAggregatorService(
      memorySegmentRepo as unknown as MemorySegmentPostmortemRepository,
      settings as unknown as SystemSettingsService,
    );

    const realBackfiller = new PostmortemMemoryBackfiller(realAggregator);
    const recordRecurrence = vi.spyOn(realBackfiller, 'recordRecurrence');

    const context = createListener({
      memorySegmentRepo,
      settings,
      backfiller: realBackfiller,
    });

    await context.listener.handleWorkflowRunFailed(failedEvent('run-at'));

    expect(countPostmortems).toHaveBeenCalledTimes(1);
    expect(recordRecurrence).toHaveBeenCalledTimes(1);

    const result = await recordRecurrence.mock.results[0]?.value;
    expect(result).toEqual({
      thresholdCrossed: true,
      count: 3,
      threshold: 3,
      windowDays: 30,
    });
    // The listener still records the postmortem write as a success.
    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).toHaveBeenCalledWith('success');
  });

  it('keeps the success-path recording intact when the recurrence service throws', async () => {
    const learningAggregator = {
      recordPostmortemRecurrence: vi.fn(async () => {
        throw new Error('recurrence offline');
      }),
    };
    const context = createListener({ learningAggregator });

    await expect(
      context.listener.handleWorkflowRunFailed(failedEvent('run-agg-throw')),
    ).resolves.toBeUndefined();

    // Listener still recorded the postmortem as success (the
    // backfiller's catch-all absorbs the aggregator's throw so
    // the success-path counters / event surface stay intact).
    expect(context.memoryManager.createMemorySegment).toHaveBeenCalledTimes(1);
    expect(
      context.metrics.recordWorkflowPostmortemRecorded,
    ).toHaveBeenCalledWith('success');
    expect(context.memoryMetrics.recordPostmortemRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'success',
        memory_segment_id: 'segment-1',
      }),
    );
    const recorded = findRecordedEventEmit(context.eventEmitter);
    expect(recorded?.outcome).toBe('success');
    expect(recorded?.memory_segment_id).toBe('segment-1');
    expect(recorded?.workflow_run_id).toBe('run-agg-throw');
    expect(recorded?.failure_class).toBe('dependency_missing');

    // The recurrence service was called once and its throw was
    // swallowed by the backfiller's catch-all (no unhandled
    // rejection, no error propagates out of the handler).
    expect(learningAggregator.recordPostmortemRecurrence).toHaveBeenCalledTimes(
      1,
    );
  });
});
