/**
 * Terminal provider failures are LLM-provider errors that cannot be resolved by
 * retrying the same request: the credential is out of balance/usage or is
 * unauthorized. Unlike transient failures (429/529), re-running only wastes a
 * container and more provider usage, so these must fail the job fast with the
 * real provider error rather than be misread as a missing output contract.
 */
export type ProviderTerminalFailureCode =
  | 'provider_billing_exhausted'
  | 'provider_usage_exhausted'
  | 'provider_auth_failed';

export interface ProviderTerminalFailureClassification {
  reasonCode: ProviderTerminalFailureCode;
}
