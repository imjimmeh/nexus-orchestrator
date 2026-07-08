export type PluginWorkflowStepProjectionStatus =
  | 'projected'
  | 'skipped'
  | 'conflict'
  | 'failed'
  | 'cleaned';

export interface BasePluginWorkflowStepProjectionResult {
  status: PluginWorkflowStepProjectionStatus;
  pluginId: string;
  version: string;
  contributionId: string;
  stepType: string;
}

export interface ProjectedPluginWorkflowStepResult extends BasePluginWorkflowStepProjectionResult {
  status: 'projected';
}

export interface SkippedPluginWorkflowStepResult extends BasePluginWorkflowStepProjectionResult {
  status: 'skipped';
  reason: 'not_workflow_step' | 'not_found';
}

export interface ConflictPluginWorkflowStepResult extends BasePluginWorkflowStepProjectionResult {
  status: 'conflict';
  reason: 'reserved_or_core_step_type' | 'step_registry_conflict';
  errorMessage?: string;
}

export interface FailedPluginWorkflowStepResult extends BasePluginWorkflowStepProjectionResult {
  status: 'failed';
  reason: 'invalid_contribution' | 'step_registry_error' | 'cleanup_error';
  errorMessage: string;
}

export interface CleanedPluginWorkflowStepResult extends BasePluginWorkflowStepProjectionResult {
  status: 'cleaned';
}

export type PluginWorkflowStepProjectionResult =
  | ProjectedPluginWorkflowStepResult
  | SkippedPluginWorkflowStepResult
  | ConflictPluginWorkflowStepResult
  | FailedPluginWorkflowStepResult
  | CleanedPluginWorkflowStepResult;
