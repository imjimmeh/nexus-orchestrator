import type { WorkflowHookEventName } from '@nexus/plugin-sdk';

export type PluginWorkflowHookProjectionStatus =
  | 'projected'
  | 'skipped'
  | 'failed'
  | 'cleaned';

export interface BasePluginWorkflowHookProjectionResult {
  readonly status: PluginWorkflowHookProjectionStatus;
  readonly pluginId: string;
  readonly version: string;
  readonly contributionId: string;
  readonly eventName: string;
  readonly topic: string;
}

export interface ProjectedPluginWorkflowHookResult extends BasePluginWorkflowHookProjectionResult {
  readonly status: 'projected';
}

export interface SkippedPluginWorkflowHookResult extends BasePluginWorkflowHookProjectionResult {
  readonly status: 'skipped';
  readonly reason: 'not_workflow_hook' | 'not_found';
}

export interface FailedPluginWorkflowHookResult extends BasePluginWorkflowHookProjectionResult {
  readonly status: 'failed';
  readonly reason: 'invalid_contribution';
  readonly errorMessage: string;
}

export interface CleanedPluginWorkflowHookResult extends BasePluginWorkflowHookProjectionResult {
  readonly status: 'cleaned';
}

export type PluginWorkflowHookProjectionResult =
  | ProjectedPluginWorkflowHookResult
  | SkippedPluginWorkflowHookResult
  | FailedPluginWorkflowHookResult
  | CleanedPluginWorkflowHookResult;

export interface PluginWorkflowHookSubscription {
  readonly pluginId: string;
  readonly version: string;
  readonly contributionId: string;
  readonly eventName: WorkflowHookEventName;
  readonly topic: WorkflowHookEventName;
  readonly operation: string;
  readonly blocking: boolean;
  readonly filters?: Record<string, unknown>;
  readonly status: 'active';
}

export interface PluginWorkflowHookDeliveryRequest {
  readonly eventName: WorkflowHookEventName;
  readonly payload: Record<string, unknown>;
  readonly context?: Record<string, unknown>;
  readonly actorId?: string;
}

export type PluginWorkflowHookDeliveryResult =
  | (Omit<PluginWorkflowHookSubscription, 'status'> & {
      readonly status: 'delivered';
    })
  | (Omit<PluginWorkflowHookSubscription, 'status'> & {
      readonly status: 'skipped';
      readonly reason: 'filter_mismatch';
    })
  | (Omit<PluginWorkflowHookSubscription, 'status'> & {
      readonly status: 'failed' | 'blocking_failed';
      readonly error: PluginWorkflowHookDeliveryError;
    });

export interface PluginWorkflowHookDeliveryError {
  readonly code: 'plugin_workflow_hook_delivery_failed';
  readonly message: 'Plugin workflow hook delivery failed.';
  readonly retryable: boolean;
}
