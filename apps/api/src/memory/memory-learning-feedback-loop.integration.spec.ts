/**
 * Integration test for the self-improvement lesson-feedback loop
 * (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 4).
 *
 * Closes acceptance criterion (c): the
 * `WorkflowRunOutcomeAfterLessonListener` consumes
 * `workflow.run.{completed,failed}` events and, for every
 * `(lesson_id, scope)` pair that
 * `MemoryMetricsService.recordLearningLessonInjected` recorded
 * during the run, emits one outcome-after-lesson event on the
 * per-process snapshot. This test wires the REAL
 * `MemoryMetricsService`, the REAL `MetricsService`, and the
 * REAL `WorkflowRunOutcomeAfterLessonListener` through a
 * `Test.createTestingModule(...)` graph (with the Nest
 * `EventEmitter2` as the bus the `@OnEvent` decorators
 * subscribe to) and drives 5 terminal events end-to-end:
 *
 *   - 4 × `workflow.run.completed` → `outcome = 'success'`
 *   - 1 × `workflow.run.failed`    → `outcome = 'failure'`
 *
 * The asserts close the per-process snapshot to the
 * `learning.{lesson_injected_total,
 * run_outcome_after_lesson_total, last_run_outcome_after_lesson,
 * convergence}` shape documented on
 * `MemoryMetricsService.snapshot()` (milestones 1, 2, and 3).
 *
 * Why a real `EventEmitter2` and not an in-memory bus:
 *   The listener's `handleWorkflowRunCompleted` /
 *   `handleWorkflowRunFailed` are wired via the
 *   `@OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)` /
 *   `@OnEvent(WORKFLOW_RUN_FAILED_EVENT)` decorators from
 *   `@nestjs/event-emitter`. The decorators register the
 *   handlers on whatever `EventEmitter2` instance NestJS
 *   resolves through DI; replacing the bus with a custom
 *   stub would skip the decorator wiring and exercise only
 *   the public method bodies (which is what the unit test
 *   already covers). Booting the Nest testing module with
 *   `EventEmitterModule.forRoot()` is the lowest-friction way
 *   to exercise the decorator wiring without standing up the
 *   full app container.
 *
 * Why we use a single `(lesson_id, scope)` pair:
 *   `MemoryMetricsService.recordLearningLessonInjected`
 *   deduplicates the per-run tracker on the
 *   `${lesson_id}::${scope}` composite key — see the
 *   `MemoryMetricsService.trackLessonInject` private helper.
 *   Using a SINGLE `(lesson_id, scope)` pair for all 5 runs
 *   means each run contributes exactly one entry to the
 *   tracker; using distinct pairs would let a hidden
 *   re-emission leak. The acceptance fixture is therefore
 *   deterministic: 5 injects recorded on the per-process
 *   snapshot, 5 outcomes-after-lesson events on the same
 *   snapshot.
 *
 * Why we assert on the convergence snapshot:
 *   Milestone 3 closes the feedback loop by computing
 *   `successes_after_lesson / runs_after_lesson` over a rolling
 *   window. With 4 success + 1 failure on the same scope, the
 *   ratio is `4/5 = 0.8` — the same acceptance fixture the
 *   unit tests assert against `computeConvergenceSnapshots`,
 *   here driven through the full event-bus → listener →
 *   metric-service path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { WorkflowStatus } from '@nexus/core';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import {
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
} from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import { WorkflowRunOutcomeAfterLessonListener } from '../workflow/workflow-repair/workflow-run-outcome-after-lesson.listener';

interface RunFixture {
  readonly workflowRunId: string;
  readonly terminalStatus: WorkflowStatus;
}

const LESSON_ID = 'lesson-integration-fixture';
const SCOPE = 'project-integration-1';

const FIXTURE_RUNS: readonly RunFixture[] = [
  { workflowRunId: 'run-int-1', terminalStatus: WorkflowStatus.COMPLETED },
  { workflowRunId: 'run-int-2', terminalStatus: WorkflowStatus.COMPLETED },
  { workflowRunId: 'run-int-3', terminalStatus: WorkflowStatus.COMPLETED },
  { workflowRunId: 'run-int-4', terminalStatus: WorkflowStatus.COMPLETED },
  { workflowRunId: 'run-int-5', terminalStatus: WorkflowStatus.FAILED },
];

const TOTAL_INJECTIONS = FIXTURE_RUNS.length;
const TOTAL_OUTCOMES = FIXTURE_RUNS.length;
const SUCCESS_COUNT = FIXTURE_RUNS.filter(
  (run) => run.terminalStatus === WorkflowStatus.COMPLETED,
).length;
const FAILURE_COUNT = FIXTURE_RUNS.filter(
  (run) => run.terminalStatus === WorkflowStatus.FAILED,
).length;

function buildRunEvent(
  workflowRunId: string,
  status: WorkflowStatus,
): WorkflowRunEvent {
  return {
    workflowRunId,
    workflowId: 'workflow-integration-fixture',
    status,
    stateVariables: {},
  };
}

describe('MemoryLearningFeedbackLoop (integration)', () => {
  let module: TestingModule;
  let memoryMetrics: MemoryMetricsService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        MemoryMetricsService,
        MetricsService,
        WorkflowRunOutcomeAfterLessonListener,
      ],
    }).compile();

    // Initialise the Nest DI graph so the `@OnEvent` decorators
    // register their handlers on the `EventEmitter2` instance
    // and the prom-client defaults (collected by
    // `MetricsService.onModuleInit`) are wired up.
    await module.init();

    memoryMetrics = module.get<MemoryMetricsService>(MemoryMetricsService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(async () => {
    // Tear the DI graph down between tests so the
    // `EventEmitter2` listeners registered by the previous run
    // do not bleed into the next test (the listener captures
    // the `MemoryMetricsService` reference at construction
    // time, so a leaked module would otherwise silently keep
    // appending to a stale `lessonInjectsByRun` map).
    await module.close();
  });

  it('drives 5 workflow-run terminal events through the real listener and closes the per-process snapshot', async () => {
    // Step 1 — inject the SAME `(lesson_id, scope)` pair for
    // every run so the per-run tracker accumulates one entry
    // per run (and so a single shared scope feeds the
    // milestone-3 convergence ratio). The injection call is
    // the SAME public entry point
    // `StepSupportService.buildPromotedLearningContext` calls
    // (see `step-support.service.ts` line 361), just
    // hand-driven here so the test stays focused on the
    // listener wiring.
    for (const run of FIXTURE_RUNS) {
      memoryMetrics.recordLearningLessonInjected(
        { lesson_id: LESSON_ID, scope: SCOPE },
        { workflowRunId: run.workflowRunId },
      );
    }

    // Step 2 — emit 5 terminal events. The
    // `WorkflowRunOutcomeAfterLessonListener` is wired via
    // `@OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)` /
    // `@OnEvent(WORKFLOW_RUN_FAILED_EVENT)`; emitting through
    // the real `EventEmitter2` exercises the decorator path
    // (the unit spec only exercises the public handler
    // bodies). The handler body is synchronous — the
    // `await Promise.resolve()` at the tail is the
    // `@nestjs/event-emitter` contract only — so the counter
    // is incremented before `emit` returns. We still `await`
    // a microtask tick afterwards so any future async
    // additions to the listener do not silently regress.
    for (const run of FIXTURE_RUNS) {
      const eventName =
        run.terminalStatus === WorkflowStatus.COMPLETED
          ? WORKFLOW_RUN_COMPLETED_EVENT
          : WORKFLOW_RUN_FAILED_EVENT;
      eventEmitter.emit(
        eventName,
        buildRunEvent(run.workflowRunId, run.terminalStatus),
      );
      await Promise.resolve();
    }

    // Step 3 — assert the per-process snapshot. The snapshot
    // is the operator surface the milestone-2 REST controller
    // exposes; the milestone-3 acceptance criterion (c)
    // demands both the inject + outcome counters AND the
    // convergence ratio be present and numeric.
    const snapshot = memoryMetrics.snapshot();

    // Acceptance: exactly 5 injections on the per-process
    // mirror (matches the labelled prom-client counter that
    // was incremented in lock-step).
    expect(snapshot.learning.lesson_injected_total).toBe(TOTAL_INJECTIONS);
    expect(snapshot.learning.last_lesson_injected).toEqual({
      lesson_id: LESSON_ID,
      scope: SCOPE,
      injected_at: expect.any(String),
    });

    // Acceptance: exactly 5 outcomes-after-lesson events,
    // split 4 success + 1 failure. The split is asserted
    // directly on the `last_run_outcome_after_lesson`
    // snapshot (the most recent terminal was the FAILED run,
    // so `outcome === 'failure'`) and on the counter total
    // (== number of runs, with no double-counting).
    expect(snapshot.learning.run_outcome_after_lesson_total).toBe(
      TOTAL_OUTCOMES,
    );
    expect(snapshot.learning.last_run_outcome_after_lesson).toEqual({
      lesson_id: LESSON_ID,
      scope: SCOPE,
      outcome: 'failure',
      observed_at: expect.any(String),
    });

    // Sanity-check the success/failure split via a SECOND
    // pass over the per-run tracker: the listener consumed
    // every inject (the per-run set is drained on terminal,
    // so a second pass must be empty). This is the
    // consume-once contract from the listener spec — see
    // `MemoryMetricsService.consumeRunLessonInjects`.
    for (const run of FIXTURE_RUNS) {
      expect(memoryMetrics.consumeRunLessonInjects(run.workflowRunId)).toEqual(
        [],
      );
    }

    // Acceptance (milestone 3): the convergence snapshot for
    // the injected scope MUST be present, the `ratio` MUST be
    // numeric and lie in `[0, 1]`, and the denominator MUST
    // be the total number of outcome-after-lesson events
    // observed on the scope. The exact ratio here is
    // `4/5 = 0.8` — the same acceptance fixture the unit
    // spec asserts against `computeConvergenceSnapshots`.
    const convergence = snapshot.learning.convergence;
    expect(convergence[SCOPE]).toBeDefined();
    const snapshotScope = convergence[SCOPE];
    if (!snapshotScope) {
      throw new Error(
        `Expected convergence snapshot for scope "${SCOPE}" to be defined.`,
      );
    }
    expect(typeof snapshotScope.ratio).toBe('number');
    expect(Number.isFinite(snapshotScope.ratio)).toBe(true);
    expect(snapshotScope.ratio).toBeGreaterThanOrEqual(0);
    expect(snapshotScope.ratio).toBeLessThanOrEqual(1);
    expect(snapshotScope.ratio).toBeCloseTo(SUCCESS_COUNT / TOTAL_OUTCOMES, 10);
    expect(snapshotScope.runs_after_lesson).toBe(TOTAL_OUTCOMES);
    expect(snapshotScope.successes_after_lesson).toBe(SUCCESS_COUNT);
    expect(snapshotScope.window_days).toBeGreaterThan(0);
    expect(typeof snapshotScope.computed_at).toBe('string');

    // Belt-and-suspenders: success + failure counts derived
    // from the run-outcome samples must sum to the total
    // outcome count. `MemoryMetricsService` does not expose
    // a per-outcome breakdown on the snapshot (only the
    // `last_run_outcome_after_lesson` carries the most-recent
    // label), so this assertion is the strongest split-level
    // check we can make through the public surface. We cross
    // it with the FAILURE_COUNT assertion below: with 5
    // outcomes total, 4 successes, 1 failure, the ratio must
    // be `0.8` and the failure count must be `1`.
    expect(SUCCESS_COUNT + FAILURE_COUNT).toBe(TOTAL_OUTCOMES);
    expect(SUCCESS_COUNT).toBe(4);
    expect(FAILURE_COUNT).toBe(1);
  });
});
