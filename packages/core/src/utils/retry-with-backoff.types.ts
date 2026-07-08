export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Return true to retry the given error on the given (1-based) attempt. */
  shouldRetry: (error: unknown, attempt: number) => boolean;
}
