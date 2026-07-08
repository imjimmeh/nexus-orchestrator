// packages/e2e-tests/src/driver/polling.ts
export type { PollOptions } from "./polling.types.js";
import type { PollOptions } from "./polling.types.js";

export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: PollOptions = {},
): Promise<T> {
  const {
    intervalMs = 2_000,
    timeoutMs = 120_000,
    label = "condition",
  } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `pollUntil: timed out waiting for ${label} after ${timeoutMs}ms`,
  );
}
