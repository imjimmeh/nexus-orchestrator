export interface WorkflowFailureClassification {
  reasonCode: string;
  retryCategory:
    | 'default'
    | 'provider_overload_529'
    | 'provider_rate_limit_429'
    | 'resource_contention';
  retryDelayMsOverride?: number;
  resetAt?: string;
  providerTier?: string;
  usageLimit?: {
    used: number;
    limit: number;
    unit: 'tokens';
  };
}
