import type { ProviderTerminalFailureClassification } from './provider-terminal-failure.types';

// 402 / "insufficient balance" — the credential has no funds left (e.g. DeepSeek).
const BILLING_EXHAUSTED_PATTERN =
  /insufficient\s+balance|\b402\b(?=[^\n]*\b(?:balance|payment|billing|credit)\b)/i;

// Subscription "extra usage" exhausted — the Anthropic Pro/Max 400 response.
// Deliberately narrow so a retryable "usage limit reached" 429 is NOT matched.
const USAGE_EXHAUSTED_PATTERN =
  /out of (?:extra\s+)?usage|claude\.ai\/settings\/usage/i;

// Authentication/authorization failures — match the structured error types the
// provider returns rather than bare status codes to avoid false positives.
const AUTH_FAILED_PATTERN =
  /authentication_error|permission_error|invalid[_\s-]?api[_\s-]?key|\bunauthorized\b|\bforbidden\b/i;

/**
 * Classifies an agent turn failure message as a terminal (non-retryable)
 * provider error, or returns null when the failure is not a terminal provider
 * error. Callers fail the job fast on a non-null result.
 */
export function classifyProviderTerminalFailure(
  message: string,
): ProviderTerminalFailureClassification | null {
  if (BILLING_EXHAUSTED_PATTERN.test(message)) {
    return { reasonCode: 'provider_billing_exhausted' };
  }
  if (USAGE_EXHAUSTED_PATTERN.test(message)) {
    return { reasonCode: 'provider_usage_exhausted' };
  }
  if (AUTH_FAILED_PATTERN.test(message)) {
    return { reasonCode: 'provider_auth_failed' };
  }
  return null;
}
