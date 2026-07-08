import * as prometheus from 'prom-client';

/**
 * OAuth-login orphan-recovery counter (work item
 * `b19758d8-2448-472a-b2db-3856d3f6b4bc`, follow-up §3 of
 * `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`).
 *
 * Registers the `nexus_oauth_login_orphaned_total` counter
 * against the global `prom-client` registry. Incremented by
 * `recordOAuthLoginOrphaned()` (and ultimately by
 * `OAuthInstrumentation.recordOAuthLoginOrphaned` in
 * `apps/api/src/oauth/oauth-instrumentation.ts`) exactly once
 * per orphan-recovery transition in
 * `apps/api/src/oauth/oauth-login.service.ts` — the path
 * that promotes a durable Redis record to `status: 'failed'`
 * with `error: 'OAuth session orphaned by pod restart'` and
 * then `DEL`s the durable key. The increment must NOT fire on
 * the success path, the provider-side failure path, the
 * manual-code delivery path, or the expired-session
 * read-then-DEL path.
 *
 * The counter is unlabelled by design: it is a single global
 * series. Per-provider breakdown is intentionally deferred —
 * if/when added, ship it as an additive label change in a
 * separate work item, never as part of this one.
 *
 * Originally defined in
 * `apps/api/src/observability/metrics.service.ts` as
 * `MetricsService.registerOAuthLoginOrphanedMetric()`; this
 * file is a faithful verbatim extraction of that body so the
 * metric name and help string remain byte-identical to the
 * previous in-class definition.
 */
export function registerOAuthLoginOrphanedMetric(): prometheus.Counter {
  return new prometheus.Counter({
    name: 'nexus_oauth_login_orphaned_total',
    help: 'Total number of OAuth login sessions transitioned to failed by the orphan-recovery path (durable Redis record with no reachable transient half).',
  });
}
