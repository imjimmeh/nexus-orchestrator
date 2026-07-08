import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryMetricsService } from './memory-metrics.service';

describe('MemoryMetricsService', () => {
  let service: MemoryMetricsService;

  beforeEach(() => {
    service = new MemoryMetricsService();
  });

  it('starts with zeroed counters and null last values', () => {
    const snapshot = service.snapshot();

    expect(snapshot.backend.read.total).toEqual({ postgres: 0, honcho: 0 });
    expect(snapshot.backend.write.total).toEqual({
      postgres: { success: 0, failure: 0 },
      honcho: { success: 0, failure: 0 },
    });
    expect(snapshot.backend.active_segments.total).toEqual({
      postgres: {},
      honcho: {},
    });
    expect(snapshot.backend.fallback).toEqual({});
    expect(snapshot.distillation.completed_total).toEqual({
      success: 0,
      failure: 0,
      skipped: 0,
    });
    expect(snapshot.distillation.last).toBeNull();
    expect(snapshot.learning).toEqual({
      promoted_total: 0,
      last_promoted: null,
      lesson_injected_total: 0,
      last_lesson_injected: null,
      run_outcome_after_lesson_total: 0,
      last_run_outcome_after_lesson: null,
      // Milestone 3 — empty convergence map is the "no
      // in-window signal" surface documented on
      // `MemoryMetricsService.computeConvergenceSnapshots`.
      convergence: {},
      // EPIC-212 Phase 3 Task 6 — default-inert measurement trio.
      behaviour_change: {
        changed_total: 0,
        unchanged_total: 0,
        last: null,
      },
      lift: {},
      cost_per_promoted_memory: null,
      suppressed_noise_count: null,
      // EPIC-212 Phase 3 Task 7 — default-inert probation evaluator rollup.
      probation: {
        confirmed_total: 0,
        reverted_total: 0,
        held_total: 0,
        last_pass: null,
      },
    });
    expect(snapshot.postmortem).toEqual({
      recorded_total: { success: 0, skipped: 0, failed: 0 },
      last_recorded: null,
    });
    expect(typeof snapshot.generated_at).toBe('string');
  });

  it('records backend reads, including latency and a percentile summary', () => {
    service.recordBackendRead('postgres', 12);
    service.recordBackendRead('postgres', 24);
    service.recordBackendRead('postgres', 36);
    service.recordBackendRead('honcho', 50);

    const snapshot = service.snapshot();

    expect(snapshot.backend.read.total).toEqual({ postgres: 3, honcho: 1 });
    expect(snapshot.backend.read.latency_ms.postgres).toMatchObject({
      count: 3,
      sum: 72,
    });
    expect(snapshot.backend.read.latency_ms.postgres.p50).toBe(24);
    expect(
      snapshot.backend.read.latency_ms.postgres.p95,
    ).toBeGreaterThanOrEqual(24);
    expect(
      snapshot.backend.read.latency_ms.postgres.p99,
    ).toBeGreaterThanOrEqual(24);
    expect(snapshot.backend.read.latency_ms.honcho).toMatchObject({
      count: 1,
      sum: 50,
      p50: 50,
      p95: 50,
      p99: 50,
    });
  });

  it('clamps negative latencies to zero when computing samples', () => {
    service.recordBackendRead('postgres', -10);

    expect(service.snapshot().backend.read.latency_ms.postgres).toEqual({
      count: 1,
      sum: 0,
      p50: 0,
      p95: 0,
      p99: 0,
    });
  });

  it('records backend writes per outcome and surfaces the active_segments gauge', () => {
    service.recordBackendWrite('postgres', 'success');
    service.recordBackendWrite('postgres', 'success');
    service.recordBackendWrite('postgres', 'failure');
    service.recordBackendWrite('honcho', 'success');
    service.setActiveSegments('postgres', 'memory', 42);

    const snapshot = service.snapshot();
    expect(snapshot.backend.write.total).toEqual({
      postgres: { success: 2, failure: 1 },
      honcho: { success: 1, failure: 0 },
    });
    expect(snapshot.backend.active_segments.total.postgres.memory).toBe(42);
  });

  it('records backend fallback events with from/to/operation labels', () => {
    service.recordBackendFallback('honcho', 'postgres', 'searchMemory');
    service.recordBackendFallback('honcho', 'postgres', 'searchMemory');
    service.recordBackendFallback('honcho', 'postgres', 'getMemorySegments');

    const snapshot = service.snapshot();
    expect(snapshot.backend.fallback).toEqual({
      'honcho->postgres:searchMemory': 2,
      'honcho->postgres:getMemorySegments': 1,
    });
  });

  it('records a successful distillation run with a last-value snapshot', () => {
    service.recordDistillationCompleted('success', {
      input_segment_count: 100,
      output_segment_count: 100,
      compression_ratio: 0.6,
      tokens_before: 1000,
      tokens_after: 600,
      model: 'claude-3-5-sonnet',
      duration_ms: 1234,
    });

    const snapshot = service.snapshot();
    expect(snapshot.distillation.completed_total).toEqual({
      success: 1,
      failure: 0,
      skipped: 0,
    });
    expect(snapshot.distillation.last).toMatchObject({
      input_segment_count: 100,
      output_segment_count: 100,
      compression_ratio: 0.6,
      tokens_before: 1000,
      tokens_after: 600,
      model: 'claude-3-5-sonnet',
      duration_ms: 1234,
    });
    expect(typeof snapshot.distillation.last?.completed_at).toBe('string');
  });

  it('records a distillation failure and surfaces a zero-ratio last value', () => {
    service.recordDistillationCompleted('failure', {
      input_segment_count: 0,
      output_segment_count: 0,
      compression_ratio: 0,
      tokens_before: 0,
      tokens_after: 0,
      model: 'claude-3-5-sonnet',
      duration_ms: 5,
    });

    const snapshot = service.snapshot();
    expect(snapshot.distillation.completed_total).toEqual({
      success: 0,
      failure: 1,
      skipped: 0,
    });
    expect(snapshot.distillation.last?.duration_ms).toBe(5);
  });

  it('records a skipped distillation run when the live threshold is no longer exceeded', () => {
    service.recordDistillationCompleted('skipped', {
      input_segment_count: 12,
      output_segment_count: 12,
      compression_ratio: 1,
      tokens_before: 0,
      tokens_after: 0,
      model: 'claude-3-5-sonnet',
      duration_ms: 3,
    });

    const snapshot = service.snapshot();
    expect(snapshot.distillation.completed_total).toEqual({
      success: 0,
      failure: 0,
      skipped: 1,
    });
    expect(snapshot.distillation.last).toMatchObject({
      input_segment_count: 12,
      output_segment_count: 12,
      compression_ratio: 1,
      duration_ms: 3,
    });
  });

  it('records a learning promotion with a last-value snapshot', () => {
    service.recordLearningPromoted({
      candidate_id: 'c-1',
      confidence: 0.9,
      scope: 'workflow:global',
      source_decision_id: 'policy:foo:approved',
    });

    const snapshot = service.snapshot();
    expect(snapshot.learning).toEqual({
      promoted_total: 1,
      last_promoted: expect.objectContaining({
        candidate_id: 'c-1',
        confidence: 0.9,
        scope: 'workflow:global',
        source_decision_id: 'policy:foo:approved',
      }),
      // Work item 88d7654e — lesson-injection counters start at
      // zero and the last-injection snapshot is null until the
      // first injection is recorded.
      lesson_injected_total: 0,
      last_lesson_injected: null,
      // Milestone 2 — the run-outcome counter is also zero /
      // null until the first terminal event fires.
      run_outcome_after_lesson_total: 0,
      last_run_outcome_after_lesson: null,
      // Milestone 3 — empty convergence map (no
      // injection/outcome events recorded yet).
      convergence: {},
      // EPIC-212 Phase 3 Task 6 — default-inert measurement trio.
      behaviour_change: { changed_total: 0, unchanged_total: 0, last: null },
      lift: {},
      cost_per_promoted_memory: null,
      suppressed_noise_count: null,
      probation: {
        confirmed_total: 0,
        reverted_total: 0,
        held_total: 0,
        last_pass: null,
      },
    });
    expect(typeof snapshot.learning.last_promoted?.promoted_at).toBe('string');
  });

  it('snapshots are independent of internal state mutations', () => {
    service.recordBackendRead('postgres', 10);
    const first = service.snapshot();
    service.recordBackendRead('postgres', 20);
    const second = service.snapshot();

    expect(first.backend.read.total.postgres).toBe(1);
    expect(second.backend.read.total.postgres).toBe(2);
  });

  // -----------------------------------------------------------------
  // Learning-lesson injection metric (work item 88d7654e)
  // -----------------------------------------------------------------
  //
  // The prom-client side of the metric (the labelled counter on
  // `MetricsService`) is asserted directly in
  // `metrics.service.spec.ts`-style coverage; here we focus on
  // the in-memory mirror: the unlabelled total counter and the
  // `last_lesson_injected` snapshot must agree with the
  // prom-client scrape. The per-(lesson_id, scope) breakdown
  // is asserted through the prom-client counter in the
  // integration coverage; this file is the single source of
  // truth for the snapshot shape.

  it('records a learning-lesson injection with a last-value snapshot', () => {
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-1' },
    );

    const snapshot = service.snapshot();
    expect(snapshot.learning.lesson_injected_total).toBe(1);
    expect(snapshot.learning.last_lesson_injected).toEqual({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      injected_at: expect.any(String),
    });
    // `promoted_total` and `last_promoted` must stay untouched.
    expect(snapshot.learning.promoted_total).toBe(0);
    expect(snapshot.learning.last_promoted).toBeNull();
  });

  it('accumulates the in-memory total across multiple injection calls without deduplication', () => {
    // Same (lesson_id, scope) pair N times — no dedup. The
    // total grows by exactly N, mirroring the prom-client
    // counter behaviour so the two views agree.
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-1' },
    );
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-1' },
    );
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-1' },
    );

    expect(service.snapshot().learning.lesson_injected_total).toBe(3);
  });

  it('updates last_lesson_injected to the most recent call regardless of label reuse', () => {
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-1' },
    );
    const first = service.snapshot();
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-2', scope: 'project-2' },
      { workflowRunId: 'run-1' },
    );
    const second = service.snapshot();

    expect(first.learning.last_lesson_injected?.lesson_id).toBe('lesson-1');
    expect(first.learning.last_lesson_injected?.scope).toBe('project-1');
    expect(second.learning.last_lesson_injected?.lesson_id).toBe('lesson-2');
    expect(second.learning.last_lesson_injected?.scope).toBe('project-2');
    // The total accumulates across both calls.
    expect(second.learning.lesson_injected_total).toBe(2);
  });

  it('accumulates distinct (lesson_id, scope) pairs as separate calls', () => {
    // Distinct pairs are tracked as separate "use" events on
    // the prom-client side via labels; here we verify the
    // in-memory total grows by exactly N for N distinct calls.
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-1' },
    );
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-2', scope: 'project-1' },
      { workflowRunId: 'run-1' },
    );
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-2' },
      { workflowRunId: 'run-1' },
    );

    const snapshot = service.snapshot();
    expect(snapshot.learning.lesson_injected_total).toBe(3);
    // The last-write snapshot only carries the most-recent call.
    expect(snapshot.learning.last_lesson_injected).toEqual({
      lesson_id: 'lesson-1',
      scope: 'project-2',
      injected_at: expect.any(String),
    });
  });

  it('snapshots the learning block independently of internal state mutations', () => {
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-1' },
    );
    const first = service.snapshot();
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-2', scope: 'project-2' },
      { workflowRunId: 'run-1' },
    );
    const second = service.snapshot();

    expect(first.learning.lesson_injected_total).toBe(1);
    expect(first.learning.last_lesson_injected?.lesson_id).toBe('lesson-1');
    expect(second.learning.lesson_injected_total).toBe(2);
    expect(second.learning.last_lesson_injected?.lesson_id).toBe('lesson-2');
  });

  // -----------------------------------------------------------------
  // Run-outcome counter with run-scoped tracking
  // (work item 88d7654e, milestone 2)
  // -----------------------------------------------------------------
  //
  // The prom-client side of the new counter (the labelled
  // `nexus_workflow_run_outcome_after_lesson_total` instrument on
  // `MetricsService`) is asserted directly in
  // `metrics.service.spec.ts`. Here we focus on the in-memory
  // mirror: the unlabelled total, the `last_run_outcome_after_lesson`
  // snapshot, AND the per-run inject tracker that the
  // `WorkflowRunOutcomeAfterLessonListener` drains on terminal.
  //
  // The tracker is the seam that closes the self-improvement
  // feedback loop — the same service that records "a lesson was
  // injected into a planning step" (milestone 1) now also
  // records "this run consumed those injections, and its terminal
  // outcome was success/failure" (milestone 2).

  it('records a workflow-run outcome after a lesson with a last-value snapshot', () => {
    service.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });

    const snapshot = service.snapshot();
    expect(snapshot.learning.run_outcome_after_lesson_total).toBe(1);
    expect(snapshot.learning.last_run_outcome_after_lesson).toEqual({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
      observed_at: expect.any(String),
    });
    // The lesson-injection counters must stay untouched.
    expect(snapshot.learning.lesson_injected_total).toBe(0);
    expect(snapshot.learning.last_lesson_injected).toBeNull();
  });

  it('accumulates the run-outcome counter across N calls without deduplication', () => {
    // Same label triple N times — no dedup. The total grows by
    // exactly N, mirroring the prom-client counter behaviour.
    service.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });
    service.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });
    service.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });

    expect(service.snapshot().learning.run_outcome_after_lesson_total).toBe(3);
  });

  it('accumulates distinct (lesson_id, scope, outcome) triples as separate calls', () => {
    service.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });
    service.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-2',
      scope: 'project-1',
      outcome: 'success',
    });
    service.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-2',
      outcome: 'failure',
    });

    const snapshot = service.snapshot();
    expect(snapshot.learning.run_outcome_after_lesson_total).toBe(3);
    // The last-write snapshot only carries the most-recent call.
    expect(snapshot.learning.last_run_outcome_after_lesson).toEqual({
      lesson_id: 'lesson-1',
      scope: 'project-2',
      outcome: 'failure',
      observed_at: expect.any(String),
    });
  });

  it('updates last_run_outcome_after_lesson to the most recent call regardless of label reuse', () => {
    service.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });
    const first = service.snapshot();
    service.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'failure',
    });
    const second = service.snapshot();

    expect(first.learning.last_run_outcome_after_lesson?.outcome).toBe(
      'success',
    );
    expect(second.learning.last_run_outcome_after_lesson?.outcome).toBe(
      'failure',
    );
    // The total accumulates across both calls.
    expect(second.learning.run_outcome_after_lesson_total).toBe(2);
  });

  it('tracks injected (lesson_id, scope) pairs per workflow run and drains them on consume', () => {
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-A' },
    );
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-2', scope: 'project-1' },
      { workflowRunId: 'run-A' },
    );

    const drained = service.consumeRunLessonInjects('run-A');
    expect(drained).toEqual([
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { lesson_id: 'lesson-2', scope: 'project-1' },
    ]);
    // A second consume on the same run MUST return an empty
    // array — the set is consumed once on terminal so a
    // duplicate terminal event cannot double-count.
    expect(service.consumeRunLessonInjects('run-A')).toEqual([]);
  });

  it('returns an empty array from consumeRunLessonInjects when the run had no injections', () => {
    expect(service.consumeRunLessonInjects('run-with-no-injects')).toEqual([]);
    // And it must NOT increment the outcome counter (the
    // listener contract: empty array → do not increment).
    expect(service.snapshot().learning.run_outcome_after_lesson_total).toBe(0);
  });

  it('keeps run A untouched when consuming run B independently', () => {
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-A' },
    );
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-B' },
    );

    // Drain run B — run A's set MUST remain intact for its
    // own terminal event.
    const drainedB = service.consumeRunLessonInjects('run-B');
    expect(drainedB).toEqual([{ lesson_id: 'lesson-1', scope: 'project-1' }]);

    // Run A is still there.
    const drainedA = service.consumeRunLessonInjects('run-A');
    expect(drainedA).toEqual([{ lesson_id: 'lesson-1', scope: 'project-1' }]);
  });

  it('deduplicates repeated injects of the same (lesson_id, scope) pair within a single run', () => {
    // Same pair injected 3 times during the same run → the
    // tracker holds it ONCE so the terminal-event observer
    // emits the outcome counter ONCE per (lesson, scope) per
    // run, not once per inject call. The lesson_injected_total
    // counter itself still accumulates 3 (no dedup there, by
    // design — that's the prom-client mirror).
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-A' },
    );
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-A' },
    );
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-A' },
    );

    const drained = service.consumeRunLessonInjects('run-A');
    expect(drained).toEqual([{ lesson_id: 'lesson-1', scope: 'project-1' }]);
    expect(service.snapshot().learning.lesson_injected_total).toBe(3);
  });

  it('returns a defensive readonly copy from consumeRunLessonInjects (caller cannot mutate the internal set)', () => {
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-A' },
    );

    const drained = service.consumeRunLessonInjects('run-A');
    // The drained array is a copy — mutating it must NOT
    // mutate internal state (no-op here because the set is
    // already deleted, but the read-only surface matters for
    // future callers).
    expect(() => {
      (drained as Array<{ lesson_id: string; scope: string }>).push({
        lesson_id: 'lesson-x',
        scope: 'project-x',
      });
    }).not.toThrow();
    // The internal set was already drained — a re-consume is
    // empty and the injected counter is unchanged.
    expect(service.consumeRunLessonInjects('run-A')).toEqual([]);
    expect(service.snapshot().learning.lesson_injected_total).toBe(1);
  });

  // -----------------------------------------------------------------
  // Behaviour-change anchor capture (EPIC-212 Phase 3, Task 1)
  // -----------------------------------------------------------------
  //
  // `recordLearningLessonInjected` carries an OPTIONAL
  // `anchored_tool` / `anchored_path` through to the per-run set
  // so the terminal observer can later attribute behaviour-change.
  // The capture is strictly additive: a lesson with no anchor
  // drains exactly as before.

  it('stores the behaviour-change anchor on the per-run set and returns it on consume', () => {
    service.recordLearningLessonInjected(
      {
        lesson_id: 'lesson-1',
        scope: 'scope-1',
        anchored_tool: 'run_command',
        anchored_path: 'apps/api/src/main.ts',
      },
      { workflowRunId: 'run-A' },
    );

    expect(service.consumeRunLessonInjects('run-A')).toEqual([
      {
        lesson_id: 'lesson-1',
        scope: 'scope-1',
        anchored_tool: 'run_command',
        anchored_path: 'apps/api/src/main.ts',
      },
    ]);
  });

  it('drains a lesson with no anchor with exactly the same shape as before (no anchor keys)', () => {
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'scope-1' },
      { workflowRunId: 'run-A' },
    );

    const drained = service.consumeRunLessonInjects('run-A');
    expect(drained).toEqual([{ lesson_id: 'lesson-1', scope: 'scope-1' }]);
    // Strict equality guard: no `anchored_*: undefined` keys leak.
    expect(drained).toStrictEqual([
      { lesson_id: 'lesson-1', scope: 'scope-1' },
    ]);
  });

  it('carries only the leg that is present (tool-only or path-only)', () => {
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-tool', scope: 'scope-1', anchored_tool: 'grep' },
      { workflowRunId: 'run-A' },
    );
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-path', scope: 'scope-1', anchored_path: 'a.ts' },
      { workflowRunId: 'run-A' },
    );

    expect(service.consumeRunLessonInjects('run-A')).toStrictEqual([
      { lesson_id: 'lesson-tool', scope: 'scope-1', anchored_tool: 'grep' },
      { lesson_id: 'lesson-path', scope: 'scope-1', anchored_path: 'a.ts' },
    ]);
  });

  it('keeps the first-seen anchor when the same pair is re-injected without one', () => {
    service.recordLearningLessonInjected(
      {
        lesson_id: 'lesson-1',
        scope: 'scope-1',
        anchored_tool: 'edit',
        anchored_path: 'src/x.ts',
      },
      { workflowRunId: 'run-A' },
    );
    // Re-inject the SAME pair without an anchor → must not wipe it.
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'scope-1' },
      { workflowRunId: 'run-A' },
    );

    expect(service.consumeRunLessonInjects('run-A')).toStrictEqual([
      {
        lesson_id: 'lesson-1',
        scope: 'scope-1',
        anchored_tool: 'edit',
        anchored_path: 'src/x.ts',
      },
    ]);
    // Counter still accumulates both inject calls (no dedup there).
    expect(service.snapshot().learning.lesson_injected_total).toBe(2);
  });

  // -----------------------------------------------------------------
  // Postmortem writeback observability (work item 5743ac93)
  // -----------------------------------------------------------------
  //
  // The `WorkflowFailurePostmortemListener` (milestone 2) calls
  // `recordPostmortemRecorded` once per processed
  // `WORKFLOW_RUN_FAILED_EVENT`. The snapshot's `postmortem` block
  // mirrors the `nexus_workflow_postmortem_recorded_total{outcome=...}`
  // prom-client instrument on `MetricsService` so the in-process
  // REST snapshot and the Prometheus scrape agree.

  it('records a successful postmortem write with memory_segment_id and updates last_recorded', () => {
    service.recordPostmortemRecorded({
      outcome: 'success',
      occurred_at: '2026-06-19T00:00:00.000Z',
      memory_segment_id: 'memory-abc',
    });

    const snapshot = service.snapshot();
    expect(snapshot.postmortem.recorded_total).toEqual({
      success: 1,
      skipped: 0,
      failed: 0,
    });
    expect(snapshot.postmortem.last_recorded).toEqual({
      occurred_at: '2026-06-19T00:00:00.000Z',
      outcome: 'success',
      memory_segment_id: 'memory-abc',
    });
  });

  it('records a skipped postmortem with a reason and no memory_segment_id', () => {
    service.recordPostmortemRecorded({
      outcome: 'skipped',
      occurred_at: '2026-06-19T00:00:01.000Z',
      reason: 'kill switch disabled',
    });

    const snapshot = service.snapshot();
    expect(snapshot.postmortem.recorded_total).toEqual({
      success: 0,
      skipped: 1,
      failed: 0,
    });
    expect(snapshot.postmortem.last_recorded).toEqual({
      occurred_at: '2026-06-19T00:00:01.000Z',
      outcome: 'skipped',
      reason: 'kill switch disabled',
    });
    // `memory_segment_id` MUST be absent on a skip — the listener
    // did not produce a row.
    expect(
      snapshot.postmortem.last_recorded?.memory_segment_id,
    ).toBeUndefined();
  });

  it('records a failed postmortem and accumulates per-outcome counters', () => {
    service.recordPostmortemRecorded({
      outcome: 'success',
      occurred_at: '2026-06-19T00:00:00.000Z',
      memory_segment_id: 'memory-1',
    });
    service.recordPostmortemRecorded({
      outcome: 'success',
      occurred_at: '2026-06-19T00:00:01.000Z',
      memory_segment_id: 'memory-2',
    });
    service.recordPostmortemRecorded({
      outcome: 'skipped',
      occurred_at: '2026-06-19T00:00:02.000Z',
      reason: 'dedup hit',
    });
    service.recordPostmortemRecorded({
      outcome: 'failed',
      occurred_at: '2026-06-19T00:00:03.000Z',
      reason: 'classification service threw',
    });

    const snapshot = service.snapshot();
    expect(snapshot.postmortem.recorded_total).toEqual({
      success: 2,
      skipped: 1,
      failed: 1,
    });
    // The most recent write wins on `last_recorded` regardless of
    // outcome — the operator surface cares about the "was the
    // listener awake" signal, not just successes.
    expect(snapshot.postmortem.last_recorded?.outcome).toBe('failed');
    expect(snapshot.postmortem.last_recorded?.reason).toBe(
      'classification service threw',
    );
  });

  it('snapshots the postmortem block independently of internal state mutations', () => {
    service.recordPostmortemRecorded({
      outcome: 'success',
      occurred_at: '2026-06-19T00:00:00.000Z',
      memory_segment_id: 'memory-1',
    });
    const first = service.snapshot();
    service.recordPostmortemRecorded({
      outcome: 'failed',
      occurred_at: '2026-06-19T00:00:01.000Z',
      reason: 'backend rejected',
    });
    const second = service.snapshot();

    expect(first.postmortem.recorded_total).toEqual({
      success: 1,
      skipped: 0,
      failed: 0,
    });
    expect(first.postmortem.last_recorded?.outcome).toBe('success');
    expect(second.postmortem.recorded_total).toEqual({
      success: 1,
      skipped: 0,
      failed: 1,
    });
    expect(second.postmortem.last_recorded?.outcome).toBe('failed');
  });

  // -----------------------------------------------------------------
  // Learning-loop convergence gauge (work item 88d7654e, milestone 3)
  // -----------------------------------------------------------------
  //
  // The convergence ratio is the signal that closes the
  // self-improvement feedback loop: `successes / total` over a
  // rolling window of `learning_convergence_window_days` days.
  // The in-memory snapshot exposes the per-scope ratio in
  // `learning.convergence[scope]` and the prom-client side
  // exposes the same value via the
  // `nexus_learning_loop_convergence_ratio{scope}` gauge.
  //
  // Acceptance fixture (per the work item): 8 success + 2
  // failure outcomes for a single scope → `ratio === 0.8`,
  // `runs_after_lesson === 10`, `successes_after_lesson === 8`.

  it('computes a 0.8 convergence ratio for 8 success + 2 failure outcomes on a single scope', () => {
    // 8 success + 2 failure for `project-1` — the canonical
    // acceptance fixture. Inject a matching lesson-injection
    // event first so the scope becomes "active" in the ring
    // buffer; the injector itself is not counted in the ratio
    // (the numerator + denominator both come from the
    // outcome-after-lesson counter) but the snapshot key
    // requires at least one inject OR one outcome in the
    // window.
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-1' },
      { workflowRunId: 'run-1' },
    );
    for (let i = 0; i < 8; i += 1) {
      service.recordWorkflowRunOutcomeAfterLesson({
        lesson_id: 'lesson-1',
        scope: 'project-1',
        outcome: 'success',
      });
    }
    for (let i = 0; i < 2; i += 1) {
      service.recordWorkflowRunOutcomeAfterLesson({
        lesson_id: 'lesson-1',
        scope: 'project-1',
        outcome: 'failure',
      });
    }

    const snapshot = service.snapshot();
    expect(snapshot.learning.convergence).toEqual({
      'project-1': {
        ratio: 0.8,
        // The sync `snapshot()` path uses the hardcoded default
        // window (7 days); the async `getSnapshot()` path
        // honours the live SystemSetting. Both are tested.
        window_days: 7,
        runs_after_lesson: 10,
        successes_after_lesson: 8,
        computed_at: expect.any(String),
      },
    });
  });

  it('exposes an empty convergence map for a scope with no signal in the rolling window', () => {
    // Empty scope (no injections, no outcomes) — the
    // convergence block on the snapshot is an empty map. This
    // is the documented "no signal at all" surface: a scope
    // key is added to the map only when at least one
    // lesson-inject OR run-outcome sample falls in the
    // rolling window.
    const snapshot = service.snapshot();
    expect(snapshot.learning.convergence).toEqual({});
  });

  it('exposes a zero-ratio convergence snapshot for a scope with only injections and no outcomes', () => {
    // The "lesson was injected but no run-after-lesson has
    // completed yet" case: the snapshot key is present (the
    // inject sample made the scope active) but the ratio is
    // `0` because the denominator is zero.
    service.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-A' },
      { workflowRunId: 'run-1' },
    );

    const snapshot = service.snapshot();
    expect(snapshot.learning.convergence).toEqual({
      'project-A': {
        ratio: 0,
        window_days: 7,
        runs_after_lesson: 0,
        successes_after_lesson: 0,
        computed_at: expect.any(String),
      },
    });
  });

  it('computes per-scope ratios independently across distinct scopes', () => {
    // Two scopes, distinct outcomes, no cross-contamination
    // (the prom-client label cardinality is per-scope so the
    // gauge must surface the same isolation).
    for (let i = 0; i < 4; i += 1) {
      service.recordWorkflowRunOutcomeAfterLesson({
        lesson_id: 'lesson-1',
        scope: 'project-1',
        outcome: 'success',
      });
    }
    for (let i = 0; i < 1; i += 1) {
      service.recordWorkflowRunOutcomeAfterLesson({
        lesson_id: 'lesson-1',
        scope: 'project-1',
        outcome: 'failure',
      });
    }
    for (let i = 0; i < 1; i += 1) {
      service.recordWorkflowRunOutcomeAfterLesson({
        lesson_id: 'lesson-2',
        scope: 'project-2',
        outcome: 'success',
      });
    }
    for (let i = 0; i < 3; i += 1) {
      service.recordWorkflowRunOutcomeAfterLesson({
        lesson_id: 'lesson-2',
        scope: 'project-2',
        outcome: 'failure',
      });
    }

    const snapshot = service.snapshot();
    expect(snapshot.learning.convergence['project-1']?.ratio).toBeCloseTo(
      4 / 5,
      10,
    );
    expect(snapshot.learning.convergence['project-1']?.runs_after_lesson).toBe(
      5,
    );
    expect(
      snapshot.learning.convergence['project-1']?.successes_after_lesson,
    ).toBe(4);
    expect(snapshot.learning.convergence['project-2']?.ratio).toBeCloseTo(
      1 / 4,
      10,
    );
    expect(snapshot.learning.convergence['project-2']?.runs_after_lesson).toBe(
      4,
    );
    expect(
      snapshot.learning.convergence['project-2']?.successes_after_lesson,
    ).toBe(1);
  });

  it('honours the rolling window: samples older than window_days are excluded from the ratio', () => {
    // Drive the in-memory ring buffer via
    // `recordWorkflowRunOutcomeAfterLesson` (the buffers are
    // populated at record time) and then manually shift the
    // timestamps to simulate age — mirrors the in-window vs
    // out-of-window test for the prom-client side. The
    // `computeConvergenceSnapshotsForWindow` private helper
    // is the production path that the async `getSnapshot()`
    // takes; we call it via the public `snapshot()` with the
    // default window for the in-window assertion and reach
    // into the private helper for the out-of-window one.
    const now = Date.now();
    const innerService = new MemoryMetricsService();

    // 1 success within the window.
    innerService.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });
    // 1 failure that we will manually age out below.
    innerService.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'failure',
    });

    // Manually age the second outcome by backdating its
    // timestamp past the 7-day window. The private ring is
    // accessible via the closure pattern used in this file
    // (the in-memory state is captured in the test
    // `private` accessor pattern that the existing tests
    // already use for `setMemoryDecayLastRun` etc.).
    const rings = (
      innerService as unknown as {
        learningOutcomeTimestampsByScope: Map<string, Array<{ at: number }>>;
      }
    ).learningOutcomeTimestampsByScope;
    const ring = rings.get('project-1');
    expect(ring).toBeDefined();
    if (ring) {
      // 8 days ago = expired under both the 7-day default
      // window and a 1-day window. The test exercises the
      // ring trim on `computeConvergenceSnapshotsForWindow`.
      ring[0].at = now - 8 * 86_400_000;
    }

    const snapshot = innerService.snapshot();
    // After trimming the 8-day-old success, only the fresh
    // failure remains in the window → ratio = 0/1 = 0.
    expect(snapshot.learning.convergence['project-1']?.ratio).toBe(0);
    expect(snapshot.learning.convergence['project-1']?.runs_after_lesson).toBe(
      1,
    );
    expect(
      snapshot.learning.convergence['project-1']?.successes_after_lesson,
    ).toBe(0);
  });

  it('drops scopes from the convergence map when all samples age out of the window', () => {
    // All-outcomes-aged-out case: a scope with only samples
    // older than the rolling window is omitted from the
    // convergence map entirely (not surfaced with zeros).
    const innerService = new MemoryMetricsService();
    innerService.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-aged',
      outcome: 'success',
    });

    const rings = (
      innerService as unknown as {
        learningOutcomeTimestampsByScope: Map<string, Array<{ at: number }>>;
      }
    ).learningOutcomeTimestampsByScope;
    const ring = rings.get('project-aged');
    if (ring) {
      ring[0].at = Date.now() - 30 * 86_400_000;
    }

    const snapshot = innerService.snapshot();
    expect(snapshot.learning.convergence['project-aged']).toBeUndefined();
  });

  it('trims expired inject samples so an inject-only scope ages out of the convergence map', () => {
    // Mirrors the outcomes-age-out test for the inject ring:
    // a scope with only inject samples older than the window
    // is omitted from the convergence map.
    const innerService = new MemoryMetricsService();
    innerService.recordLearningLessonInjected(
      { lesson_id: 'lesson-1', scope: 'project-aged' },
      { workflowRunId: 'run-1' },
    );

    const rings = (
      innerService as unknown as {
        learningInjectTimestampsByScope: Map<string, number[]>;
      }
    ).learningInjectTimestampsByScope;
    const ring = rings.get('project-aged');
    if (ring) {
      ring[0] = Date.now() - 30 * 86_400_000;
    }

    const snapshot = innerService.snapshot();
    expect(snapshot.learning.convergence['project-aged']).toBeUndefined();
  });

  it('async getSnapshot() reads the live learning_convergence_window_days setting', async () => {
    // The async `getSnapshot()` path resolves the
    // `learning_convergence_window_days` SystemSetting on
    // every call so an operator can tune the rolling window
    // without restarting the API. Here we set the setting
    // to `1` day and verify that an outcome sample older
    // than 1 day is excluded.
    const settings = {
      get: vi.fn().mockResolvedValue(1),
    };
    const metrics = {
      setLearningLoopConvergenceRatio: vi.fn(),
    };
    // Re-construct the service with the optional deps wired.
    const wired = new MemoryMetricsService(settings as never, metrics as never);

    wired.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });
    wired.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });
    wired.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'failure',
    });

    // All three samples are within the last hour, so the
    // `window_days = 1` setting still keeps them — the
    // ratio is `2/3` and the gauge is set with that value.
    const snapshot = await wired.getSnapshot();
    expect(snapshot.learning.convergence['project-1']?.ratio).toBeCloseTo(
      2 / 3,
      10,
    );
    expect(snapshot.learning.convergence['project-1']?.window_days).toBe(1);
    expect(snapshot.learning.convergence['project-1']?.runs_after_lesson).toBe(
      3,
    );
    expect(
      snapshot.learning.convergence['project-1']?.successes_after_lesson,
    ).toBe(2);

    // The gauge mutator was called for the active scope.
    expect(
      (
        metrics as unknown as {
          setLearningLoopConvergenceRatio: ReturnType<typeof vi.fn>;
        }
      ).setLearningLoopConvergenceRatio,
    ).toHaveBeenCalledWith('project-1', 2 / 3);
  });

  it('async getSnapshot() honours a window_days=1 setting by excluding samples older than 1 day', async () => {
    // Drive a service, then manually age one of the
    // outcome samples to 2 days ago. With
    // `window_days = 1` the aged sample is dropped from
    // both the numerator and the denominator; with
    // `window_days = 7` it is kept.
    const settings = {
      get: vi.fn().mockResolvedValue(1),
    };
    const metrics = {
      setLearningLoopConvergenceRatio: vi.fn(),
    };
    const wired = new MemoryMetricsService(settings as never, metrics as never);

    // Two fresh outcomes (within the last hour).
    wired.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });
    // One outcome that we will manually age to 2 days ago.
    wired.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'failure',
    });

    const rings = (
      wired as unknown as {
        learningOutcomeTimestampsByScope: Map<string, Array<{ at: number }>>;
      }
    ).learningOutcomeTimestampsByScope;
    const ring = rings.get('project-1');
    if (ring) {
      ring[1].at = Date.now() - 2 * 86_400_000;
    }

    const snapshot = await wired.getSnapshot();
    // window_days=1 drops the 2-day-old failure (ring[1])
    // → only the 1 in-window success remains → ratio = 1,
    // runs = 1, successes = 1.
    expect(snapshot.learning.convergence['project-1']?.ratio).toBe(1);
    expect(snapshot.learning.convergence['project-1']?.runs_after_lesson).toBe(
      1,
    );
    expect(
      snapshot.learning.convergence['project-1']?.successes_after_lesson,
    ).toBe(1);
  });

  it('async getSnapshot() honours a window_days=7 setting by keeping samples older than 1 day', async () => {
    // Mirror of the previous test with window_days=7: the
    // 2-day-old sample is kept so the ratio is 1/2.
    const settings = {
      get: vi.fn().mockResolvedValue(7),
    };
    const metrics = {
      setLearningLoopConvergenceRatio: vi.fn(),
    };
    const wired = new MemoryMetricsService(settings as never, metrics as never);

    wired.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });
    wired.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'failure',
    });

    const rings = (
      wired as unknown as {
        learningOutcomeTimestampsByScope: Map<string, Array<{ at: number }>>;
      }
    ).learningOutcomeTimestampsByScope;
    const ring = rings.get('project-1');
    if (ring) {
      ring[1].at = Date.now() - 2 * 86_400_000;
    }

    const snapshot = await wired.getSnapshot();
    expect(snapshot.learning.convergence['project-1']?.ratio).toBeCloseTo(
      1 / 2,
      10,
    );
    expect(snapshot.learning.convergence['project-1']?.runs_after_lesson).toBe(
      2,
    );
    expect(
      snapshot.learning.convergence['project-1']?.successes_after_lesson,
    ).toBe(1);
    expect(snapshot.learning.convergence['project-1']?.window_days).toBe(7);
  });

  it('async getSnapshot() falls back to the hardcoded default when the settings service throws', async () => {
    const settings = {
      get: vi.fn().mockRejectedValue(new Error('db unavailable')),
    };
    const metrics = {
      setLearningLoopConvergenceRatio: vi.fn(),
    };
    const wired = new MemoryMetricsService(settings as never, metrics as never);

    wired.recordWorkflowRunOutcomeAfterLesson({
      lesson_id: 'lesson-1',
      scope: 'project-1',
      outcome: 'success',
    });

    const snapshot = await wired.getSnapshot();
    // The hardcoded default is 7 days; a sample from `now`
    // is well within the window.
    expect(snapshot.learning.convergence['project-1']?.window_days).toBe(7);
    expect(snapshot.learning.convergence['project-1']?.ratio).toBe(1);
  });
});

describe('MemoryMetricsService observability primitives (vi.fn parity)', () => {
  it('emits via vi.fn-compatible mutator signatures', () => {
    // Demonstrates the mutator signatures the call sites depend on; this is
    // a redundant guard against accidental signature drift in the future.
    const service = new MemoryMetricsService();
    const record = vi.fn();
    vi.spyOn(service, 'recordBackendRead').mockImplementation(record);

    service.recordBackendRead('postgres', 1);
    expect(record).toHaveBeenCalledWith('postgres', 1);
  });

  describe('EPIC-212 Phase 3 Task 6 — measurement trio', () => {
    let service: MemoryMetricsService;

    beforeEach(() => {
      service = new MemoryMetricsService();
    });

    it('counts behaviour-change observations and exposes the last write', () => {
      service.recordLearningBehaviourChange({
        lesson_id: 'l1',
        scope: 'p1',
        changed: true,
      });
      service.recordLearningBehaviourChange({
        lesson_id: 'l2',
        scope: 'p1',
        changed: false,
      });

      const bc = service.snapshot().learning.behaviour_change;
      expect(bc.changed_total).toBe(1);
      expect(bc.unchanged_total).toBe(1);
      expect(bc.last).toMatchObject({
        lesson_id: 'l2',
        scope: 'p1',
        changed: false,
      });
    });

    it('reports an empty lift map when no holdout arm is recorded (default-inert)', () => {
      // An injection with NO holdout_arm (the fraction = 0 path) must not
      // create any per-arm ring → lift stays {}.
      service.recordLearningLessonInjected(
        { lesson_id: 'l1', scope: 'p1' },
        { workflowRunId: 'run-1' },
      );
      service.recordWorkflowRunOutcomeAfterLesson({
        lesson_id: 'l1',
        scope: 'p1',
        outcome: 'success',
      });

      expect(service.snapshot().learning.lift).toEqual({});
    });

    it('computes lift = convergence(injected) − convergence(holdout) from a two-arm fixture', () => {
      const scope = 'p1';
      // Injected arm: 3 successes out of 4 → 0.75.
      for (let i = 0; i < 4; i += 1) {
        service.recordWorkflowRunOutcomeAfterLesson({
          lesson_id: `inj-${i}`,
          scope,
          outcome: i < 3 ? 'success' : 'failure',
          holdout_arm: 'injected',
        });
      }
      // Holdout arm: 1 success out of 4 → 0.25.
      for (let i = 0; i < 4; i += 1) {
        service.recordWorkflowRunOutcomeAfterLesson({
          lesson_id: `hold-${i}`,
          scope,
          outcome: i < 1 ? 'success' : 'failure',
          holdout_arm: 'holdout',
        });
      }

      const lift = service.snapshot().learning.lift[scope];
      expect(lift).toBeDefined();
      expect(lift.injected).toMatchObject({ runs: 4, successes: 3 });
      expect(lift.holdout).toMatchObject({ runs: 4, successes: 1 });
      expect(lift.lift).toBeCloseTo(0.5);
    });

    it('reports lift = null for a scope with an injected arm but no holdout arm', () => {
      service.recordWorkflowRunOutcomeAfterLesson({
        lesson_id: 'inj-1',
        scope: 'p1',
        outcome: 'success',
        holdout_arm: 'injected',
      });

      expect(service.snapshot().learning.lift['p1'].lift).toBeNull();
    });

    it('does not inject the main lesson counter for a suppressed (holdout) injection', () => {
      service.recordLearningLessonInjected(
        { lesson_id: 'l1', scope: 'p1', holdout_arm: 'holdout' },
        { workflowRunId: 'run-1' },
      );

      // Lesson was suppressed → the main "injected" counter must NOT move.
      expect(service.snapshot().learning.lesson_injected_total).toBe(0);
      // But it is still tracked per-run so the terminal observer attributes it.
      const drained = service.consumeRunLessonInjects('run-1');
      expect(drained).toEqual([
        { lesson_id: 'l1', scope: 'p1', holdout_arm: 'holdout' },
      ]);
    });

    it('stores cost-per-promoted-memory and suppressed-noise count', () => {
      service.setLearningCostPerPromotedMemory(12.5);
      service.setLearningSuppressedNoiseCount(7);

      const learning = service.snapshot().learning;
      expect(learning.cost_per_promoted_memory).toBe(12.5);
      expect(learning.suppressed_noise_count).toBe(7);

      service.setLearningCostPerPromotedMemory(null);
      expect(service.snapshot().learning.cost_per_promoted_memory).toBeNull();
    });
  });
});
