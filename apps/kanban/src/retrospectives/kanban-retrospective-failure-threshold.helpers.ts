/**
 * Pure helper functions used by
 * {@link KanbanRetrospectiveFailureThresholdService}. Extracted from
 * the service file (which is at the project's `max-lines` lint cap)
 * so the sliding/fixed window math and the dedupe/cooldown
 * bookkeeping stay easy to reason about.
 *
 * Work item: 2ec2799b-b003-4f5d-bca4-d56d3ef601dd (WI-2026-063,
 * OPEN_QUESTIONS K2 + K4 + K5).
 */

/** Failure-timestamp list key on orchestration metadata. */
export const FAILURE_TIMESTAMPS_METADATA_KEY =
  "failure_threshold_timestamps";

/** Last-emitted `(projectId, windowStartEpoch)` dedupe key. */
export const LAST_EMITTED_WINDOW_METADATA_KEY =
  "failure_threshold_last_emitted_window";

/** Last-emitted epoch-seconds timestamp for cooldown bookkeeping. */
export const LAST_EMITTED_AT_METADATA_KEY =
  "failure_threshold_last_emitted_at";

/**
 * Compute the start of the current failure-counting window in epoch
 * seconds (1-minute granularity). For `sliding`, the window starts
 * at `(now - WindowSeconds)` floored to the nearest 60s; for `fixed`,
 * the window starts at the start of the current calendar minute.
 */
export function computeWindowStartEpochSeconds(
  nowEpochSeconds: number,
  windowSeconds: number,
  strategy: "sliding" | "fixed",
): number {
  const FLOOR = 60;
  if (strategy === "fixed") {
    return Math.floor(nowEpochSeconds / FLOOR) * FLOOR;
  }
  const rawStart = nowEpochSeconds - windowSeconds;
  return Math.floor(rawStart / FLOOR) * FLOOR;
}

/**
 * Prune the existing failure-timestamp list to only entries within
 * the current window, then append `nowEpochSeconds`. For the
 * `sliding` strategy the cutoff is `nowEpochSeconds - WindowSeconds`;
 * for `fixed` it is `windowStartEpochSeconds`.
 */
export function pruneAndAppendFailureTimestamp(
  existing: readonly number[],
  nowEpochSeconds: number,
  windowSeconds: number,
  strategy: "sliding" | "fixed",
  windowStartEpochSeconds: number,
): number[] {
  const cutoff =
    strategy === "fixed"
      ? windowStartEpochSeconds
      : nowEpochSeconds - windowSeconds;
  const pruned = existing.filter(
    (ts) => ts >= cutoff && ts <= nowEpochSeconds,
  );
  pruned.push(nowEpochSeconds);
  return pruned;
}

/** Extract the failure-timestamp list from orchestration metadata. */
export function getFailureTimestamps(
  metadata: Record<string, unknown>,
): number[] {
  const raw = metadata[FAILURE_TIMESTAMPS_METADATA_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is number => typeof value === "number");
}

/** True iff this `(projectId, windowStartEpoch)` was already fired. */
export function wasWindowAlreadyEmitted(
  metadata: Record<string, unknown>,
  projectId: string,
  windowStartEpochSeconds: number,
): boolean {
  const expected = `${projectId}:${windowStartEpochSeconds}`;
  return metadata[LAST_EMITTED_WINDOW_METADATA_KEY] === expected;
}

/**
 * True iff the last emitted failure-threshold trigger is within
 * `cooldownSeconds` of `nowEpochSeconds`. The cooldown is keyed on
 * the actual emission timestamp persisted to
 * {@link LAST_EMITTED_AT_METADATA_KEY} so it survives service
 * restarts.
 */
export function isCooldownActive(
  metadata: Record<string, unknown>,
  cooldownSeconds: number,
  nowEpochSeconds: number,
): boolean {
  if (cooldownSeconds <= 0) {
    return false;
  }
  const lastEmittedAt = metadata[LAST_EMITTED_AT_METADATA_KEY];
  if (typeof lastEmittedAt !== "number") {
    return false;
  }
  return nowEpochSeconds - lastEmittedAt < cooldownSeconds;
}
