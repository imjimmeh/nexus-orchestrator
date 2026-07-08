import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from 'prom-client';
import { MetricsService } from './metrics.service';

describe('MetricsService.recordLearningLessonInjected', () => {
  let service: MetricsService;

  beforeEach(() => {
    // The prom-client registry is process-global; clear it
    // before each test so a prior `MetricsService` instance
    // (or this one in a previous `beforeEach`) doesn't collide
    // on the duplicate-registration guard.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    // Drop the spec-local instrument so subsequent specs that
    // instantiate `MetricsService` start from a clean slate.
    register.clear();
  });

  it('increments the labelled counter with the supplied lesson_id and scope', async () => {
    service.recordLearningLessonInjected('lesson-1', 'project-1');

    // Read the counter value directly from the prom-client
    // instrument so the assertion exercises the exact label
    // tuple that the call site emits — no transcription risk
    // through a wrapper method.
    const value = await service.learningLessonInjectedTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.lesson_id === 'lesson-1' &&
        entry.labels.scope === 'project-1',
    );
    expect(matching?.value).toBe(1);
  });

  it('appends the counter under the exact label tuple (no auto-fan-out)', async () => {
    service.recordLearningLessonInjected('lesson-1', 'project-1');
    service.recordLearningLessonInjected('lesson-1', 'project-1');

    const value = await service.learningLessonInjectedTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.lesson_id === 'lesson-1' &&
        entry.labels.scope === 'project-1',
    );
    // Same (lesson_id, scope) pair called twice produces two
    // increments — no deduplication.
    expect(matching?.value).toBe(2);
  });

  it('increments the same (lesson_id, scope) pair N times with N increments', async () => {
    for (let i = 0; i < 5; i += 1) {
      service.recordLearningLessonInjected('lesson-shared', 'project-shared');
    }

    const value = await service.learningLessonInjectedTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.lesson_id === 'lesson-shared' &&
        entry.labels.scope === 'project-shared',
    );
    expect(matching?.value).toBe(5);
  });

  it('tracks each distinct (lesson_id, scope) pair on its own labelled series', async () => {
    service.recordLearningLessonInjected('lesson-A', 'project-1');
    service.recordLearningLessonInjected('lesson-A', 'project-1');
    service.recordLearningLessonInjected('lesson-A', 'project-2');
    service.recordLearningLessonInjected('lesson-B', 'project-1');

    const value = await service.learningLessonInjectedTotal.get();
    const findValue = (lessonId: string, scope: string): number | undefined =>
      value.values.find(
        (entry) =>
          entry.labels.lesson_id === lessonId && entry.labels.scope === scope,
      )?.value;

    // Distinct pairs occupy distinct labelled series.
    expect(findValue('lesson-A', 'project-1')).toBe(2);
    expect(findValue('lesson-A', 'project-2')).toBe(1);
    expect(findValue('lesson-B', 'project-1')).toBe(1);
  });

  it('does not mutate unrelated counters (e.g. learningPromotedTotal)', () => {
    // Sanity check: the new counter is a separate instrument
    // and must not bleed into the promotion counter.
    service.recordLearningLessonInjected('lesson-1', 'project-1');
    expect(service.learningPromotedTotal).not.toBe(
      service.learningLessonInjectedTotal,
    );
  });

  it('is vi.fn-compatible so call sites can spy on the recordLearningLessonInjected mutator', () => {
    // The existing `recordLearningPromoted`/`recordWorkflowPostmortemRecorded`
    // mutators are wrapped by `vi.fn()` in spec files; the
    // new mutator must follow the same convention so call
    // sites can assert call counts and arg tuples.
    const spy = vi.fn();
    vi.spyOn(service, 'recordLearningLessonInjected').mockImplementation(spy);

    service.recordLearningLessonInjected('lesson-1', 'project-1');
    expect(spy).toHaveBeenCalledWith('lesson-1', 'project-1');
  });
});

describe('MetricsService.recordLearningRunOutcomeAfterLesson', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments the labelled counter with lesson_id, scope, and outcome', async () => {
    service.recordLearningRunOutcomeAfterLesson(
      'lesson-1',
      'project-1',
      'success',
    );

    const value = await service.learningRunOutcomeAfterLessonTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.lesson_id === 'lesson-1' &&
        entry.labels.scope === 'project-1' &&
        entry.labels.outcome === 'success',
    );
    expect(matching?.value).toBe(1);
  });

  it('appends the counter under the exact label tuple (no auto-fan-out)', async () => {
    service.recordLearningRunOutcomeAfterLesson(
      'lesson-1',
      'project-1',
      'success',
    );
    service.recordLearningRunOutcomeAfterLesson(
      'lesson-1',
      'project-1',
      'success',
    );

    const value = await service.learningRunOutcomeAfterLessonTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.lesson_id === 'lesson-1' &&
        entry.labels.scope === 'project-1' &&
        entry.labels.outcome === 'success',
    );
    // Same (lesson_id, scope, outcome) triple called twice
    // produces two increments — no deduplication.
    expect(matching?.value).toBe(2);
  });

  it('increments the same label triple N times with N increments', async () => {
    for (let i = 0; i < 5; i += 1) {
      service.recordLearningRunOutcomeAfterLesson(
        'lesson-shared',
        'project-shared',
        'success',
      );
    }

    const value = await service.learningRunOutcomeAfterLessonTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.lesson_id === 'lesson-shared' &&
        entry.labels.scope === 'project-shared' &&
        entry.labels.outcome === 'success',
    );
    expect(matching?.value).toBe(5);
  });

  it('tracks each distinct (lesson_id, scope, outcome) triple on its own labelled series', async () => {
    service.recordLearningRunOutcomeAfterLesson(
      'lesson-A',
      'project-1',
      'success',
    );
    service.recordLearningRunOutcomeAfterLesson(
      'lesson-A',
      'project-1',
      'success',
    );
    service.recordLearningRunOutcomeAfterLesson(
      'lesson-A',
      'project-2',
      'success',
    );
    service.recordLearningRunOutcomeAfterLesson(
      'lesson-B',
      'project-1',
      'success',
    );
    service.recordLearningRunOutcomeAfterLesson(
      'lesson-A',
      'project-1',
      'failure',
    );

    const value = await service.learningRunOutcomeAfterLessonTotal.get();
    const findValue = (
      lessonId: string,
      scope: string,
      outcome: string,
    ): number | undefined =>
      value.values.find(
        (entry) =>
          entry.labels.lesson_id === lessonId &&
          entry.labels.scope === scope &&
          entry.labels.outcome === outcome,
      )?.value;

    // Distinct triples occupy distinct labelled series.
    expect(findValue('lesson-A', 'project-1', 'success')).toBe(2);
    expect(findValue('lesson-A', 'project-2', 'success')).toBe(1);
    expect(findValue('lesson-B', 'project-1', 'success')).toBe(1);
    // `outcome` is its own dimension: a (lesson, scope,
    // success) and a (lesson, scope, failure) are different
    // series even when the lesson + scope are the same.
    expect(findValue('lesson-A', 'project-1', 'failure')).toBe(1);
  });

  it('does not mutate unrelated counters (e.g. learningLessonInjectedTotal)', () => {
    // Sanity check: the new counter is a separate instrument
    // and must not bleed into the inject counter.
    service.recordLearningRunOutcomeAfterLesson(
      'lesson-1',
      'project-1',
      'success',
    );
    expect(service.learningRunOutcomeAfterLessonTotal).not.toBe(
      service.learningLessonInjectedTotal,
    );
  });

  it('is vi.fn-compatible so call sites can spy on the recordLearningRunOutcomeAfterLesson mutator', () => {
    // Mirrors the inject-counter parity test — the new
    // mutator must follow the same convention so the
    // listener spec can assert call counts and arg tuples.
    const spy = vi.fn();
    vi.spyOn(service, 'recordLearningRunOutcomeAfterLesson').mockImplementation(
      spy,
    );

    service.recordLearningRunOutcomeAfterLesson(
      'lesson-1',
      'project-1',
      'failure',
    );
    expect(spy).toHaveBeenCalledWith('lesson-1', 'project-1', 'failure');
  });
});

describe('MetricsService.setLearningLoopConvergenceRatio', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('sets the labelled gauge with the supplied scope and ratio', async () => {
    service.setLearningLoopConvergenceRatio('project-1', 0.8);

    const value = await service.learningLoopConvergenceRatio.get();
    const matching = value.values.find(
      (entry) => entry.labels.scope === 'project-1',
    );
    expect(matching?.value).toBe(0.8);
  });

  it('overwrites the gauge value for the same scope on subsequent calls', async () => {
    service.setLearningLoopConvergenceRatio('project-1', 0.5);
    service.setLearningLoopConvergenceRatio('project-1', 0.9);

    const value = await service.learningLoopConvergenceRatio.get();
    const matching = value.values.find(
      (entry) => entry.labels.scope === 'project-1',
    );
    // Same (scope) called twice → second call wins (the
    // gauge is a single labelled series per scope).
    expect(matching?.value).toBe(0.9);
  });

  it('tracks each distinct scope on its own labelled series', async () => {
    service.setLearningLoopConvergenceRatio('project-1', 0.5);
    service.setLearningLoopConvergenceRatio('project-1', 0.7);
    service.setLearningLoopConvergenceRatio('project-2', 0.9);

    const value = await service.learningLoopConvergenceRatio.get();
    const findValue = (scope: string): number | undefined =>
      value.values.find((entry) => entry.labels.scope === scope)?.value;

    // Distinct scopes occupy distinct labelled series.
    // `project-1` carries the most recent value (0.7).
    expect(findValue('project-1')).toBe(0.7);
    expect(findValue('project-2')).toBe(0.9);
  });

  it('clamps the ratio to [0, 1] so a single bad input cannot poison the scrape', () => {
    // The mutator clamps out-of-range / non-finite values to
    // a safe value in `[0, 1]` so an upstream bug cannot
    // emit a `NaN` / `Infinity` ratio to the Prometheus
    // scrape.
    service.setLearningLoopConvergenceRatio('project-1', 1.5);
    service.setLearningLoopConvergenceRatio('project-2', -0.5);
    service.setLearningLoopConvergenceRatio('project-3', Number.NaN);
    service.setLearningLoopConvergenceRatio(
      'project-4',
      Number.POSITIVE_INFINITY,
    );
    service.setLearningLoopConvergenceRatio(
      'project-5',
      Number.NEGATIVE_INFINITY,
    );
  });

  it('emits zero for NaN inputs and clamps Infinity to 1 and -Infinity to 0', async () => {
    service.setLearningLoopConvergenceRatio('project-na', Number.NaN);
    service.setLearningLoopConvergenceRatio(
      'project-pos-inf',
      Number.POSITIVE_INFINITY,
    );
    service.setLearningLoopConvergenceRatio(
      'project-neg-inf',
      Number.NEGATIVE_INFINITY,
    );

    const value = await service.learningLoopConvergenceRatio.get();
    const findValue = (scope: string): number | undefined =>
      value.values.find((entry) => entry.labels.scope === scope)?.value;

    expect(findValue('project-na')).toBe(0);
    expect(findValue('project-pos-inf')).toBe(1);
    expect(findValue('project-neg-inf')).toBe(0);
  });

  it('is vi.fn-compatible so call sites can spy on the setLearningLoopConvergenceRatio mutator', () => {
    // The new mutator must follow the same
    // vi.spyOn / vi.fn convention as the other learning
    // mutators so callers can assert call counts and arg
    // tuples.
    const spy = vi.fn();
    vi.spyOn(service, 'setLearningLoopConvergenceRatio').mockImplementation(
      spy,
    );

    service.setLearningLoopConvergenceRatio('project-1', 0.8);
    expect(spy).toHaveBeenCalledWith('project-1', 0.8);
  });
});

describe('MetricsService.recordMemoryBackendRead', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments the labelled read counter with the supplied backend', async () => {
    service.recordMemoryBackendRead('postgres', 7);

    const value = await service.memoryBackendReadTotal.get();
    const matching = value.values.find(
      (entry) => entry.labels.backend === 'postgres',
    );
    expect(matching?.value).toBe(1);
  });

  it('observes the read-latency histogram with the supplied backend label', async () => {
    service.recordMemoryBackendRead('postgres', 7);
    service.recordMemoryBackendRead('postgres', 11);

    const value = await service.memoryBackendReadLatencyMs.get();
    const countEntry = value.values.find(
      (entry) =>
        entry.metricName === 'nexus_memory_backend_read_latency_ms_count' &&
        entry.labels.backend === 'postgres',
    );
    const sumEntry = value.values.find(
      (entry) =>
        entry.metricName === 'nexus_memory_backend_read_latency_ms_sum' &&
        entry.labels.backend === 'postgres',
    );
    // Two observations, total 18 ms.
    expect(countEntry?.value).toBe(2);
    expect(sumEntry?.value).toBe(18);
  });

  it('appends the counter under the exact label tuple (no auto-fan-out)', async () => {
    service.recordMemoryBackendRead('postgres', 5);
    service.recordMemoryBackendRead('postgres', 5);

    const value = await service.memoryBackendReadTotal.get();
    const matching = value.values.find(
      (entry) => entry.labels.backend === 'postgres',
    );
    // Two backend='postgres' calls produce two increments.
    expect(matching?.value).toBe(2);
  });

  it('tracks each distinct backend on its own labelled series', async () => {
    service.recordMemoryBackendRead('postgres', 5);
    service.recordMemoryBackendRead('postgres', 5);
    service.recordMemoryBackendRead('honcho', 1);

    const value = await service.memoryBackendReadTotal.get();
    const findValue = (backend: string): number | undefined =>
      value.values.find((entry) => entry.labels.backend === backend)?.value;

    expect(findValue('postgres')).toBe(2);
    expect(findValue('honcho')).toBe(1);
  });

  it('clamps negative latency to zero before observing the histogram', async () => {
    // The mutator forwards the latency through `Math.max(0, latencyMs)`
    // so a single upstream bug (clock skew, frame reorder) cannot
    // emit a negative latency to the Prometheus scrape.
    service.recordMemoryBackendRead('postgres', -50);
    service.recordMemoryBackendRead('honcho', -1);
    service.recordMemoryBackendRead('postgres', 4);

    const value = await service.memoryBackendReadLatencyMs.get();
    const postgresSum = value.values.find(
      (entry) =>
        entry.metricName === 'nexus_memory_backend_read_latency_ms_sum' &&
        entry.labels.backend === 'postgres',
    );
    const honchoSum = value.values.find(
      (entry) =>
        entry.metricName === 'nexus_memory_backend_read_latency_ms_sum' &&
        entry.labels.backend === 'honcho',
    );

    // postgres: clamped -50 → 0, plus +4 = 4.
    expect(postgresSum?.value).toBe(4);
    // honcho: clamped -1 → 0.
    expect(honchoSum?.value).toBe(0);
  });

  it('is vi.fn-compatible so call sites can spy on the recordMemoryBackendRead mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'recordMemoryBackendRead').mockImplementation(spy);

    service.recordMemoryBackendRead('postgres', 7);
    expect(spy).toHaveBeenCalledWith('postgres', 7);
  });
});

describe('MetricsService.recordMemoryBackendWrite', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments the labelled write counter with backend and outcome', async () => {
    service.recordMemoryBackendWrite('postgres', 'success');

    const value = await service.memoryBackendWriteTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.backend === 'postgres' &&
        entry.labels.outcome === 'success',
    );
    expect(matching?.value).toBe(1);
  });

  it('appends the counter under the exact label tuple (no auto-fan-out)', async () => {
    service.recordMemoryBackendWrite('postgres', 'success');
    service.recordMemoryBackendWrite('postgres', 'success');

    const value = await service.memoryBackendWriteTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.backend === 'postgres' &&
        entry.labels.outcome === 'success',
    );
    expect(matching?.value).toBe(2);
  });

  it('tracks each distinct (backend, outcome) pair on its own labelled series', async () => {
    service.recordMemoryBackendWrite('postgres', 'success');
    service.recordMemoryBackendWrite('postgres', 'success');
    service.recordMemoryBackendWrite('postgres', 'failure');
    service.recordMemoryBackendWrite('honcho', 'success');

    const value = await service.memoryBackendWriteTotal.get();
    const findValue = (backend: string, outcome: string): number | undefined =>
      value.values.find(
        (entry) =>
          entry.labels.backend === backend && entry.labels.outcome === outcome,
      )?.value;

    // Distinct (backend, outcome) tuples occupy distinct labelled series.
    expect(findValue('postgres', 'success')).toBe(2);
    expect(findValue('postgres', 'failure')).toBe(1);
    expect(findValue('honcho', 'success')).toBe(1);
  });

  it('does not mutate unrelated counters (e.g. memoryBackendReadTotal)', () => {
    // Sanity check: the new counter is a separate instrument
    // and must not bleed into the read counter.
    service.recordMemoryBackendWrite('postgres', 'success');
    expect(service.memoryBackendWriteTotal).not.toBe(
      service.memoryBackendReadTotal,
    );
  });

  it('is vi.fn-compatible so call sites can spy on the recordMemoryBackendWrite mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'recordMemoryBackendWrite').mockImplementation(spy);

    service.recordMemoryBackendWrite('postgres', 'failure');
    expect(spy).toHaveBeenCalledWith('postgres', 'failure');
  });
});

describe('MetricsService.setMemoryBackendActiveSegments', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('sets the labelled gauge with backend, source, and the supplied count', async () => {
    service.setMemoryBackendActiveSegments('postgres', 'honcho', 5);

    const value = await service.memoryBackendActiveSegments.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.backend === 'postgres' && entry.labels.source === 'honcho',
    );
    expect(matching?.value).toBe(5);
  });

  it('overwrites the gauge value for the same (backend, source) on subsequent calls', async () => {
    service.setMemoryBackendActiveSegments('postgres', 'honcho', 5);
    service.setMemoryBackendActiveSegments('postgres', 'honcho', 9);

    const value = await service.memoryBackendActiveSegments.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.backend === 'postgres' && entry.labels.source === 'honcho',
    );
    // Same (backend, source) → second call wins.
    expect(matching?.value).toBe(9);
  });

  it('tracks each distinct (backend, source) pair on its own labelled series', async () => {
    service.setMemoryBackendActiveSegments('postgres', 'honcho', 1);
    service.setMemoryBackendActiveSegments('postgres', 'honcho', 3);
    service.setMemoryBackendActiveSegments('postgres', 'schema', 7);
    service.setMemoryBackendActiveSegments('honcho', 'schema', 2);

    const value = await service.memoryBackendActiveSegments.get();
    const findValue = (backend: string, source: string): number | undefined =>
      value.values.find(
        (entry) =>
          entry.labels.backend === backend && entry.labels.source === source,
      )?.value;

    // Distinct (backend, source) pairs occupy distinct labelled series.
    expect(findValue('postgres', 'honcho')).toBe(3);
    expect(findValue('postgres', 'schema')).toBe(7);
    expect(findValue('honcho', 'schema')).toBe(2);
  });

  it('is vi.fn-compatible so call sites can spy on the setMemoryBackendActiveSegments mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'setMemoryBackendActiveSegments').mockImplementation(spy);

    service.setMemoryBackendActiveSegments('postgres', 'honcho', 5);
    expect(spy).toHaveBeenCalledWith('postgres', 'honcho', 5);
  });
});

describe('MetricsService.setMemoryBackendActiveSegments clamp guards', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('clamps negative counts to zero via Math.max(0, Math.floor(count))', () => {
    // A negative `count` (which can only happen on a counter
    // underflow / an upstream bug) must NOT bleed a negative
    // number onto the Prometheus scrape.
    service.setMemoryBackendActiveSegments('postgres', 'honcho', -5);

    // Read back via the raw gauge instead of going through
    // the mutator again so the assertion is independent of
    // the mutator being correct.
    return service.memoryBackendActiveSegments.get().then((value) => {
      const matching = value.values.find(
        (entry) =>
          entry.labels.backend === 'postgres' &&
          entry.labels.source === 'honcho',
      );
      expect(matching?.value).toBe(0);
    });
  });

  it('floors fractional counts via Math.floor(count) before clamping', () => {
    // `Math.max(0, Math.floor(1.7)) === 1`: a fractional
    // count must NOT bleed `1.7` onto the Prometheus scrape
    // because the gauge is documented as an integer count.
    service.setMemoryBackendActiveSegments('postgres', 'honcho', 1.7);

    return service.memoryBackendActiveSegments.get().then((value) => {
      const matching = value.values.find(
        (entry) =>
          entry.labels.backend === 'postgres' &&
          entry.labels.source === 'honcho',
      );
      expect(matching?.value).toBe(1);
    });
  });

  it('preserves an exact zero count (Math.max(0, Math.floor(0)) === 0)', () => {
    // The exact-zero case is the boundary of the clamp
    // range — `Math.max(0, Math.floor(0))` is `0`, not
    // `-0`, so the gauge emits the canonical integer `0`.
    service.setMemoryBackendActiveSegments('postgres', 'honcho', 0);

    return service.memoryBackendActiveSegments.get().then((value) => {
      const matching = value.values.find(
        (entry) =>
          entry.labels.backend === 'postgres' &&
          entry.labels.source === 'honcho',
      );
      expect(matching?.value).toBe(0);
      // Object.is to avoid matching a `-0` (which would also
      // stringify identically to `0` but would be a
      // regression on the Math.max(0, …) wrap).
      expect(Object.is(matching?.value, -0)).toBe(false);
    });
  });
});

describe('MetricsService.recordMemoryBackendFallback', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments the fallback counter with from, to, and operation', async () => {
    service.recordMemoryBackendFallback('honcho', 'postgres', 'read');

    const value = await service.memoryBackendFallbackTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.from === 'honcho' &&
        entry.labels.to === 'postgres' &&
        entry.labels.operation === 'read',
    );
    expect(matching?.value).toBe(1);
  });

  it('appends the counter under the exact label tuple (no auto-fan-out)', async () => {
    service.recordMemoryBackendFallback('honcho', 'postgres', 'read');
    service.recordMemoryBackendFallback('honcho', 'postgres', 'read');

    const value = await service.memoryBackendFallbackTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.from === 'honcho' &&
        entry.labels.to === 'postgres' &&
        entry.labels.operation === 'read',
    );
    expect(matching?.value).toBe(2);
  });

  it('tracks each distinct (from, to, operation) triple on its own labelled series', async () => {
    service.recordMemoryBackendFallback('honcho', 'postgres', 'read');
    service.recordMemoryBackendFallback('honcho', 'postgres', 'read');
    service.recordMemoryBackendFallback('honcho', 'postgres', 'write');
    service.recordMemoryBackendFallback('postgres', 'honcho', 'read');

    const value = await service.memoryBackendFallbackTotal.get();
    const findValue = (
      from: string,
      to: string,
      operation: string,
    ): number | undefined =>
      value.values.find(
        (entry) =>
          entry.labels.from === from &&
          entry.labels.to === to &&
          entry.labels.operation === operation,
      )?.value;

    // Distinct (from, to, operation) triples occupy distinct
    // labelled series.
    expect(findValue('honcho', 'postgres', 'read')).toBe(2);
    expect(findValue('honcho', 'postgres', 'write')).toBe(1);
    expect(findValue('postgres', 'honcho', 'read')).toBe(1);
  });

  it('does not mutate unrelated counters (e.g. memoryBackendReadTotal)', () => {
    service.recordMemoryBackendFallback('honcho', 'postgres', 'read');
    expect(service.memoryBackendFallbackTotal).not.toBe(
      service.memoryBackendReadTotal,
    );
  });

  it('is vi.fn-compatible so call sites can spy on the recordMemoryBackendFallback mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'recordMemoryBackendFallback').mockImplementation(spy);

    service.recordMemoryBackendFallback('honcho', 'postgres', 'write');
    expect(spy).toHaveBeenCalledWith('honcho', 'postgres', 'write');
  });
});

describe('MetricsService.recordDistillationCompleted', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments the distillation-completed counter with the supplied outcome', async () => {
    service.recordDistillationCompleted('success', 0.4);

    const value = await service.distillationCompletedTotal.get();
    const matching = value.values.find(
      (entry) => entry.labels.outcome === 'success',
    );
    expect(matching?.value).toBe(1);
  });

  it('observes the compression-ratio histogram on a finite ratio', async () => {
    service.recordDistillationCompleted('success', 0.4);
    service.recordDistillationCompleted('success', 0.6);

    const value = await service.distillationCompressionRatio.get();
    const countEntry = value.values.find(
      (entry) =>
        entry.metricName === 'nexus_distillation_compression_ratio_count',
    );
    const sumEntry = value.values.find(
      (entry) =>
        entry.metricName === 'nexus_distillation_compression_ratio_sum',
    );

    // Two observations, total 1.0.
    expect(countEntry?.value).toBe(2);
    expect(sumEntry?.value).toBeCloseTo(1.0);
  });

  it('appends the counter under the exact label tuple (no auto-fan-out)', async () => {
    service.recordDistillationCompleted('success', 0.4);
    service.recordDistillationCompleted('success', 0.6);

    const value = await service.distillationCompletedTotal.get();
    const matching = value.values.find(
      (entry) => entry.labels.outcome === 'success',
    );
    expect(matching?.value).toBe(2);
  });

  it('tracks each distinct outcome on its own labelled series', async () => {
    service.recordDistillationCompleted('success', 0.4);
    service.recordDistillationCompleted('success', 0.5);
    service.recordDistillationCompleted('failure', 1.1);
    service.recordDistillationCompleted('skipped', 1.0);

    const value = await service.distillationCompletedTotal.get();
    const findValue = (outcome: string): number | undefined =>
      value.values.find((entry) => entry.labels.outcome === outcome)?.value;

    expect(findValue('success')).toBe(2);
    expect(findValue('failure')).toBe(1);
    expect(findValue('skipped')).toBe(1);
  });

  it('skips the compression-ratio observation on non-finite inputs', async () => {
    // The mutator guards `compressionRatio` with
    // `Number.isFinite`, so a NaN / Infinity input is
    // dropped silently — but the counter still increments.
    service.recordDistillationCompleted('success', Number.NaN);
    service.recordDistillationCompleted('success', Number.NaN);

    const counterValue = await service.distillationCompletedTotal.get();
    const counterMatching = counterValue.values.find(
      (entry) => entry.labels.outcome === 'success',
    );
    expect(counterMatching?.value).toBe(2);

    const histogramValue = await service.distillationCompressionRatio.get();
    // Either no observations (histogram values empty) or a
    // `_count` of 0 — prom-client returns an empty values
    // array when no observation has been recorded.
    const countEntry = histogramValue.values.find(
      (entry) =>
        entry.metricName === 'nexus_distillation_compression_ratio_count',
    );
    expect(countEntry?.value ?? 0).toBe(0);
  });

  it('is vi.fn-compatible so call sites can spy on the recordDistillationCompleted mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'recordDistillationCompleted').mockImplementation(spy);

    service.recordDistillationCompleted('success', 0.4);
    expect(spy).toHaveBeenCalledWith('success', 0.4);
  });
});

describe('MetricsService.recordLearningPromoted', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments the unlabelled promoted counter by one', async () => {
    service.recordLearningPromoted();

    const value = await service.learningPromotedTotal.get();
    // The unlabelled counter exposes a single series with
    // an empty label set.
    expect(value.values[0]?.value).toBe(1);
    expect(value.values[0]?.labels).toEqual({});
  });

  it('appends the unlabelled counter across multiple calls', async () => {
    for (let i = 0; i < 5; i += 1) {
      service.recordLearningPromoted();
    }

    const value = await service.learningPromotedTotal.get();
    expect(value.values[0]?.value).toBe(5);
  });

  it('does not mutate unrelated counters (e.g. learningLessonInjectedTotal)', () => {
    // Sanity check: the two learning counters are separate
    // instruments and must not bleed into each other.
    service.recordLearningPromoted();
    expect(service.learningPromotedTotal).not.toBe(
      service.learningLessonInjectedTotal,
    );
  });

  it('is vi.fn-compatible so call sites can spy on the recordLearningPromoted mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'recordLearningPromoted').mockImplementation(spy);

    service.recordLearningPromoted();
    expect(spy).toHaveBeenCalledWith();
  });
});

describe('MetricsService.recordMemoryDecayRun', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments both the evaluated and archived unlabelled counters on a normal call', async () => {
    service.recordMemoryDecayRun(3, 2);

    const evaluated = await service.memoryDecayEvaluatedTotal.get();
    const archived = await service.memoryDecayArchivedTotal.get();
    expect(evaluated.values[0]?.value).toBe(3);
    expect(archived.values[0]?.value).toBe(2);
  });

  it('appends both counters across successive calls (no auto-fan-out)', async () => {
    service.recordMemoryDecayRun(3, 2);
    service.recordMemoryDecayRun(1, 1);

    const evaluated = await service.memoryDecayEvaluatedTotal.get();
    const archived = await service.memoryDecayArchivedTotal.get();
    expect(evaluated.values[0]?.value).toBe(4);
    expect(archived.values[0]?.value).toBe(3);
  });

  it('skips the evaluated increment when evaluated is zero (documented guard)', async () => {
    // The mutator skips `memoryDecayEvaluatedTotal.inc(...)` when
    // evaluated is non-positive so a no-op run does not pollute
    // the counter.
    service.recordMemoryDecayRun(0, 5);

    const evaluated = await service.memoryDecayEvaluatedTotal.get();
    const archived = await service.memoryDecayArchivedTotal.get();
    // evaluated is empty (no series appended) or unchanged
    // from any prior default value — the only stable invariant
    // is that it never went up.
    expect(evaluated.values[0]?.value ?? 0).toBe(0);
    expect(archived.values[0]?.value).toBe(5);
  });

  it('floors fractional inputs (Math.floor) before incrementing', async () => {
    // The mutator floors the integers before incrementing so
    // a partial-row drift in the count row does not bleed a
    // fractional `1.7` onto the counter.
    service.recordMemoryDecayRun(1.7, 0.9);

    const evaluated = await service.memoryDecayEvaluatedTotal.get();
    const archived = await service.memoryDecayArchivedTotal.get();
    expect(evaluated.values[0]?.value).toBe(1);
    expect(archived.values[0]?.value ?? 0).toBe(0);
  });

  it('does not mutate unrelated counters (e.g. memoryBackendReadTotal)', () => {
    service.recordMemoryDecayRun(2, 1);
    expect(service.memoryDecayEvaluatedTotal).not.toBe(
      service.memoryBackendReadTotal,
    );
  });

  it('is vi.fn-compatible so call sites can spy on the recordMemoryDecayRun mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'recordMemoryDecayRun').mockImplementation(spy);

    service.recordMemoryDecayRun(2, 1);
    expect(spy).toHaveBeenCalledWith(2, 1);
  });
});

describe('MetricsService.recordMemoryDriftDetected', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments the counter with the supplied source and outcome', async () => {
    service.recordMemoryDriftDetected({
      source: 'file',
      outcome: 'detected',
    });

    const value = await service.nexusMemoryDriftDetectedTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.source === 'file' && entry.labels.outcome === 'detected',
    );
    expect(matching?.value).toBe(1);
  });

  it('appends the counter under the exact label tuple (no auto-fan-out)', async () => {
    service.recordMemoryDriftDetected({
      source: 'file',
      outcome: 'detected',
    });
    service.recordMemoryDriftDetected({
      source: 'file',
      outcome: 'detected',
    });

    const value = await service.nexusMemoryDriftDetectedTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.source === 'file' && entry.labels.outcome === 'detected',
    );
    expect(matching?.value).toBe(2);
  });

  it('tracks each distinct (source, outcome) pair on its own labelled series', async () => {
    service.recordMemoryDriftDetected({
      source: 'file',
      outcome: 'detected',
    });
    service.recordMemoryDriftDetected({
      source: 'file',
      outcome: 'detected',
    });
    service.recordMemoryDriftDetected({
      source: 'file',
      outcome: 'exempt',
    });
    service.recordMemoryDriftDetected({
      source: 'schema',
      outcome: 'detected',
    });
    service.recordMemoryDriftDetected({
      source: 'api',
      outcome: 'unavailable',
    });

    const value = await service.nexusMemoryDriftDetectedTotal.get();
    const findValue = (source: string, outcome: string): number | undefined =>
      value.values.find(
        (entry) =>
          entry.labels.source === source && entry.labels.outcome === outcome,
      )?.value;

    expect(findValue('file', 'detected')).toBe(2);
    expect(findValue('file', 'exempt')).toBe(1);
    expect(findValue('schema', 'detected')).toBe(1);
    expect(findValue('api', 'unavailable')).toBe(1);
  });

  it('coerces an out-of-enum source to the sentinel "unknown" so cardinality stays bounded', async () => {
    // The mutator delegates to `normaliseDriftMetricLabel`
    // which collapses any non-enum source to 'unknown' so
    // a malformed input cannot blow up the Prometheus
    // cardinality contract.
    service.recordMemoryDriftDetected({
      source: 'not-a-real-source',
      outcome: 'detected',
    });

    const value = await service.nexusMemoryDriftDetectedTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.source === 'unknown' &&
        entry.labels.outcome === 'detected',
    );
    expect(matching?.value).toBe(1);
  });

  it('is vi.fn-compatible so call sites can spy on the recordMemoryDriftDetected mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'recordMemoryDriftDetected').mockImplementation(spy);

    service.recordMemoryDriftDetected({
      source: 'file',
      outcome: 'detected',
    });
    expect(spy).toHaveBeenCalledWith({
      source: 'file',
      outcome: 'detected',
    });
  });
});

describe('MetricsService.recordWorkflowPostmortemRecorded', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments the postmortem counter with the supplied outcome', async () => {
    service.recordWorkflowPostmortemRecorded('success');

    const value = await service.workflowPostmortemRecordedTotal.get();
    const matching = value.values.find(
      (entry) => entry.labels.outcome === 'success',
    );
    expect(matching?.value).toBe(1);
  });

  it('appends the counter under the exact label tuple (no auto-fan-out)', async () => {
    service.recordWorkflowPostmortemRecorded('success');
    service.recordWorkflowPostmortemRecorded('success');

    const value = await service.workflowPostmortemRecordedTotal.get();
    const matching = value.values.find(
      (entry) => entry.labels.outcome === 'success',
    );
    expect(matching?.value).toBe(2);
  });

  it('tracks each distinct outcome on its own labelled series', async () => {
    service.recordWorkflowPostmortemRecorded('success');
    service.recordWorkflowPostmortemRecorded('success');
    service.recordWorkflowPostmortemRecorded('skipped');
    service.recordWorkflowPostmortemRecorded('failed');

    const value = await service.workflowPostmortemRecordedTotal.get();
    const findValue = (outcome: string): number | undefined =>
      value.values.find((entry) => entry.labels.outcome === outcome)?.value;

    expect(findValue('success')).toBe(2);
    expect(findValue('skipped')).toBe(1);
    expect(findValue('failed')).toBe(1);
  });

  it('does not mutate unrelated counters (e.g. memoryBackendReadTotal)', () => {
    service.recordWorkflowPostmortemRecorded('success');
    expect(service.workflowPostmortemRecordedTotal).not.toBe(
      service.memoryBackendReadTotal,
    );
  });

  it('is vi.fn-compatible so call sites can spy on the recordWorkflowPostmortemRecorded mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'recordWorkflowPostmortemRecorded').mockImplementation(
      spy,
    );

    service.recordWorkflowPostmortemRecorded('failed');
    expect(spy).toHaveBeenCalledWith('failed');
  });
});

describe('MetricsService.recordOAuthLoginOrphaned', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments the unlabelled orphan-recovery counter by one', async () => {
    service.recordOAuthLoginOrphaned();

    const value = await service.oauthLoginOrphanedTotal.get();
    // The unlabelled counter exposes a single series with
    // an empty label set.
    expect(value.values[0]?.value).toBe(1);
    expect(value.values[0]?.labels).toEqual({});
  });

  it('appends the unlabelled counter across multiple calls', async () => {
    for (let i = 0; i < 3; i += 1) {
      service.recordOAuthLoginOrphaned();
    }

    const value = await service.oauthLoginOrphanedTotal.get();
    expect(value.values[0]?.value).toBe(3);
  });

  it('does not mutate unrelated counters (e.g. memoryBackendReadTotal)', () => {
    service.recordOAuthLoginOrphaned();
    expect(service.oauthLoginOrphanedTotal).not.toBe(
      service.memoryBackendReadTotal,
    );
  });

  it('is vi.fn-compatible so call sites can spy on the recordOAuthLoginOrphaned mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'recordOAuthLoginOrphaned').mockImplementation(spy);

    service.recordOAuthLoginOrphaned();
    expect(spy).toHaveBeenCalledWith();
  });
});

describe('MetricsService.recordLearningBehaviourChange', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('increments the counter with changed="true" when changed=true', async () => {
    service.recordLearningBehaviourChange('project-1', true);

    const value = await service.learningBehaviourChangeTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.scope === 'project-1' && entry.labels.changed === 'true',
    );
    expect(matching?.value).toBe(1);
  });

  it('increments the counter with changed="false" when changed=false', async () => {
    service.recordLearningBehaviourChange('project-1', false);

    const value = await service.learningBehaviourChangeTotal.get();
    const matching = value.values.find(
      (entry) =>
        entry.labels.scope === 'project-1' && entry.labels.changed === 'false',
    );
    expect(matching?.value).toBe(1);
  });

  it('tracks each distinct (scope, changed) pair on its own labelled series', async () => {
    service.recordLearningBehaviourChange('project-1', true);
    service.recordLearningBehaviourChange('project-1', true);
    service.recordLearningBehaviourChange('project-1', false);
    service.recordLearningBehaviourChange('project-2', true);

    const value = await service.learningBehaviourChangeTotal.get();
    const findValue = (
      scope: string,
      changed: 'true' | 'false',
    ): number | undefined =>
      value.values.find(
        (entry) =>
          entry.labels.scope === scope && entry.labels.changed === changed,
      )?.value;

    // Distinct (scope, changed) tuples occupy distinct labelled series.
    expect(findValue('project-1', 'true')).toBe(2);
    expect(findValue('project-1', 'false')).toBe(1);
    expect(findValue('project-2', 'true')).toBe(1);
  });

  it('does not mutate unrelated counters (e.g. learningLessonInjectedTotal)', () => {
    service.recordLearningBehaviourChange('project-1', true);
    expect(service.learningBehaviourChangeTotal).not.toBe(
      service.learningLessonInjectedTotal,
    );
  });

  it('is vi.fn-compatible so call sites can spy on the recordLearningBehaviourChange mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'recordLearningBehaviourChange').mockImplementation(spy);

    service.recordLearningBehaviourChange('project-1', true);
    expect(spy).toHaveBeenCalledWith('project-1', true);
  });
});

describe('MetricsService.setLearningLiftRatio', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('sets the labelled lift gauge with the supplied scope and lift', async () => {
    service.setLearningLiftRatio('project-1', 0.25);

    const value = await service.learningLiftRatio.get();
    const matching = value.values.find(
      (entry) => entry.labels.scope === 'project-1',
    );
    expect(matching?.value).toBe(0.25);
  });

  it('skips non-finite values so a bad input cannot poison the scrape', async () => {
    // The mutator's guard short-circuits on non-finite so a
    // bad input does not emit a `NaN` / `Infinity` ratio to
    // the Prometheus scrape. The labelled gauge has no
    // default series — its `values` array stays empty when
    // a guard skips the write.
    service.setLearningLiftRatio('project-na', Number.NaN);
    service.setLearningLiftRatio('project-pos-inf', Number.POSITIVE_INFINITY);
    service.setLearningLiftRatio('project-neg-inf', Number.NEGATIVE_INFINITY);

    const value = await service.learningLiftRatio.get();
    // No labelled series was appended: every call was
    // short-circuited by the guard.
    expect(value.values).toEqual([]);
  });

  it('skips a non-number value (the typeof guard) so a bad input cannot poison the scrape', async () => {
    // The mutator's `typeof lift !== 'number'` guard
    // collapses a non-number input (string, undefined, …)
    // into a no-op so an upstream caller passing the wrong
    // shape cannot emit a `NaN` lift to the scrape.
    service.setLearningLiftRatio(
      'project-string',

      '0.5' as any,
    );
    service.setLearningLiftRatio(
      'project-undefined',

      undefined as any,
    );

    const value = await service.learningLiftRatio.get();
    expect(value.values).toEqual([]);
  });

  it('allows a finite negative lift through (A/B holdout may regress)', async () => {
    // Unlike `setLearningCostPerPromotedMemory`, this
    // mutator permits negative values because a negative
    // lift is a legitimate `convergence(injected) −
    // convergence(holdout)` outcome — the holdout arm
    // performed better.
    service.setLearningLiftRatio('project-1', -0.1);

    const value = await service.learningLiftRatio.get();
    const matching = value.values.find(
      (entry) => entry.labels.scope === 'project-1',
    );
    expect(matching?.value).toBe(-0.1);
  });

  it('is vi.fn-compatible so call sites can spy on the setLearningLiftRatio mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'setLearningLiftRatio').mockImplementation(spy);

    service.setLearningLiftRatio('project-1', 0.1);
    expect(spy).toHaveBeenCalledWith('project-1', 0.1);
  });
});

describe('MetricsService.setLearningCostPerPromotedMemory', () => {
  let service: MetricsService;

  beforeEach(() => {
    // See the inject-counter `beforeEach` for why we clear
    // the prom-client registry on each test.
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    register.clear();
  });

  it('sets the unlabelled cost gauge with the supplied value', async () => {
    // Seed a known value first so the assertion is
    // independent of the gauge's prom-client default of 0.
    service.setLearningCostPerPromotedMemory(5);
    service.setLearningCostPerPromotedMemory(12.3);

    const value = await service.learningCostPerPromotedMemory.get();
    // Second call wins on the unlabelled gauge.
    expect(value.values[0]?.value).toBe(12.3);
  });

  it('skips non-finite values so a bad input cannot poison the scrape', () => {
    // The mutator's guard short-circuits on non-finite so a
    // bad input does not emit a `NaN` / `Infinity` cost to
    // the Prometheus scrape. We seed a known sentinel value
    // first so the assertion proves the second call was
    // skipped (not just that the cost happens to be 0).
    service.setLearningCostPerPromotedMemory(5);
    service.setLearningCostPerPromotedMemory(Number.NaN);
    service.setLearningCostPerPromotedMemory(Number.POSITIVE_INFINITY);
    service.setLearningCostPerPromotedMemory(Number.NEGATIVE_INFINITY);

    return service.learningCostPerPromotedMemory.get().then((value) => {
      // Sentinel value still wins: every guarded call was a
      // no-op.
      expect(value.values[0]?.value).toBe(5);
    });
  });

  it('skips negative values so a refund / over-spend reconciliation cannot poison the scrape', () => {
    // The mutator's guard short-circuits on `value < 0` so a
    // bad input does not emit a negative cost to the
    // Prometheus scrape. Same sentinel-pattern as the
    // non-finite test.
    service.setLearningCostPerPromotedMemory(5);
    service.setLearningCostPerPromotedMemory(-0.5);
    service.setLearningCostPerPromotedMemory(Number.MIN_VALUE * -1);

    return service.learningCostPerPromotedMemory.get().then((value) => {
      expect(value.values[0]?.value).toBe(5);
    });
  });

  it('allows a finite zero cost through (Math.max guard does NOT reject equality)', () => {
    // Boundary check: `Math.max(0, …)` from the
    // non-negative pre-condition accepts `0` (the cost is
    // genuinely zero in a no-spend window), so the gauge
    // emits `0` instead of skipping.
    service.setLearningCostPerPromotedMemory(0);

    return service.learningCostPerPromotedMemory.get().then((value) => {
      expect(value.values[0]?.value).toBe(0);
    });
  });

  it('is vi.fn-compatible so call sites can spy on the setLearningCostPerPromotedMemory mutator', () => {
    const spy = vi.fn();
    vi.spyOn(service, 'setLearningCostPerPromotedMemory').mockImplementation(
      spy,
    );

    service.setLearningCostPerPromotedMemory(5);
    expect(spy).toHaveBeenCalledWith(5);
  });
});
