/**
 * Provider outage classification represents a temporary service unavailability
 * (5xx server errors, 502 bad gateway, 503 service unavailable, 529 overload)
 * that is distinct from transient rate-limit failures (429) and terminal
 * credential/billing failures. Outages trigger fallback model/provider logic
 * because the current provider cannot serve requests.
 */
export interface ProviderOutageClassification {
  isOutage: true;
}
