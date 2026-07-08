export type GovernanceContextType = 'workflow_context' | 'chat_context';

export type PolicyAuthority =
  | 'profile'
  | 'mode_gate'
  | 'org_project_gate'
  | 'workflow'
  | 'job'
  | 'dynamic_rule'
  | 'context_requirement'
  | 'unknown';
