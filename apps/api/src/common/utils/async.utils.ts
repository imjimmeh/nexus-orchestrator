import type { BackoffConfig } from './async.utils.types';

export type { BackoffConfig } from './async.utils.types';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeExponentialBackoffMs(
  attempt: number,
  config: BackoffConfig,
): number {
  const base = Math.min(config.baseMs * Math.pow(2, attempt), config.maxMs);
  const jitter = config.jitter ? Math.random() * config.baseMs : 0;
  return Math.min(base + jitter, config.maxMs);
}
