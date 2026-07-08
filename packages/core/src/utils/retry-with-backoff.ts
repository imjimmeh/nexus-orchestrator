import type { RetryOptions } from "./retry-with-backoff.types";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Capped exponential backoff retry. Re-throws the last error when exhausted. */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (
        attempt >= options.maxAttempts ||
        !options.shouldRetry(error, attempt)
      ) {
        break;
      }
      const delay = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** (attempt - 1),
      );
      await sleep(delay);
    }
  }
  throw lastError;
}
