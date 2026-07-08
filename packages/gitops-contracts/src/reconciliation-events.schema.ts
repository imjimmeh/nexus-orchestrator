import { z } from "zod";

export type {
  GitOpsReconciliationDeprecatedApplyEvent,
  GitOpsReconciliationTickCompletedEvent,
} from "./reconciliation-events.schema.types";

/**
 * Cross-service diagnostics event emitted by the legacy
 * `ReconciliationService.apply()` adapter when a caller still
 * invokes the env-driven mutation path.
 *
 * The canonical mutation path is
 * `GitOpsInboundReconcileService.apply(bindingId, ...)` —
 * this event is the typed diagnostic that surfaces a caller
 * is still on the deprecated path so operators can scope the
 * migration window.
 *
 * `bindingId` is nullable because the legacy controller
 * (`POST /gitops/reconcile`) is env-driven and has no
 * per-binding context at the controller boundary; the adapter
 * routes the call to one or more bindings via the canonical
 * inbound service. The event payload records the bindingId
 * the adapter eventually resolved to (when available) so a
 * downstream consumer can correlate the diagnostic with the
 * subsequent `gitops.reconcile.run.*` ledger row.
 *
 * Versioned additive: see
 * `docs/architecture/contract-versioning-policy.md`.
 */
export const GitOpsReconciliationDeprecatedApplyEventSchema = z.object({
  bindingId: z.string().min(1).nullable(),
  emittedAt: z.iso.datetime({ offset: true }),
  reason: z.string().min(1),
});

/**
 * Cross-service diagnostics event emitted by the
 * `GitOpsReconciliationLoopService` after a scheduled tick
 * completes. The payload carries the per-binding counts that
 * feed the prom-client counter pipeline:
 *   - `applied`  — bindings whose inbound apply reached the
 *                  `applied` terminal state.
 *   - `conflicts` — bindings whose inbound apply threw a
 *                  `BadRequestException` because the plan
 *                  had conflicts (the binding's
 *                  `conflictPolicy` did not override).
 *   - `errors`   — bindings whose inbound apply threw any
 *                  other error (DB / IO / unexpected).
 *
 * The mirror prom-client counter is
 * `nexus_gitops_reconciliation_tick_completed_total` with
 * label `{result: applied|conflict|error}`. The event ledger
 * row is the durable, typed record; the counter is the
 * scrape-time aggregate.
 *
 * Versioned additive: see
 * `docs/architecture/contract-versioning-policy.md`.
 */
export const GitOpsReconciliationTickCompletedEventSchema = z.object({
  applied: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  bindingsEvaluated: z.number().int().nonnegative(),
  emittedAt: z.iso.datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(),
});
