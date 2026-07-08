export interface BackoffConfig {
  baseMs: number;
  maxMs: number;
  jitter?: boolean;
}
