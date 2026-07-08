/**
 * Pure (I/O-free) helpers for the daily convergence recorder
 * (work item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2,
 * AC-1 + AC-3 + AC-4).
 *
 * Every export here is a pure function — no NestJS, no
 * repository, no settings I/O. The recorder service consumes
 * them inside `tick()` so the helpers can be exhaustively
 * unit-tested against the 5-row matrix (`helpers.spec.ts`)
 * without spinning up a NestJS module.
 *
 * Three responsibilities live here:
 *
 *   1. {@link buildUsefulnessHistogram} — turn a list of
 *      rolling-window usefulness ratios into the JSONB
 *      `usefulness_histogram` payload the recorder persists
 *      on `learning_measurement_snapshots` (AC-1).
 *   2. {@link buildRetentionDecisionDistribution} — turn a
 *      list of {@link decideMemoryRetentionKeep} verdicts
 *      into the JSONB `retention_decision_distribution`
 *      payload (AC-1).
 *   3. {@link recalculateUsefulnessThreshold} — recompute the
 *      usefulness threshold the recorder writes onto the
 *      `memory_retention_policy` singleton row (AC-3). Returns
 *      `{ threshold, sampleSize }` so the caller (the service)
 *      can hand both to the repository's
 *      `upsertIfChanged(...)` method without losing the
 *      sample-size leg.
 *
 * JSONB shape contract (AC-1):
 *
 *   `usefulness_histogram`
 *     Keys are STRINGIFIED bin indices (NOT numbers) because
 *     JSON object keys are always strings in JSON / JSONB.
 *     The shape is `{ "0": countInBin0, "1": countInBin1,
 *     ..., "9": countInBin9, "unknown": countOfNullOrNonFinite
 *     }` — 10 numeric buckets of width 0.1 covering [0, 1]
 *     plus the `unknown` bin for `null` / `NaN` /
 *     out-of-range inputs. A value exactly at `1.0` lands in
 *     bin `9` (the inclusive upper edge); a value just above
 *     `1.0` lands in `unknown`.
 *
 *   `retention_decision_distribution`
 *     Keys are the verbatim reason codes the
 *     {@link decideMemoryRetentionKeep} helper emits
 *     (`pinned`, `injected_and_helped`, `useful`,
 *     `insufficient_samples`, `low_usefulness`, `no_votes`).
 *     A null verdict (no input supplied) is counted under the
 *     literal key `null` so the distribution can distinguish
 *     "the predicate was not consulted" from "every verdict
 *     was no_votes".
 */

/** Number of buckets in the usefulness histogram (0.1-wide, covering [0, 1]). */
export const USEFULNESS_HISTOGRAM_BIN_COUNT = 10;

/** Literal key used in the JSONB histogram for `null` / non-finite / out-of-range inputs. */
export const USEFULNESS_HISTOGRAM_UNKNOWN_KEY = 'unknown';

/**
 * Closed enum of the verbatim reason codes the
 * `decideMemoryRetentionKeep` helper emits. Mirrors the
 * `DECAY_KEEP_REASONS` constant in
 * `apps/api/src/memory/memory-decay.value-predicate.ts`;
 * duplicated here so this file stays I/O-free AND the
 * recorder never has to import the value-predicate module
 * just to iterate the reason code set.
 *
 * Order matters: it is the iteration order of the
 * `retention_decision_distribution` JSONB payload, so
 * dashboards see the same key order on every snapshot.
 */
export const RETENTION_DECISION_REASON_KEYS = [
  'pinned',
  'injected_and_helped',
  'useful',
  'insufficient_samples',
  'low_usefulness',
  'no_votes',
] as const;

/**
 * Closed enum of the `RETENTION_DECISION_REASON_KEYS`
 * entries that mean the value predicate decided to KEEP
 * the segment (`keep: true`). The recorder's
 * `bound_to_reused_score` aggregation divides the
 * cardinality of this set (within a `decisionReasons`
 * array) by the total NON-NULL verdict count to produce
 * the per-window keep-fraction (AC-1).
 *
 * Mirrors the `keep === true` branches of
 * `decideMemoryRetentionKeep` in
 * `apps/api/src/memory/memory-decay.value-predicate.ts`;
 * duplicated here so the helper module remains I/O-free
 * AND so a future reason-code rename is caught by both
 * the helpers spec and the value-predicate spec.
 *
 * Order matters only for documentation — the keep-fraction
 * aggregator iterates with `Set.has(reason)` and is
 * order-independent.
 */
export const RETENTION_DECISION_KEEP_REASON_KEYS = [
  'pinned',
  'injected_and_helped',
  'useful',
] as const;

/**
 * The `RETENTION_DECISION_KEEP_REASON_KEYS` tuple turned
 * into a `Set` for O(1) `has` lookups in the
 * `bound_to_reused_score` keep-fraction aggregator.
 * Built once at module load so the aggregator avoids
 * reconstructing it on every recorder pass.
 */
export const RETENTION_DECISION_KEEP_REASON_SET: ReadonlySet<
  (typeof RETENTION_DECISION_KEEP_REASON_KEYS)[number]
> = new Set(RETENTION_DECISION_KEEP_REASON_KEYS);

/** Literal key used in the JSONB distribution for `null` verdicts. */
export const RETENTION_DECISION_NULL_KEY = 'null';

/**
 * Compute the per-window `bound_to_reused_score`
 * keep-fraction the recorder persists on
 * `learning_measurement_snapshots` (AC-1, milestone 1).
 *
 * The keep-fraction is the cardinality of the
 * `RETENTION_DECISION_KEEP_REASON_KEYS` set intersected
 * with the supplied `decisionReasons` array, divided by
 * the total NON-NULL verdict count. Concretely:
 *
 *   - `decisionReasons = []` (no segments scanned) →
 *     `0` (deterministic so a no-verdicts pass cannot
 *     produce a `NaN` / `Infinity` row).
 *   - All `null` / `undefined` entries → `0` (the
 *     denominator is the count of non-null entries; an
 *     all-null input has a denominator of zero, and the
 *     `0 / 0` short-circuit returns `0` instead of `NaN`).
 *   - Mixed keep + drop verdicts → the keep mass divided
 *     by the total non-null mass — e.g. `['pinned',
 *     'useful', 'insufficient_samples', 'low_usefulness',
 *     'no_votes']` (2 keep / 3 drop) → `0.4`.
 *   - All keep → `1` (e.g. `['pinned', 'useful',
 *     'injected_and_helped']` → `1`).
 *
 * The function is pure and never throws — a garbage
 * `decisionReasons` entry that is not a known reason code
 * is counted toward the denominator but NOT the numerator
 * (matches the recorder's per-window semantics: an
 * unknown verdict is a real scan that produced a
 * no-keep verdict, not a no-scan).
 *
 * Note: callers must apply the recorder's
 * `clamp01` + `roundToSixDecimals` + `.toString()`
 * pipeline before persisting; this helper returns the
 * raw JS `number` so the test seam can pin the
 * floating-point value directly.
 */
export function computeKeepFraction(
  decisionReasons: ReadonlyArray<string | null | undefined>,
): number {
  const nonNull = decisionReasons.filter(
    (reason): reason is string => typeof reason === 'string',
  );
  if (nonNull.length === 0) {
    return 0;
  }
  let keepCount = 0;
  for (const reason of nonNull) {
    if (
      RETENTION_DECISION_KEEP_REASON_SET.has(
        reason as (typeof RETENTION_DECISION_KEEP_REASON_KEYS)[number],
      )
    ) {
      keepCount += 1;
    }
  }
  return keepCount / nonNull.length;
}

/**
 * Build the JSONB `usefulness_histogram` payload the recorder
 * persists on `learning_measurement_snapshots` (AC-1).
 *
 *   - Returns `{ "0": n0, "1": n1, ..., "9": n9, "unknown": nu }`.
 *   - 10 buckets of width 0.1 covering `[0, 1]`; a value
 *     exactly at `1.0` lands in bin `9` (inclusive upper
 *     edge), a value above `1.0` lands in `unknown`.
 *   - `null`, `NaN`, `+/-Infinity`, and `undefined` inputs
 *     are all counted under `unknown` so a feedback row with
 *     garbage data cannot silently inflate a numeric bucket.
 *   - An empty `values` array returns an all-zero payload so
 *     the snapshot row still carries the histogram shape and
 *     the operator UI does not have to special-case the
 *     "no votes yet" rendering.
 *
 * The function is pure and never throws — it is safe to call
 * from the recorder's `tick()` without a try/catch wrapper.
 */
export function buildUsefulnessHistogram(
  values: ReadonlyArray<number | null | undefined>,
): Record<string, number> {
  const histogram: Record<string, number> = {
    ...zeroBinCounts(),
    [USEFULNESS_HISTOGRAM_UNKNOWN_KEY]: 0,
  };
  for (const value of values) {
    const key = classifyUsefulnessValue(value);
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  return histogram;
}

/**
 * Build the JSONB `retention_decision_distribution` payload the
 * recorder persists on `learning_measurement_snapshots` (AC-1).
 *
 *   - Returns `{ pinned: n, injected_and_helped: n, useful: n,
 *     insufficient_samples: n, low_usefulness: n, no_votes: n,
 *     null: n }`.
 *   - `null` / `undefined` verdict entries are counted under
 *     the literal key `null` so the distribution can
 *     distinguish "the predicate was not consulted" from
 *     "every verdict was no_votes".
 *   - An empty `decisions` array returns an all-zero payload
 *     so the snapshot row still carries the distribution
 *     shape and the operator UI does not have to special-case
 *     the "no segments scanned" rendering.
 *
 * The function is pure and never throws — it is safe to call
 * from the recorder's `tick()` without a try/catch wrapper.
 */
export function buildRetentionDecisionDistribution(
  decisions: ReadonlyArray<string | null | undefined>,
): Record<string, number> {
  const distribution: Record<string, number> = {
    ...zeroReasonCounts(),
    [RETENTION_DECISION_NULL_KEY]: 0,
  };
  for (const reason of decisions) {
    if (reason === null || reason === undefined) {
      distribution[RETENTION_DECISION_NULL_KEY] =
        (distribution[RETENTION_DECISION_NULL_KEY] ?? 0) + 1;
      continue;
    }
    distribution[reason] = (distribution[reason] ?? 0) + 1;
  }
  return distribution;
}

/**
 * Recalculate the usefulness threshold the recorder writes
 * onto the `memory_retention_policy` singleton row (AC-3).
 *
 *   - Returns `{ threshold, sampleSize }` so the caller can
 *     hand both to `MemoryRetentionPolicyRepository.upsertIfChanged`.
 *   - If `values.length < minSamples` the recorder MUST NOT
 *     recalibrate — the function returns
 *     `{ threshold: defaultThreshold, sampleSize: values.length }`
 *     so the caller can either no-op the upsert or hand the
 *     default to the repository, which will then take the
 *     `applied` branch when the singleton is fresh (the seed
 *     migration guarantees one row exists).
 *   - Otherwise the new threshold is the **`min`** of the
 *     observed usefulness ratios, rounded to 6 decimal places
 *     via `Number.EPSILON`-safe `Math.round(value * 1e6) / 1e6`
 *     (so a clean `0.6` survives float-drift and the
 *     ε-comparison in the repository behaves predictably).
 *     The `min` choice matches the existing
 *     `decideMemoryRetentionKeep` semantics — the threshold is
 *     the floor below which a row is `low_usefulness`, so
 *     picking the empirical minimum keeps the predicate's
 *     "useful" set stable across calibration passes.
 *   - `null` / `NaN` / non-finite entries in `values` are
 *     filtered out before the min is computed (they do not
 *     count toward `sampleSize` either, so a row of garbage
 *     votes cannot push a below-floor recalibration through).
 *
 * The function is pure and never throws — it is safe to call
 * from the recorder's `tick()` without a try/catch wrapper.
 */
export function recalculateUsefulnessThreshold(
  values: ReadonlyArray<number | null | undefined>,
  minSamples: number,
  defaultThreshold: number,
): { threshold: number; sampleSize: number } {
  const finite = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  if (finite.length < minSamples) {
    return { threshold: defaultThreshold, sampleSize: finite.length };
  }
  const minObserved = finite.reduce(
    (acc, value) => (value < acc ? value : acc),
    Number.POSITIVE_INFINITY,
  );
  return {
    threshold: roundToSixDecimals(minObserved),
    sampleSize: finite.length,
  };
}

/**
 * Classify a single usefulness value into a histogram bin key.
 * Internal helper for {@link buildUsefulnessHistogram}.
 *
 *   - `null` / `undefined` / `NaN` / non-finite → `unknown`.
 *   - Values above `1.0` → `unknown` (the inclusive upper edge
 *     is `1.0`; bin `9` covers `[0.9, 1.0]`).
 *   - Values below `0.0` → `unknown` (defensive — the feedback
 *     service should never emit a negative ratio).
 *   - Otherwise `Math.min(binCount - 1, Math.floor(value * 10))`.
 *
 * Implementation note: we use `value * 10` (NOT `value / 0.1`)
 * because `0.7 / 0.1` evaluates to `6.999999999999999` in
 * IEEE 754 (a classic float-precision artifact), which would
 * mis-bucket `0.7` into bin `6` instead of bin `7`. The
 * `value * 10` form survives the float-precision artefact
 * (`0.7 * 10 = 7.000000000000001`, which `Math.floor` correctly
 * rounds down to `7`).
 *
 * Exported for unit-test reuse so the bucket-edge cases can be
 * pinned without rebuilding the full histogram in every test.
 */
export function classifyUsefulnessValue(
  value: number | null | undefined,
): string {
  if (
    value === null ||
    value === undefined ||
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    return USEFULNESS_HISTOGRAM_UNKNOWN_KEY;
  }
  // Inclusive upper edge: a value exactly at 1.0 lands in bin 9
  // (the last bucket), not in the `unknown` overflow bin.
  if (value === 1) {
    return String(USEFULNESS_HISTOGRAM_BIN_COUNT - 1);
  }
  const bin = Math.min(
    USEFULNESS_HISTOGRAM_BIN_COUNT - 1,
    Math.floor(value * 10),
  );
  return String(bin);
}

/**
 * Round a finite number to 6 decimal places via the
 * `Math.round(value * 1e6) / 1e6` idiom (matches the
 * `1e-6` ε-comparison constant in
 * `LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON` so the
 * recorder's threshold comparison is round-trip stable).
 *
 * Returns the original value when it is `null`, `undefined`,
 * or non-finite (the helper never throws — the caller can
 * decide whether a non-finite `threshold` is a no-op or a
 * hard error).
 */
function roundToSixDecimals(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Build a fresh all-zero `{ "0": 0, ..., "9": 0, "unknown": 0 }` shape. */
function zeroBinCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let index = 0; index < USEFULNESS_HISTOGRAM_BIN_COUNT; index += 1) {
    counts[String(index)] = 0;
  }
  counts[USEFULNESS_HISTOGRAM_UNKNOWN_KEY] = 0;
  return counts;
}

/** Build a fresh all-zero reason-count shape (every reason code + the `null` key). */
function zeroReasonCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of RETENTION_DECISION_REASON_KEYS) {
    counts[key] = 0;
  }
  counts[RETENTION_DECISION_NULL_KEY] = 0;
  return counts;
}
