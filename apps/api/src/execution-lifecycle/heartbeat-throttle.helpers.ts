export const HEARTBEAT_MIN_INTERVAL_MS = 15_000;

/** True if enough time has elapsed since the last emit (or if never emitted) to emit again. */
export function shouldEmitHeartbeat(
  lastEmittedAtMs: number | undefined,
  nowMs: number,
  minIntervalMs: number = HEARTBEAT_MIN_INTERVAL_MS,
): boolean {
  if (lastEmittedAtMs === undefined) {
    return true;
  }
  return nowMs - lastEmittedAtMs >= minIntervalMs;
}
