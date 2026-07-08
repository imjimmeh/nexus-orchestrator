import type { ExecutionKind } from './execution-lifecycle.contracts';

/** Execution kinds eligible for freeze-on-shutdown. Subagents are excluded. */
export const FREEZABLE_EXECUTION_KINDS: readonly ExecutionKind[] = [
  'workflow_step',
  'workflow_chat',
  'adhoc_chat',
] as const;

export const FREEZE_REASON_SHUTDOWN = 'service_shutdown';

/** Max wall-clock budget for the shutdown freeze sweep (must be < compose stop_grace_period). */
export const DEFAULT_FREEZE_BUDGET_MS = 20_000;

/** Hard cap on the freeze budget, kept safely below docker stop_grace_period (30s). */
export const MAX_FREEZE_BUDGET_MS = 25_000;

export function resolveFreezeBudgetMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_FREEZE_BUDGET_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_FREEZE_BUDGET_MS;
  if (parsed > MAX_FREEZE_BUDGET_MS) return MAX_FREEZE_BUDGET_MS;
  return parsed;
}
