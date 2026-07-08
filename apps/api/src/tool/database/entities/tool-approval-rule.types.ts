export type ToolApprovalRuleScope =
  | 'global'
  | 'project'
  | 'agent_profile'
  | 'workflow_run'
  | 'chat_session'
  | 'scope_node';

export type ToolApprovalRuleEffect = 'allow' | 'deny' | 'require_approval';

export interface ArgumentPattern {
  path: string;
  operator: 'eq' | 'contains' | 'regex' | 'glob';
  value: string;
}
