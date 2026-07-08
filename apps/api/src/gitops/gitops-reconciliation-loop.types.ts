/**
 * Public types for the `GitOpsReconciliationLoopService`
 * and its collaborators.
 *
 * Kept in a dedicated `*.types.ts` file per the project's
 * `no-restricted-syntax` ESLint rule (exported type aliases
 * belong here, not in the implementation file).
 */
import type { Logger } from '@nestjs/common';

export interface GitOpsLoopParams {
  logger: Logger;
  isEnabled: () => boolean;
  intervalMs: number;
  /**
   * Maximum random offset (in ms) added to every scheduled
   * tick. The next-tick delay is computed as
   * `intervalMs + Math.floor(random() * jitterMs)`, giving an
   * effective envelope of `[intervalMs, intervalMs + jitterMs)`.
   * Set to `0` to disable jitter entirely while keeping the
   * delay path uniform.
   */
  jitterMs: number;
  /**
   * Random source used by `scheduleNext()` to derive the
   * jitter offset. Typed as `() => number` returning a value
   * in `[0, 1)`, matching the contract of `Math.random` and
   * making it trivial for tests to stub a deterministic
   * generator. Defaults to `Math.random` when omitted.
   */
  random?: () => number;
  /**
   * Callback invoked once per scheduled tick. The loop only
   * uses the resolved/rejected signal — the return value is
   * intentionally typed as `unknown` so each tick target can
   * return its own counts envelope without forcing the loop
   * scheduler to know about it.
   */
  runTick: () => Promise<unknown>;
}

/**
 * Label union for the `nexus_gitops_reconciliation_tick_completed_total`
 * prom-client counter. Each scheduled tick increments the
 * counter exactly once per evaluated binding under one of
 * these three labels.
 */
export type GitOpsTickResult = 'applied' | 'conflict' | 'error';
