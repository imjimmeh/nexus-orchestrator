export type ConcurrencyCheckResult =
  | { action: 'proceed'; concurrencyScope: string }
  | { action: 'skip' }
  | { action: 'queue'; concurrencyScope: string }
  | { action: 'cancel'; cancelRunId: string; concurrencyScope: string };
