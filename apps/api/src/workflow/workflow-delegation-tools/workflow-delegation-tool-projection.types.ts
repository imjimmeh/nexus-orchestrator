export interface WorkflowDelegationToolDefinition {
  id: string;
  enabled?: boolean;
  feature_flag?: string;
  tool_name: string;
  description: string;
  workflow_id: string;
  agent_profile?: string;
  tier_restriction?: number;
  input_schema: Record<string, unknown>;
  fixed_trigger_data?: Record<string, unknown>;
  trigger_data_fields?: string[];
}

export interface WorkflowDelegationToolConfigFile {
  tools: WorkflowDelegationToolDefinition[];
}

export interface WorkflowDelegationProjectionResult {
  toolName: string;
  workflowId: string;
  status: 'projected' | 'skipped' | 'failed';
  reason?: string;
  errorMessage?: string;
}
