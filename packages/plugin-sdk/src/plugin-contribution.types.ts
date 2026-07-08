export const pluginContributionTypes = [
  "tool",
  "workflow.step",
  "workflow.hook",
  "event.subscription",
  "capability.endpoint",
  "special_step",
] as const;

export type PluginContributionType = (typeof pluginContributionTypes)[number];

export const pluginOperationNameMaxLength = 255;
export const pluginOperationNamePattern = /^[a-z][a-z0-9_.:_-]*$/;

export const workflowHookEventNames = [
  "workflow.run.started",
  "workflow.run.completed",
  "workflow.run.failed",
  "workflow.run.cancelled",
  "workflow.step.started",
  "workflow.step.completed",
  "workflow.step.failed",
] as const;

export type WorkflowHookEventName = (typeof workflowHookEventNames)[number];

export type JsonSchemaObject = Record<string, unknown>;

export const pluginSubscriptionDeliveryModes = [
  "blocking",
  "non_blocking",
] as const;

export type PluginSubscriptionDeliveryMode =
  (typeof pluginSubscriptionDeliveryModes)[number];

export const pluginCapabilityEndpointVisibilities = [
  "workflow",
  "tool",
  "internal",
  "plugin",
] as const;

export type PluginCapabilityEndpointVisibility =
  (typeof pluginCapabilityEndpointVisibilities)[number];

export interface PluginContributionBase {
  id: string;
  displayName: string;
  description?: string;
  entrypoint?: string;
}

export interface ToolContributionConfig {
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  operation: string;
  governance?: string;
  tier?: string;
}

export interface ToolContribution extends PluginContributionBase {
  type: "tool";
  config: ToolContributionConfig;
}

export interface WorkflowStepContributionConfig {
  stepType: string;
  inputContract: string | JsonSchemaObject;
  operation: string;
  blocking?: boolean;
  timeoutMs?: number;
}

export interface WorkflowStepContribution extends PluginContributionBase {
  type: "workflow.step";
  config: WorkflowStepContributionConfig;
}

export interface WorkflowHookContributionConfig {
  events: WorkflowHookEventName[];
  filters?: Record<string, unknown>;
  blocking: boolean;
  operation: string;
}

export interface WorkflowHookContribution extends PluginContributionBase {
  type: "workflow.hook";
  config: WorkflowHookContributionConfig;
}

export interface EventSubscriptionContributionConfig {
  topics: string[];
  filters?: Record<string, unknown>;
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

export interface EventSubscriptionContribution extends PluginContributionBase {
  type: "event.subscription";
  config: EventSubscriptionContributionConfig;
}

export interface CapabilityEndpointContributionConfig {
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  requiredPermissions?: string[];
  operation: string;
  timeoutMs?: number;
  retryable?: boolean;
  visibility: PluginCapabilityEndpointVisibility[];
}

export interface CapabilityEndpointContribution extends PluginContributionBase {
  type: "capability.endpoint";
  config: CapabilityEndpointContributionConfig;
}

export interface LegacySpecialStepContribution extends PluginContributionBase {
  type: "special_step";
  config?: Record<string, unknown>;
}

export type PluginContribution =
  | ToolContribution
  | WorkflowStepContribution
  | WorkflowHookContribution
  | EventSubscriptionContribution
  | CapabilityEndpointContribution
  | LegacySpecialStepContribution;
