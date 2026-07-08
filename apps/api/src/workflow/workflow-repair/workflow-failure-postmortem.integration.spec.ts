import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryManagerService } from '../../memory/memory-manager.service';
import type { MemorySegmentPostmortemRepository } from '../../memory/database/repositories/memory-segment.postmortem.repository';
import type { MemoryMetricsService } from '../../memory/memory-metrics.service';
import type { MetricsService } from '../../observability/metrics.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { WORKFLOW_RUN_FAILED_EVENT } from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';
import type { WorkflowRepairDispatchService } from './workflow-repair-dispatch.service';
import type { FailureClassificationDecision } from './failure-classification.types';
import type { WorkflowFailureClassificationService } from './workflow-failure-classification.service';
import { WorkflowFailureClassificationListener } from './workflow-failure-classification.listener';
import { WorkflowFailurePostmortemListener } from './workflow-failure-postmortem.listener';
import type { WorkflowPostmortemLearningAggregatorService } from './workflow-failure-postmortem-learning-aggregator.service';
import { PostmortemMemoryBackfiller } from './postmortem-memory-backfiller.service';
import { PostmortemSettingsResolver } from './postmortem-settings-resolver.service';
import { PostmortemWriter } from './postmortem-writer.service';
import {
  WORKFLOW_POSTMORTEM_MEMORY_TYPE,
  WORKFLOW_POSTMORTEM_RECORDED_EVENT,
  WORKFLOW_POSTMORTEM_SOURCE,
} from './workflow-failure-postmortem.constants';

/**
 * Integration test for the workflow-failure postmortem writeback
 * (work item 71cdcd7b-daff-489d-b681-44d239765c99, milestones 1 + 2 + 3 + 4).
 *
 * Drives a workflow run to FAILED through the REAL
 * `WorkflowFailureClassificationListener` (the test does NOT
 * shortcut by calling `postmortemListener.handleWorkflowRunFailed`
 * directly), captures the postmortem write, and asserts:
 *
 *   1. The postmortem was written with the canonical metadata shape
 *      (entity_type='project', entity_id='scope-int-1',
 *      metadata_json.source='workflow_failure_postmortem',
 *      metadata_json.workflow_run_id='run-int-1',
 *      metadata_json.failure_class='dependency_missing', pinned=true)
 *      so the existing `query_memory` tool can locate it via a
 *      `metadata_json ->> 'source' = 'workflow_failure_postmortem'`
 *      filter.
 *
 *   2. The `memory.workflow.postmortem_recorded.v1` event was
 *      emitted with `outcome: 'success'`, `memory_segment_id`,
 *      `workflow_run_id`, `failure_class`.
 *
 *   3. The threshold aggregator was invoked against the same
 *      (scope_id, failure_class) so the milestone-3 wiring is
 *      exercised end-to-end. The aggregator itself is stubbed (a
 *      real call would require a live LearningCandidateRepository
 *      and a downstream sweep workflow) — the integration test
 *      only cares that the postmortem listener routes the call.
 *
 *   4. A second emit with the same `workflow_run_id` is deduplicated
 *      — the second emit MUST NOT call `createMemorySegment`
 *      because the dedup probe (via `findByMetadataKey`) returns the
 *      just-written segment.
 *
 * The listener is constructed with its 3-arg orchestrator ctor
 * `(classification, writer, backfiller)` per milestone 4; the
 * writer internally owns the `PostmortemSettingsResolver` (per
 * the architect plan — the resolver is one of the three sibling
 * services but is consumed via the writer), and the backfiller is
 * a real instance wrapping a stubbed learning aggregator. The
 * writer + backfiller are wired around the same fake
 * collaborators (memoryManager, memorySegmentRepo, memoryMetrics,
 * metrics, eventBus for the writer; learningAggregator for the
 * backfiller) so the end-to-end wiring assertion
 * (createMemorySegment called with the canonical metadata shape,
 * dedup-on-second-emit) is preserved.
 *
 * Mirrors the project's `workflow-repair-delegation.integration.spec.ts`
 * pattern (plain vitest, no `Test.createTestingModule`, in-memory
 * event bus) so the test stays focused on the listener wiring rather
 * than the full Nest container.
 */
describe('workflow failure postmortem integration', () => {
  const decision: FailureClassificationDecision = {
    class: 'dependency_missing',
    confidence: 0.85,
    reason: 'integration-test',
    evidenceReferences: [],
    eligibility: 'allow',
    allowedRepairActionIds: ['rebuild'],
  };

  let eventBus: InMemoryEventBus;
  let createMemorySegment: ReturnType<typeof vi.fn>;
  let findByMetadataKey: ReturnType<typeof vi.fn>;
  let countPostmortemsByFailureClass: ReturnType<typeof vi.fn>;
  let recordPostmortemRecurrence: ReturnType<typeof vi.fn>;
  let classificationClassify: ReturnType<typeof vi.fn>;
  let dispatchIfAllowed: ReturnType<typeof vi.fn>;
  let recordWorkflowPostmortemRecorded: ReturnType<typeof vi.fn>;
  let recordPostmortemRecorded: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    eventBus = new InMemoryEventBus();
    createMemorySegment = vi.fn(async () =>
      buildMemorySegmentStub('segment-int-1'),
    );
    findByMetadataKey = vi.fn().mockImplementation(async () => null);
    countPostmortemsByFailureClass = vi.fn().mockResolvedValue(1);
    recordPostmortemRecurrence = vi.fn(async () => ({
      thresholdCrossed: false,
      reason: 'below-threshold',
      count: 1,
      threshold: 3,
      windowDays: 30,
    }));
    classificationClassify = vi.fn(async () => decision);
    dispatchIfAllowed = vi.fn(async () => false);
    recordWorkflowPostmortemRecorded = vi.fn();
    recordPostmortemRecorded = vi.fn();

    const classification = {
      classifyRunFailure: classificationClassify,
    };
    const repairDispatch = {
      dispatchIfAllowed,
    };

    const memoryManager = {
      createMemorySegment,
    };
    const memorySegmentRepo = {
      findByMetadataKey,
      countPostmortemsByFailureClass,
    };
    const memoryMetrics = {
      recordPostmortemRecorded,
    };
    const metrics = {
      recordWorkflowPostmortemRecorded,
    };
    const settings = {
      get: vi.fn(async (key: string, defaultValue: unknown) => {
        if (key === 'workflow_postmortem_writeback_enabled') {
          return true;
        }
        if (key === 'workflow_postmortem_writeback_delay_seconds') {
          return 0;
        }
        if (key === 'workflow_postmortem_occurrence_threshold') {
          return 3;
        }
        if (key === 'workflow_postmortem_occurrence_window_days') {
          return 30;
        }
        return defaultValue;
      }),
    };
    const learningAggregator = {
      recordPostmortemRecurrence,
    };

    // Real listeners — the spec mandates driving the workflow to
    // FAILED through the EXISTING classification listener so the
    // wiring is exercised end-to-end. The postmortem listener is
    // its milestone-4 orchestrator form (classification + writer +
    // backfiller); the writer internally owns the
    // `PostmortemSettingsResolver` (per the architect plan, the
    // resolver is one of the three sibling services but is
    // consumed via the writer), and the backfiller is a real
    // instance wrapping the same fakes the pre-milestone-4 spec
    // passed in directly.
    const classificationListener = new WorkflowFailureClassificationListener(
      classification as unknown as WorkflowFailureClassificationService,
      repairDispatch as unknown as WorkflowRepairDispatchService,
    );
    const settingsResolver = new PostmortemSettingsResolver(
      settings as unknown as SystemSettingsService,
    );
    const postmortemWriter = new PostmortemWriter(
      memoryManager as unknown as MemoryManagerService,
      memorySegmentRepo as unknown as MemorySegmentPostmortemRepository,
      memoryMetrics as unknown as MemoryMetricsService,
      metrics as unknown as MetricsService,
      eventBus as unknown as EventEmitter2,
      settingsResolver,
    );
    const postmortemBackfiller = new PostmortemMemoryBackfiller(
      learningAggregator as unknown as WorkflowPostmortemLearningAggregatorService,
    );
    const postmortemListener = new WorkflowFailurePostmortemListener(
      classification as unknown as WorkflowFailureClassificationService,
      postmortemWriter,
      postmortemBackfiller,
    );

    eventBus.on(WORKFLOW_RUN_FAILED_EVENT, (event) =>
      classificationListener.handleWorkflowRunFailed(event as never),
    );
    eventBus.on(WORKFLOW_RUN_FAILED_EVENT, (event) =>
      postmortemListener.handleWorkflowRunFailed(event as never),
    );
  });

  it('drives a workflow to FAILED via the classification listener and writes a queryable postmortem', async () => {
    const event = buildWorkflowRunFailedEvent();

    eventBus.emit(WORKFLOW_RUN_FAILED_EVENT, event);
    await eventBus.drain();

    // The classification listener drove the dispatch (best-effort,
    // may not fire because the stub returns false — but the call
    // itself proves the wiring).
    expect(classificationClassify).toHaveBeenCalledWith('run-int-1');
    expect(dispatchIfAllowed).toHaveBeenCalledTimes(1);

    // The postmortem listener wrote a memory segment with the
    // canonical metadata shape. These assertions encode the
    // "queryable via query_memory" contract: the source string
    // matches the workflow_failure_postmortem filter, the
    // workflow_run_id is indexable via findByMetadataKey, and
    // pinned=true keeps the eviction reaper away.
    expect(createMemorySegment).toHaveBeenCalledTimes(1);
    const [entityType, entityId, content, memoryType, metadata] =
      createMemorySegment.mock.calls[0] ?? [];
    expect(entityType).toBe('project');
    expect(entityId).toBe('scope-int-1');
    expect(content).toContain('Source: workflow_failure_postmortem');
    expect(content).toContain('Workflow run: run-int-1');
    expect(content).toContain('Project: scope-int-1');
    expect(content).toContain('Failure class: dependency_missing');
    expect(memoryType).toBe(WORKFLOW_POSTMORTEM_MEMORY_TYPE);
    expect(metadata).toMatchObject({
      source: WORKFLOW_POSTMORTEM_SOURCE,
      pinned: true,
      workflow_run_id: 'run-int-1',
      failure_class: 'dependency_missing',
      confidence: 0.85,
      repair_decision: {
        eligibility: 'allow',
        allowedRepairActionIds: ['rebuild'],
        reason: 'integration-test',
      },
      evidence_summary: expect.stringContaining('workflowId=workflow-int-1'),
    });
    expect(typeof metadata.occurred_at).toBe('string');

    // The recorded event was emitted on both surfaces (raw constant
    // and the autonomy mirror). Subscribers bind to either; the
    // integration test binds to the raw constant for stability.
    //
    // Note: `WORKFLOW_POSTMORTEM_RECORDED_EVENT` and
    // `AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded` resolve to
    // the same event-name string, so the listener's defensive
    // "emit on both surfaces" pattern records the event twice in
    // the in-memory bus. We assert the FIRST emission is correct
    // (rather than asserting an exact count) so the test stays
    // robust against future listener refactors that consolidate
    // the two emit calls into one.
    const recordedEvents = eventBus.emitted(WORKFLOW_POSTMORTEM_RECORDED_EVENT);
    expect(recordedEvents.length).toBeGreaterThanOrEqual(1);
    const recorded = recordedEvents[0] as Record<string, unknown>;
    expect(recorded).toMatchObject({
      workflow_run_id: 'run-int-1',
      scope_id: 'scope-int-1',
      failure_class: 'dependency_missing',
      confidence: 0.85,
      outcome: 'success',
      memory_segment_id: 'segment-int-1',
    });
    expect(typeof recorded.occurred_at).toBe('string');

    // Autonomy mirror emits on the same constant string, so the
    // emitted list mirrors the recorded-event list. We only assert
    // that at least one emission fired (the spec lists both names
    // as surfaces — collapsing them is a listener-side concern).
    const autonomyRecorded = eventBus.emitted(
      AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded,
    );
    expect(autonomyRecorded.length).toBeGreaterThanOrEqual(1);

    // Prometheus + MemoryMetrics counters reflect the success path.
    expect(recordWorkflowPostmortemRecorded).toHaveBeenCalledWith('success');
    expect(recordPostmortemRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'success',
        memory_segment_id: 'segment-int-1',
      }),
    );

    // The recurrence-signal service was invoked against the same
    // (scope_id, failure_class) — it fires on every successful write,
    // recording the recurrence count as a Phase-2 gate signal.
    expect(recordPostmortemRecurrence).toHaveBeenCalledTimes(1);
    const aggregatorCall = recordPostmortemRecurrence.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(aggregatorCall).toMatchObject({
      scopeId: 'scope-int-1',
      failureClass: 'dependency_missing',
      triggeredByWorkflowRunId: 'run-int-1',
    });
    expect(aggregatorCall?.triggeredAt).toBeInstanceOf(Date);
  });

  it('deduplicates a second emit on the same workflow_run_id', async () => {
    // First emit: writes a fresh segment.
    eventBus.emit(WORKFLOW_RUN_FAILED_EVENT, buildWorkflowRunFailedEvent());
    await eventBus.drain();
    expect(createMemorySegment).toHaveBeenCalledTimes(1);

    // Replay the event with the same workflow_run_id. The dedup
    // probe (findByMetadataKey) now returns the just-written row,
    // so the second emit MUST NOT call createMemorySegment again.
    findByMetadataKey.mockResolvedValue(
      buildMemorySegmentStub('segment-int-1'),
    );
    eventBus.emit(WORKFLOW_RUN_FAILED_EVENT, buildWorkflowRunFailedEvent());
    await eventBus.drain();

    expect(createMemorySegment).toHaveBeenCalledTimes(1);

    // The second emit still classified + dispatched, but skipped
    // the memory write because the dedup probe hit. The listener
    // emits the recorded event twice (once per mirror name) — the
    // integration test asserts at least one `duplicate-workflow-run-id`
    // skip event was observed.
    const skippedEvents = eventBus
      .emitted(WORKFLOW_POSTMORTEM_RECORDED_EVENT)
      .filter(
        (event) =>
          (event as { outcome?: string }).outcome === 'skipped' &&
          (event as { reason?: string }).reason === 'duplicate-workflow-run-id',
      );
    expect(skippedEvents.length).toBeGreaterThanOrEqual(1);

    // The recurrence service is only invoked on successful writes, so the
    // dedup emit must NOT call it a second time.
    expect(recordPostmortemRecurrence).toHaveBeenCalledTimes(1);
  });
});

function buildWorkflowRunFailedEvent(): WorkflowRunEvent {
  return {
    workflowRunId: 'run-int-1',
    workflowId: 'workflow-int-1',
    status: WorkflowStatus.FAILED,
    stateVariables: {
      trigger: { scopeId: 'scope-int-1' },
    },
    failedJobId: 'job-int-1',
    errorMessage: 'Cannot find module lodash',
  };
}

function buildMemorySegmentStub(id: string): {
  id: string;
  entity_type: string;
  entity_id: string;
  memory_type: string;
  source: string;
  pinned: boolean;
} {
  return {
    id,
    entity_type: 'project',
    entity_id: 'scope-int-1',
    memory_type: WORKFLOW_POSTMORTEM_MEMORY_TYPE,
    source: WORKFLOW_POSTMORTEM_SOURCE,
    pinned: true,
  };
}

/**
 * Minimal in-memory event bus for the integration test. Mirrors the
 * pattern used in `workflow-repair-delegation.integration.spec.ts`
 * so the test stays plain-vitest (no `Test.createTestingModule`).
 *
 * The bus preserves the event-emit ordering: every `on` handler
 * for the emitted event is called synchronously, and the promises
 * returned by the handlers are awaited by `drain()`. This lets the
 * test assert post-conditions deterministically.
 */
class InMemoryEventBus {
  private readonly handlers = new Map<
    string,
    Array<(event: unknown) => unknown>
  >();
  private readonly events = new Map<string, unknown[]>();
  private pending: Promise<unknown>[] = [];

  on(eventName: string, handler: (event: unknown) => unknown): void {
    this.handlers.set(eventName, [
      ...(this.handlers.get(eventName) ?? []),
      handler,
    ]);
  }

  emit(eventName: string, event: unknown): boolean {
    this.events.set(eventName, [...(this.events.get(eventName) ?? []), event]);

    for (const handler of this.handlers.get(eventName) ?? []) {
      this.pending.push(Promise.resolve(handler(event)));
    }

    return true;
  }

  emitted(eventName: string): unknown[] {
    return this.events.get(eventName) ?? [];
  }

  async drain(): Promise<void> {
    while (this.pending.length > 0) {
      const pending = this.pending;
      this.pending = [];
      await Promise.all(pending);
    }
  }
}
