export type ProviderTransientFailureCode =
  | 'provider_rate_limit_429'
  | 'provider_overload_529'
  | 'generic_failure';

export interface ProviderUsageLimit {
  used: number;
  limit: number;
  unit: 'tokens';
}

export interface ProviderTransientFailureClassification {
  retryable: boolean;
  reasonCode: ProviderTransientFailureCode;
  httpStatus?: 429 | 529;
  resetAt?: string;
  retryDelayMsOverride?: number;
  providerTier?: string;
  usageLimit?: ProviderUsageLimit;
}
