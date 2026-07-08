import type {
  ProviderTransientFailureCode,
  ProviderUsageLimit,
} from '../llm/provider-transient-failure.types';

export interface ChatSessionAutoRetryConfig {
  enabled: boolean;
  maxAttempts: number;
  maxDurationMs: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  resetBufferMs: number;
  maxInFlight: number;
}

export interface ChatSessionAutoRetryDecision {
  retry: boolean;
  reasonCode: ProviderTransientFailureCode;
  retryDelayMs?: number;
  rateLimitResetAt?: string;
  providerTier?: string;
  usageLimit?: ProviderUsageLimit;
}
