/**
 * System-setting keys and event-name constants for the orchestrator IP
 * resolution pipeline.
 *
 * Centralised as `as const` string literals so callers can reference the
 * exact key / event name without typos. Mirrors the convention in
 * `apps/api/src/settings/distillation-threshold.constants.ts`,
 * `learning-convergence-settings.constants.ts`, and
 * `retrospective-failure-threshold-settings.constants.ts` — the
 * `execution_lifecycle` namespace stays co-located with the module that
 * owns the dispatch surface so changes to the operator contract are
 * reviewable in one diff.
 *
 * These keys are deliberately NOT seeded in
 * `apps/api/src/settings/system-settings.defaults.ts`: the override is
 * an operator opt-in (unset = use the URL-parse default), so absence
 * from the seeded-defaults registry is the desired first-run behavior.
 * The `execution_dispatch_ip_resolver_endpoint` setting follows the same
 * pattern — it is consulted lazily by the `custom_http_endpoint`
 * strategy and must be configured before that strategy is selected.
 */
import type { OrchestratorIpResolverStrategy } from './execution-dispatch.service.types';

/**
 * System-setting key selecting which `IOrchestratorIpResolver`
 * implementation the delegating
 * {@link SystemSettingOrchestratorIpResolver} should dispatch to.
 *
 * Allowed values are the members of
 * {@link OrchestratorIpResolverStrategy} (validated against
 * `isKnownResolverStrategy`; unknown values fall back to `'default'`
 * with a warn-log). Unset (or non-string) reads also fall back to
 * `'default'`, preserving the pre-Milestone-3 URL-parse behavior.
 */
export const EXECUTION_DISPATCH_IP_RESOLVER_OVERRIDE_SETTING =
  'execution_dispatch_ip_resolver_override' as const;

/**
 * System-setting key carrying the endpoint URL the `custom_http_endpoint`
 * resolver GETs in order to discover the orchestrator's IP. The
 * response body must be a JSON object with a non-empty `ip` string
 * field (validated by `CustomHttpEndpointIpResolver`). Ignored unless
 * the override setting selects `custom_http_endpoint`.
 */
export const EXECUTION_DISPATCH_IP_RESOLVER_ENDPOINT_SETTING =
  'execution_dispatch_ip_resolver_endpoint' as const;

/**
 * Domain event emitted after every successful orchestrator IP
 * resolution. Carries the strategy actually used (which may differ
 * from the configured override when the resolver falls back to
 * `'default'`), the resolved IP, and a sanitized orchestrator URL with
 * any user-info stripped so logs / downstream consumers never see
 * basic-auth credentials.
 */
export const EXECUTION_DISPATCH_IP_RESOLVED_EVENT =
  'execution.dispatch.ip_resolved' as const;

/**
 * Domain event emitted when orchestrator IP resolution fails for the
 * configured strategy. Carries the strategy, the sanitized
 * orchestrator URL, and the error message (the underlying error is
 * attached via the domain-event envelope's `correlationId` /
 * outbox-attempt trail; we deliberately do NOT include the raw error
 * in the payload to keep the event-log surface typed).
 */
export const EXECUTION_DISPATCH_IP_RESOLUTION_FAILED_EVENT =
  'execution.dispatch.ip_resolution_failed' as const;

/**
 * The default strategy used when
 * `EXECUTION_DISPATCH_IP_RESOLVER_OVERRIDE_SETTING` is unset or holds
 * an unknown value. Re-exported here so the delegating resolver can
 * reference a single source of truth rather than re-declaring the
 * literal.
 */
export const DEFAULT_RESOLVER_STRATEGY: OrchestratorIpResolverStrategy =
  'default';

/**
 * Type guard narrowing an arbitrary value to one of the known
 * `OrchestratorIpResolverStrategy` values. Used by
 * `SystemSettingOrchestratorIpResolver` to validate the read setting
 * before dispatching.
 */
export function isKnownResolverStrategy(
  value: unknown,
): value is OrchestratorIpResolverStrategy {
  return (
    value === 'default' ||
    value === 'dns_round_robin' ||
    value === 'service_mesh_header' ||
    value === 'custom_http_endpoint'
  );
}
