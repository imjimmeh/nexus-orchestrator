import type { PluginEventSubscriptionProjectionResult } from '../events/plugin-event-subscription.types';
import type { PluginToolProjectionResult } from './plugin-tool-projection.types';
import type { PluginWorkflowHookProjectionResult } from './plugin-workflow-hook-projection.types';
import type { PluginWorkflowStepProjectionResult } from './plugin-workflow-step-projection.types';

export type ProjectionAction = 'refresh' | 'cleanup';
export type ProjectionAdapterName =
  | 'tools'
  | 'workflowSteps'
  | 'workflowHooks'
  | 'eventSubscriptions';
export type AdapterProjectionResult =
  | PluginToolProjectionResult
  | PluginWorkflowStepProjectionResult
  | PluginWorkflowHookProjectionResult
  | PluginEventSubscriptionProjectionResult;

export interface PluginProjectionOrchestrationError {
  adapter: ProjectionAdapterName;
  code: 'plugin_projection_refresh_failed' | 'plugin_projection_cleanup_failed';
  message:
    | 'Plugin projection refresh failed.'
    | 'Plugin projection cleanup failed.';
}

export interface PluginProjectionOrchestrationResult {
  ok: boolean;
  action: ProjectionAction;
  results: {
    tools: AdapterProjectionResult[];
    workflowSteps: AdapterProjectionResult[];
    workflowHooks: AdapterProjectionResult[];
    eventSubscriptions: AdapterProjectionResult[];
  };
  errors: PluginProjectionOrchestrationError[];
}
