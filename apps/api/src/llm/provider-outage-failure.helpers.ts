import type { ProviderOutageClassification } from './provider-outage-failure.types';

const OUTAGE_PATTERN =
  /\b(50[023]|529)\b|bad gateway|service unavailable|internal server error|overload/i;
const RATE_LIMIT_PATTERN = /\b429\b|rate limit|too many requests/i;

/**
 * Classifies an agent turn failure message as a provider outage (temporary
 * service unavailability), or returns null if the failure is not an outage.
 * Outages (5xx, 502, 503, 529) trigger fallback model/provider logic, while
 * rate limits (429) are retried against the same provider without falling back.
 */
export function classifyProviderOutageFailure(
  message: string,
): ProviderOutageClassification | null {
  if (RATE_LIMIT_PATTERN.test(message)) {
    return null;
  }
  return OUTAGE_PATTERN.test(message) ? { isOutage: true } : null;
}
