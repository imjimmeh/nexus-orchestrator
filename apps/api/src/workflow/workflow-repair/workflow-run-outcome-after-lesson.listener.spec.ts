import { Logger } from '@nestjs/common';
import { WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryMetricsService } from '../../memory/memory-metrics.service';
import type { MetricsService } from '../../observability/metrics.service';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { WorkflowRunOutcomeAfterLessonListener } from './workflow-run-outcome-after-lesson.listener';

function createMemoryMetrics(): {
  service: Pick<
    MemoryMetricsService,
    | 'consumeRunLessonInjects'
    | 'recordWorkflowRunOutcomeAfterLesson'
    | 'recordLearningBehaviourChange'
  >;
  consumeRunLessonInjects: ReturnType<typeof vi.fn>;
  recordWorkflowRunOutcomeAfterLesson: ReturnType<typeof vi.fn>;
  recordLearningBehaviourChange: ReturnType<typeof vi.fn>;
} {
  const consumeRunLessonInjects = vi.fn(() => []);
  const recordWorkflowRunOutcomeAfterLesson = vi.fn(() => undefined);
  const recordLearningBehaviourChange = vi.fn(() => undefined);
  return {
    service: {
      consumeRunLessonInjects,
      recordWorkflowRunOutcomeAfterLesson,
      recordLearningBehaviourChange,
    },
    consumeRunLessonInjects,
    recordWorkflowRunOutcomeAfterLesson,
    recordLearningBehaviourChange,
  };
}

function createMetrics(): {
  service: Pick<
    MetricsService,
    'recordLearningRunOutcomeAfterLesson' | 'recordLearningBehaviourChange'
  >;
  recordLearningRunOutcomeAfterLesson: ReturnType<typeof vi.fn>;
  recordLearningBehaviourChange: ReturnType<typeof vi.fn>;
} {
  const recordLearningRunOutcomeAfterLesson = vi.fn(() => undefined);
  const recordLearningBehaviourChange = vi.fn(() => undefined);
  return {
    service: {
      recordLearningRunOutcomeAfterLesson,
      recordLearningBehaviourChange,
    },
    recordLearningRunOutcomeAfterLesson,
    recordLearningBehaviourChange,
  };
}

function createListener(
  memoryMetrics: ReturnType<typeof createMemoryMetrics> = createMemoryMetrics(),
  metrics: ReturnType<typeof createMetrics> = createMetrics(),
  options: {
    settings?: { get: ReturnType<typeof vi.fn> };
    eventLedger?: { query: ReturnType<typeof vi.fn> };
  } = {},
): {
  listener: WorkflowRunOutcomeAfterLessonListener;
  memoryMetrics: ReturnType<typeof createMemoryMetrics>;
  metrics: ReturnType<typeof createMetrics>;
} {
  const listener = new WorkflowRunOutcomeAfterLessonListener(
    memoryMetrics.service as unknown as MemoryMetricsService,
    metrics.service as unknown as MetricsService,
    options.settings as never,
    options.eventLedger as never,
  );
  return { listener, memoryMetrics, metrics };
}

function toolRow(toolName: string, payload: Record<string, unknown>) {
  return { tool_name: toolName, payload };
}

function completedEvent(workflowRunId: string): WorkflowRunEvent {
  return {
    workflowRunId,
    workflowId: 'workflow-1',
    status: WorkflowStatus.COMPLETED,
    stateVariables: {},
  };
}

function failedEvent(workflowRunId: string): WorkflowRunEvent {
  return {
    workflowRunId,
    workflowId: 'workflow-1',
    status: WorkflowStatus.FAILED,
    stateVariables: {},
  };
}

describe('WorkflowRunOutcomeAfterLessonListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('records one outcome-after-lesson event per injected lesson on COMPLETED', async () => {
    const memoryMetrics = createMemoryMetrics();
    const metrics = createMetrics();
    memoryMetrics.consumeRunLessonInjects.mockReturnValueOnce([
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { lesson_id: 'lesson-2', scope: 'project-1' },
    ]);
    const { listener } = createListener(memoryMetrics, metrics);

    await listener.handleWorkflowRunCompleted(completedEvent('run-1'));

    expect(memoryMetrics.consumeRunLessonInjects).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.consumeRunLessonInjects).toHaveBeenCalledWith('run-1');
    expect(metrics.recordLearningRunOutcomeAfterLesson).toHaveBeenCalledTimes(
      2,
    );
    expect(metrics.recordLearningRunOutcomeAfterLesson).toHaveBeenNthCalledWith(
      1,
      'lesson-1',
      'project-1',
      'success',
    );
    expect(metrics.recordLearningRunOutcomeAfterLesson).toHaveBeenNthCalledWith(
      2,
      'lesson-2',
      'project-1',
      'success',
    );
    expect(
      memoryMetrics.recordWorkflowRunOutcomeAfterLesson,
    ).toHaveBeenCalledTimes(2);
    expect(
      memoryMetrics.recordWorkflowRunOutcomeAfterLesson,
    ).toHaveBeenNthCalledWith(1, {
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });
    expect(
      memoryMetrics.recordWorkflowRunOutcomeAfterLesson,
    ).toHaveBeenNthCalledWith(2, {
      lesson_id: 'lesson-2',
      scope: 'project-1',
      outcome: 'success',
    });
  });

  it('records the outcome as "failure" on FAILED', async () => {
    const memoryMetrics = createMemoryMetrics();
    const metrics = createMetrics();
    memoryMetrics.consumeRunLessonInjects.mockReturnValueOnce([
      { lesson_id: 'lesson-1', scope: 'project-1' },
    ]);
    const { listener } = createListener(memoryMetrics, metrics);

    await listener.handleWorkflowRunFailed(failedEvent('run-2'));

    expect(metrics.recordLearningRunOutcomeAfterLesson).toHaveBeenCalledWith(
      'lesson-1',
      'project-1',
      'failure',
    );
    expect(
      memoryMetrics.recordWorkflowRunOutcomeAfterLesson,
    ).toHaveBeenCalledWith({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'failure',
    });
  });

  it('does NOT increment the counter when the run had no injected lessons', async () => {
    const memoryMetrics = createMemoryMetrics();
    const metrics = createMetrics();
    // Default `consumeRunLessonInjects` returns [].
    const { listener } = createListener(memoryMetrics, metrics);

    await listener.handleWorkflowRunCompleted(completedEvent('run-empty'));

    expect(memoryMetrics.consumeRunLessonInjects).toHaveBeenCalledWith(
      'run-empty',
    );
    expect(metrics.recordLearningRunOutcomeAfterLesson).not.toHaveBeenCalled();
    expect(
      memoryMetrics.recordWorkflowRunOutcomeAfterLesson,
    ).not.toHaveBeenCalled();
  });

  it('does NOT double-count when a duplicate terminal event arrives for the same run', async () => {
    const memoryMetrics = createMemoryMetrics();
    const metrics = createMetrics();
    // The first consume drains the set; the second consume
    // (for the duplicate event) sees an empty array because
    // `MemoryMetricsService.consumeRunLessonInjects` is
    // consume-once. We simulate that contract by returning
    // the pair on the first call and [] on the second.
    memoryMetrics.consumeRunLessonInjects
      .mockReturnValueOnce([{ lesson_id: 'lesson-1', scope: 'project-1' }])
      .mockReturnValueOnce([]);
    const { listener } = createListener(memoryMetrics, metrics);

    // First terminal event — drains the set, records the outcome.
    await listener.handleWorkflowRunCompleted(completedEvent('run-1'));
    // Duplicate terminal event (publisher retry, race between
    // COMPLETED and FAILED observers) — second consume is
    // empty, the counter MUST NOT be incremented again.
    await listener.handleWorkflowRunCompleted(completedEvent('run-1'));

    expect(metrics.recordLearningRunOutcomeAfterLesson).toHaveBeenCalledTimes(
      1,
    );
    expect(
      memoryMetrics.recordWorkflowRunOutcomeAfterLesson,
    ).toHaveBeenCalledTimes(1);
  });

  it('does NOT record anything when the event status does not match the handler (defensive)', async () => {
    // The COMPLETED handler must short-circuit when the
    // event payload's status is FAILED (the publisher could
    // in principle publish a mismatched status on the same
    // event name in the future).
    const memoryMetrics = createMemoryMetrics();
    const metrics = createMetrics();
    const { listener } = createListener(memoryMetrics, metrics);

    await listener.handleWorkflowRunCompleted({
      workflowRunId: 'run-mismatch',
      workflowId: 'workflow-1',
      status: WorkflowStatus.FAILED,
      stateVariables: {},
    });

    expect(memoryMetrics.consumeRunLessonInjects).not.toHaveBeenCalled();
    expect(metrics.recordLearningRunOutcomeAfterLesson).not.toHaveBeenCalled();
    expect(
      memoryMetrics.recordWorkflowRunOutcomeAfterLesson,
    ).not.toHaveBeenCalled();
  });

  it('does NOT record anything when the event status is CANCELLED on the COMPLETED handler', async () => {
    // CANCELLED is intentionally excluded from the counter:
    // it is not a meaningful convergence signal for an
    // injected lesson. The COMPLETED handler must skip it
    // early (and must NOT consume the per-run set, so the
    // FAILED handler — if it fires next — can still see the
    // injected lessons).
    const memoryMetrics = createMemoryMetrics();
    const metrics = createMetrics();
    const { listener } = createListener(memoryMetrics, metrics);

    await listener.handleWorkflowRunCompleted({
      workflowRunId: 'run-cancelled',
      workflowId: 'workflow-1',
      status: WorkflowStatus.CANCELLED,
      stateVariables: {},
    });

    expect(memoryMetrics.consumeRunLessonInjects).not.toHaveBeenCalled();
    expect(metrics.recordLearningRunOutcomeAfterLesson).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by consumeRunLessonInjects so the event bus is not crashed', async () => {
    const memoryMetrics = createMemoryMetrics();
    const metrics = createMetrics();
    memoryMetrics.consumeRunLessonInjects.mockImplementationOnce(() => {
      throw new Error('tracker exploded');
    });
    const { listener } = createListener(memoryMetrics, metrics);

    // MUST NOT throw out of the handler.
    await expect(
      listener.handleWorkflowRunCompleted(completedEvent('run-3')),
    ).resolves.toBeUndefined();

    expect(metrics.recordLearningRunOutcomeAfterLesson).not.toHaveBeenCalled();
    expect(
      memoryMetrics.recordWorkflowRunOutcomeAfterLesson,
    ).not.toHaveBeenCalled();
    // The error was logged at warn.
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  describe('behaviour-change pass (EPIC-212 Phase 3 Task 6)', () => {
    function enabledSettings() {
      return {
        get: vi.fn(async (_key: string, fallback: unknown) => fallback),
      };
    }

    it('records changed=true when the anchored tool was invoked post-injection', async () => {
      const memoryMetrics = createMemoryMetrics();
      const metrics = createMetrics();
      memoryMetrics.consumeRunLessonInjects.mockReturnValueOnce([
        {
          lesson_id: 'lesson-1',
          scope: 'project-1',
          anchored_tool: 'run_command',
        },
      ]);
      const eventLedger = {
        query: vi.fn(async () => [
          [toolRow('run_command', { command: 'npm test' })],
          1,
        ]),
      };
      const { listener } = createListener(memoryMetrics, metrics, {
        settings: enabledSettings(),
        eventLedger,
      });

      await listener.handleWorkflowRunCompleted(completedEvent('run-bc-1'));

      expect(eventLedger.query).toHaveBeenCalledWith({
        workflow_run_id: 'run-bc-1',
        domain: 'tool',
        limit: 1000,
      });
      expect(metrics.recordLearningBehaviourChange).toHaveBeenCalledWith(
        'project-1',
        true,
      );
      expect(memoryMetrics.recordLearningBehaviourChange).toHaveBeenCalledWith({
        lesson_id: 'lesson-1',
        scope: 'project-1',
        changed: true,
      });
    });

    it('records changed=false when the anchored tool was NOT invoked', async () => {
      const memoryMetrics = createMemoryMetrics();
      const metrics = createMetrics();
      memoryMetrics.consumeRunLessonInjects.mockReturnValueOnce([
        {
          lesson_id: 'lesson-1',
          scope: 'project-1',
          anchored_path: 'src/decay.ts',
        },
      ]);
      const eventLedger = {
        query: vi.fn(async () => [
          [toolRow('read_file', { path: 'src/other.ts' })],
          1,
        ]),
      };
      const { listener } = createListener(memoryMetrics, metrics, {
        settings: enabledSettings(),
        eventLedger,
      });

      await listener.handleWorkflowRunCompleted(completedEvent('run-bc-2'));

      expect(metrics.recordLearningBehaviourChange).toHaveBeenCalledWith(
        'project-1',
        false,
      );
    });

    it('does NOT count a lesson with no anchor', async () => {
      const memoryMetrics = createMemoryMetrics();
      const metrics = createMetrics();
      memoryMetrics.consumeRunLessonInjects.mockReturnValueOnce([
        { lesson_id: 'lesson-1', scope: 'project-1' },
      ]);
      const eventLedger = { query: vi.fn(async () => [[], 0]) };
      const { listener } = createListener(memoryMetrics, metrics, {
        settings: enabledSettings(),
        eventLedger,
      });

      await listener.handleWorkflowRunCompleted(completedEvent('run-bc-3'));

      expect(eventLedger.query).not.toHaveBeenCalled();
      expect(metrics.recordLearningBehaviourChange).not.toHaveBeenCalled();
    });

    it('does nothing when the behaviour-change gate is off', async () => {
      const memoryMetrics = createMemoryMetrics();
      const metrics = createMetrics();
      memoryMetrics.consumeRunLessonInjects.mockReturnValueOnce([
        {
          lesson_id: 'lesson-1',
          scope: 'project-1',
          anchored_tool: 'run_command',
        },
      ]);
      const eventLedger = { query: vi.fn(async () => [[], 0]) };
      const settings = {
        get: vi.fn(async (key: string) =>
          key === 'learning_behaviour_change_enabled' ? false : undefined,
        ),
      };
      const { listener } = createListener(memoryMetrics, metrics, {
        settings,
        eventLedger,
      });

      await listener.handleWorkflowRunCompleted(completedEvent('run-bc-4'));

      expect(eventLedger.query).not.toHaveBeenCalled();
      expect(metrics.recordLearningBehaviourChange).not.toHaveBeenCalled();
    });

    it('fails soft (no counting) when the event ledger is not wired', async () => {
      const memoryMetrics = createMemoryMetrics();
      const metrics = createMetrics();
      memoryMetrics.consumeRunLessonInjects.mockReturnValueOnce([
        {
          lesson_id: 'lesson-1',
          scope: 'project-1',
          anchored_tool: 'run_command',
        },
      ]);
      const { listener } = createListener(memoryMetrics, metrics, {
        settings: enabledSettings(),
        // no eventLedger
      });

      await expect(
        listener.handleWorkflowRunCompleted(completedEvent('run-bc-5')),
      ).resolves.toBeUndefined();
      expect(metrics.recordLearningBehaviourChange).not.toHaveBeenCalled();
    });
  });

  it('preserves order of injected pairs when emitting the counter', async () => {
    // `MemoryMetricsService.consumeRunLessonInjects` returns
    // a `Set<>`-drained array — order is insertion order.
    // The handler must preserve that order so the per-pair
    // counter increments match the inject order (operator
    // surface uses the count + last-write snapshot only,
    // but preserving order keeps the prom-client scrape
    // timestamps aligned with the inject order).
    const memoryMetrics = createMemoryMetrics();
    const metrics = createMetrics();
    memoryMetrics.consumeRunLessonInjects.mockReturnValueOnce([
      { lesson_id: 'lesson-3', scope: 'project-1' },
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { lesson_id: 'lesson-2', scope: 'project-2' },
    ]);
    const { listener } = createListener(memoryMetrics, metrics);

    await listener.handleWorkflowRunCompleted(completedEvent('run-order'));

    expect(
      metrics.recordLearningRunOutcomeAfterLesson.mock.calls.map(
        (call) => call[0],
      ),
    ).toEqual(['lesson-3', 'lesson-1', 'lesson-2']);
  });
});
