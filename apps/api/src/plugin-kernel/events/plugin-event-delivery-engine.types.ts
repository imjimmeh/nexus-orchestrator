export interface PluginEventCandidateDeliveryResult {
  pluginId: string;
  version: string;
  contributionId: string;
  topic: string;
  correlationId?: string;
  status: 'delivered' | 'policy_denied' | 'delivery_failed' | 'skipped_filter';
  deliveryMode: 'blocking' | 'non_blocking';
  errorCode?: string;
}

export interface PluginEventDeliveryEngineResult {
  ok: boolean;
  deliveries: PluginEventCandidateDeliveryResult[];
  blockingFailure?: PluginEventCandidateDeliveryResult;
}
