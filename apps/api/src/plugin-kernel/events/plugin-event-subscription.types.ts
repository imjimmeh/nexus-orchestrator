import type {
  EventSubscriptionContribution,
  PluginSubscriptionDeliveryMode,
} from '@nexus/plugin-sdk';

export interface PluginEventSubscription {
  pluginId: string;
  version: string;
  contributionId: string;
  operation: string;
  topics: string[];
  filters?: Record<string, unknown>;
  deliveryMode: PluginSubscriptionDeliveryMode;
  retry: {
    maxAttempts: number;
    initialDelayMs: number;
    backoffMultiplier: number;
  };
  deadLetter?: {
    enabled: boolean;
    reasonTemplate?: string;
  };
  requiredPermissions?: string[];
  contribution: EventSubscriptionContribution;
}

export type PluginEventSubscriptionProjectionStatus =
  | 'projected'
  | 'skipped'
  | 'failed'
  | 'cleaned';

export interface PluginEventSubscriptionProjectionResult {
  status: PluginEventSubscriptionProjectionStatus;
  pluginId: string;
  version: string;
  contributionId: string;
  topics: string[];
  reason?:
    | 'not_event_subscription'
    | 'invalid_contribution'
    | 'invalid_topic_pattern'
    | 'namespace_impersonation'
    | 'not_found';
  errorMessage?: string;
}
