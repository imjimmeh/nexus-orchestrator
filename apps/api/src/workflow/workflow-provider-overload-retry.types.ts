export interface WorkflowRetryDecision {
  reasonCode: string;
  allowWhenWorkflowAutoRetryDisabled?: boolean;
  retryDelayMsOverride?: number;
  resetAt?: string;
  providerTier?: string;
  usageLimit?: {
    used: number;
    limit: number;
    unit: 'tokens';
  };
}
