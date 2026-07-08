export type PluginToolProjectionStatus =
  | 'projected'
  | 'skipped'
  | 'conflict'
  | 'failed';

export interface BasePluginToolProjectionResult {
  status: PluginToolProjectionStatus;
  pluginId: string;
  version: string;
  contributionId: string;
  toolName: string;
}

export interface ProjectedPluginToolResult extends BasePluginToolProjectionResult {
  status: 'projected';
  toolId?: string;
}

export interface SkippedPluginToolResult extends BasePluginToolProjectionResult {
  status: 'skipped';
  reason: 'not_tool' | 'not_found';
}

export interface ConflictPluginToolResult extends BasePluginToolProjectionResult {
  status: 'conflict';
  reason: 'tool_registry_conflict';
  errorMessage: string;
}

export interface FailedPluginToolResult extends BasePluginToolProjectionResult {
  status: 'failed';
  reason: 'invalid_contribution' | 'tool_registry_error' | 'cleanup_error';
  errorMessage: string;
}

export type PluginToolProjectionResult =
  | ProjectedPluginToolResult
  | SkippedPluginToolResult
  | ConflictPluginToolResult
  | FailedPluginToolResult;
