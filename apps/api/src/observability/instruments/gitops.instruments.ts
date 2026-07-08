import * as prometheus from 'prom-client';

/**
 * GitOps-reconciliation tick counter (work item WI-2026-059).
 *
 * Registers the `nexus_gitops_reconciliation_tick_completed_total`
 * counter against the global `prom-client` registry. Each
 * scheduled tick iterates every enabled
 * `GitOpsRepositoryBinding` and calls
 * `GitOpsInboundReconcileService.apply`. The `result` label
 * is the per-binding terminal state:
 *   - `applied`  — inbound apply reached the `applied` state.
 *   - `conflict` — inbound apply threw a `BadRequestException`
 *                  because the plan had conflicts (binding's
 *                  `conflictPolicy` did not override).
 *   - `error`    — inbound apply threw any other error
 *                  (DB / IO / unexpected).
 *
 * The label cardinality is bounded by the closed enum
 * `applied | conflict | error`. The counter is incremented
 * exactly once per evaluated binding so the sum across the
 * three labels equals the tick's `bindingsEvaluated` count.
 *
 * Originally defined in
 * `apps/api/src/observability/metrics.service.ts` as
 * `MetricsService.registerGitopsReconciliationTickCounter()`;
 * this file is a faithful verbatim extraction of that body
 * so the metric name, label names, and help string remain
 * byte-identical to the previous in-class definition.
 */
export function registerGitopsReconciliationTickCounter(): prometheus.Counter {
  return new prometheus.Counter({
    name: 'nexus_gitops_reconciliation_tick_completed_total',
    help: 'Total number of GitOps reconciliation tick binding-evaluations labelled by per-binding terminal result (applied | conflict | error). One increment per binding per tick; sum across the three labels equals `bindingsEvaluated`.',
    labelNames: ['result'],
  });
}
