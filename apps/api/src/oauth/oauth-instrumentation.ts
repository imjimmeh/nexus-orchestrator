/**
 * Centralised instrumentation helper for the OAuth login orchestrator
 * in `apps/api/src/oauth/oauth-login.service.ts`.
 *
 * The helper mirrors the canonical `BackendInstrumentation` shape
 * (`apps/api/src/memory/backend-instrumentation.ts`) so the
 * non-throwing `recordBackend*` contract documented in
 * `docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md`
 * is preserved for non-memory instrumented services. In particular:
 *
 *   - **`try { counter.inc(); } catch { /* swallow *\/ }` shape** —
 *     a metrics failure MUST NOT break the call site. The orphan-
 *     recovery path is the load-bearing consumer; if the metrics
 *     sink is unreachable the session still has to transition to
 *     `failed` so the polling caller observes a deterministic
 *     outcome.
 *
 *   - **No prom-client leakage** — call sites inject this helper
 *     only. They never construct prom-client instruments directly.
 *
 *   - **Single fan-out point** — the helper is the only place that
 *     calls `MetricsService.recordOAuthLoginOrphaned()`. Adding a new
 *     oauth-domain metric (or changing the existing one's label
 *     shape) is a one-file change here, mirrored to `MetricsService`
 *     and `OAuthLoginService` only.
 *
 * The helper is deliberately minimal — a single method, no
 * passthrough / no record-write / no record-read, because the only
 * oauth-domain counter today is the orphan-recovery one. Future
 * counters (`provider-side failure`, `manual-code delivery`, ...)
 * should be added here following the same shape, not duplicated at
 * the call site.
 *
 * The helper is registered as a single provider in
 * `apps/api/src/oauth/oauth.module.ts` (no separate module). The
 * registration mirrors the single-provider choice made for
 * `BackendInstrumentation` (see the helper-extraction ADR §Decision
 * for the rationale — no other consumers, no semantic benefit from
 * a module boundary edge).
 *
 * See follow-up §3 of
 * `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`
 * for the follow-up this helper was extracted for.
 */
import { Injectable } from '@nestjs/common';
import { MetricsService } from '../observability/metrics.service';

@Injectable()
export class OAuthInstrumentation {
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * Record one OAuth login session transitioned to `failed` by the
   * orphan-recovery path (work item
   * `b19758d8-2448-472a-b2db-3856d3f6b4bc`, follow-up §3 of
   * `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`).
   *
   * The increment fires when the durable Redis record exists with
   * no reachable transient half — i.e. the owning pod was
   * restarted / scaled away while the user was completing the
   * provider-side login. Without this counter the pod-restart
   * failure mode is silent in dashboards (it surfaces as
   * `getStatus → failed`, indistinguishable from a provider-side
   * error).
   *
   * Contract:
   *   - No-arg, returns `void`.
   *   - **Never throws.** A prom-client failure, a missing
   *     registry, or any other metrics-layer anomaly is swallowed
   *     so the orphan-recovery path stays load-bearing — the
   *     session must still transition to `failed` and `DEL` the
   *     durable key regardless of whether the counter fired.
   *   - Fires at most once per orphan-recovery transition. The
   *     call site (`oauth-login.service.ts` `getStatus` orphan
   *     branch) is the single emit point; this method is not
   *     retried or re-invoked on the same transition.
   *
   * Sibling code paths in `runLogin` and `getStatus` share the
   * `transitionDurable(...)` helper but MUST NOT call this
   * method:
   *   - success path
   *   - provider-side failure path (`runLogin` catch)
   *   - manual-code delivery path (no own transition — the
   *     success/failure branches above cover it)
   *   - expired-session read-then-DEL path in `getStatus`
   */
  recordOAuthLoginOrphaned(): void {
    try {
      this.metricsService.recordOAuthLoginOrphaned();
    } catch {
      // Swallow — the orphan-recovery path is load-bearing; a
      // metrics-layer failure MUST NOT abort it. Mirrors the
      // non-throwing `recordBackend*` contract documented in
      // `docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md`.
    }
  }
}
