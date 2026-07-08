export const MESH_DELEGATION_DENIAL_REASON_VALUES = [
  'requested_tools_missing',
  'requested_tools_not_in_allowed_tools',
  'requested_tools_blocked_by_denied_tools',
  'target_profile_not_authorized_for_requested_tools',
  'privileged_tools_require_explicit_approval',
  'token_budget_out_of_range',
  'time_budget_out_of_range',
  'max_retries_out_of_range',
  'queue_priority_out_of_range',
] as const;

export type MeshDelegationDenialReason =
  (typeof MESH_DELEGATION_DENIAL_REASON_VALUES)[number];

export interface EvaluateMeshDelegationPolicyParams {
  targetAgentProfile: string;
  requestedTools: string[];
  allowedTools?: string[] | null;
  deniedTools?: string[] | null;
  tokenBudget?: number | null;
  timeBudgetMs?: number | null;
  maxRetries?: number | null;
  queuePriority?: number | null;
  allowPrivilegedTools?: boolean;
}

export interface MeshDelegationGovernanceDecision {
  allowed: boolean;
  denialReason?: MeshDelegationDenialReason;
  effectiveTools: string[];
  privilegedTools: string[];
  rationale: string[];
}
