import type {
  PluginCapabilityEndpointVisibility,
  PluginSubscriptionDeliveryMode,
  WorkflowHookEventName,
} from "./plugin-contribution.types";

export const PLUGIN_RUNTIME_PROTOCOL_VERSION = "2026-05-17" as const;

export type PluginRuntimeProtocolVersion =
  typeof PLUGIN_RUNTIME_PROTOCOL_VERSION;

export type PluginRuntimeMode = "none" | "worker_process" | "container";

export type PluginRuntimeJsonValue =
  | string
  | number
  | boolean
  | null
  | PluginRuntimeJsonValue[]
  | { [key: string]: PluginRuntimeJsonValue };

export interface PluginRuntimeProtocolBaseMessage {
  protocolVersion: PluginRuntimeProtocolVersion;
  type: string;
  pluginId: string;
}

export interface PluginRuntimeProtocolCorrelatedMessage extends PluginRuntimeProtocolBaseMessage {
  correlationId: string;
}

export interface PluginRuntimeProtocolPeerDescriptor {
  id: string;
  version: string;
  supportedProtocolVersions: PluginRuntimeProtocolVersion[];
  capabilities?: string[];
}

export interface PluginRuntimeProtocolRuntimeDescriptor extends PluginRuntimeProtocolPeerDescriptor {
  mode: PluginRuntimeMode;
}

export type PluginRuntimeJsonObject = { [key: string]: PluginRuntimeJsonValue };

export interface PluginRuntimeProtocolContributionBase {
  id: string;
  displayName: string;
  description?: string;
  entrypoint?: string;
}

export interface PluginRuntimeProtocolToolContributionConfig {
  inputSchema: PluginRuntimeJsonObject;
  outputSchema?: PluginRuntimeJsonObject;
  operation: string;
  governance?: string;
  tier?: string;
}

export interface PluginRuntimeProtocolToolContribution extends PluginRuntimeProtocolContributionBase {
  type: "tool";
  config: PluginRuntimeProtocolToolContributionConfig;
}

export interface PluginRuntimeProtocolWorkflowStepContributionConfig {
  stepType: string;
  inputContract: string | PluginRuntimeJsonObject;
  operation: string;
  blocking?: boolean;
  timeoutMs?: number;
}

export interface PluginRuntimeProtocolWorkflowStepContribution extends PluginRuntimeProtocolContributionBase {
  type: "workflow.step";
  config: PluginRuntimeProtocolWorkflowStepContributionConfig;
}

export interface PluginRuntimeProtocolWorkflowHookContributionConfig {
  events: WorkflowHookEventName[];
  filters?: Record<string, PluginRuntimeJsonValue>;
  blocking: boolean;
  operation: string;
}

export interface PluginRuntimeProtocolWorkflowHookContribution extends PluginRuntimeProtocolContributionBase {
  type: "workflow.hook";
  config: PluginRuntimeProtocolWorkflowHookContributionConfig;
}

export interface PluginRuntimeProtocolEventSubscriptionContributionConfig {
  topics: string[];
  filters?: Record<string, PluginRuntimeJsonValue>;
  deliveryMode?: PluginSubscriptionDeliveryMode;
  retry?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    backoffMultiplier?: number;
  };
  deadLetter?: {
    enabled: boolean;
    reasonTemplate?: string;
  };
  requiredPermissions?: string[];
  operation: string;
}

export interface PluginRuntimeProtocolEventSubscriptionContribution extends PluginRuntimeProtocolContributionBase {
  type: "event.subscription";
  config: PluginRuntimeProtocolEventSubscriptionContributionConfig;
}

export interface PluginRuntimeProtocolCapabilityEndpointContributionConfig {
  inputSchema: PluginRuntimeJsonObject;
  outputSchema?: PluginRuntimeJsonObject;
  requiredPermissions?: string[];
  operation: string;
  timeoutMs?: number;
  retryable?: boolean;
  visibility: PluginCapabilityEndpointVisibility[];
}

export interface PluginRuntimeProtocolCapabilityEndpointContribution extends PluginRuntimeProtocolContributionBase {
  type: "capability.endpoint";
  config: PluginRuntimeProtocolCapabilityEndpointContributionConfig;
}

export interface PluginRuntimeProtocolLegacySpecialStepContribution extends PluginRuntimeProtocolContributionBase {
  type: "special_step";
  config?: PluginRuntimeJsonObject;
}

export type PluginRuntimeProtocolContribution =
  | PluginRuntimeProtocolToolContribution
  | PluginRuntimeProtocolWorkflowStepContribution
  | PluginRuntimeProtocolWorkflowHookContribution
  | PluginRuntimeProtocolEventSubscriptionContribution
  | PluginRuntimeProtocolCapabilityEndpointContribution
  | PluginRuntimeProtocolLegacySpecialStepContribution;

export interface PluginHandshakeRequestMessage extends PluginRuntimeProtocolCorrelatedMessage {
  type: "handshake.request";
  runtime: PluginRuntimeProtocolRuntimeDescriptor;
  plugin: PluginRuntimeProtocolPeerDescriptor;
}

export interface PluginHandshakeResponseMessage extends PluginRuntimeProtocolCorrelatedMessage {
  type: "handshake.response";
  accepted: boolean;
  runtimeMode: PluginRuntimeMode;
  agreedProtocolVersion: PluginRuntimeProtocolVersion;
  plugin: Omit<
    PluginRuntimeProtocolPeerDescriptor,
    "supportedProtocolVersions"
  >;
}

export interface PluginContributionsDeclareMessage extends PluginRuntimeProtocolCorrelatedMessage {
  type: "contributions.declare";
  contributions: PluginRuntimeProtocolContribution[];
}

export interface PluginInvokeRequestMessage extends PluginRuntimeProtocolCorrelatedMessage {
  type: "invoke.request";
  contributionId: string;
  operation: string;
  input: PluginRuntimeJsonValue;
  timeoutMs?: number;
  metadata?: Record<string, PluginRuntimeJsonValue>;
}

export interface PluginInvokeResponseMessage extends PluginRuntimeProtocolCorrelatedMessage {
  type: "invoke.response";
  ok: boolean;
  output?: PluginRuntimeJsonValue;
}

export interface PluginEventDeliverMessage extends PluginRuntimeProtocolCorrelatedMessage {
  type: "event.deliver";
  topic: string;
  eventName: string;
  payload: PluginRuntimeJsonValue;
}

export interface PluginHealthCheckRequestMessage extends PluginRuntimeProtocolCorrelatedMessage {
  type: "health.check.request";
}

export interface PluginHealthCheckResponseMessage extends PluginRuntimeProtocolCorrelatedMessage {
  type: "health.check.response";
  healthy: boolean;
  details?: Record<string, PluginRuntimeJsonValue>;
}

export interface PluginShutdownMessage extends PluginRuntimeProtocolBaseMessage {
  type: "shutdown";
  reason: string;
  deadlineMs?: number;
}

export interface PluginErrorMessage extends PluginRuntimeProtocolCorrelatedMessage {
  type: "error";
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, PluginRuntimeJsonValue>;
}

export type PluginRuntimeProtocolMessage =
  | PluginHandshakeRequestMessage
  | PluginHandshakeResponseMessage
  | PluginContributionsDeclareMessage
  | PluginInvokeRequestMessage
  | PluginInvokeResponseMessage
  | PluginEventDeliverMessage
  | PluginHealthCheckRequestMessage
  | PluginHealthCheckResponseMessage
  | PluginShutdownMessage
  | PluginErrorMessage;
