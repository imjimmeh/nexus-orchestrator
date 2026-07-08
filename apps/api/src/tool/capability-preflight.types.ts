import type {
  IJob,
  IToolPermissionPolicy,
  SkillDiscoveryMode,
  ToolPolicyDocument,
  ToolPolicyStrategy,
} from '@nexus/core';
export type OrchestrationMode =
  | 'autonomous'
  | 'assisted'
  | 'manual'
  | 'supervised'
  | 'notifications_only';
import type {
  GovernanceContextType,
  PolicyAuthority,
} from './capability-governance.types';

export interface PreflightInput {
  workflowRunId: string;
  jobId: string;
  job: IJob;
  stateVariables: Record<string, unknown>;
  resolvedJobInputs: Record<string, unknown>;
  workflowPermissions?: IToolPermissionPolicy;
  workflowSkillDiscoveryMode?: SkillDiscoveryMode;
  policyStrategy?: ToolPolicyStrategy;
}

export interface ChatCapabilitySnapshotInput {
  chatSessionId: string;
  agentProfileName: string;
  scopeId?: string | null;
}

export interface CandidateResolution {
  candidateNames: Set<string>;
  selectedRegisteredTools: Array<{
    name: string;
    publication_status?: string | null;
  }>;
  runnerRuntimeTools: string[];
}

export type CapabilityDeniedReasonCode =
  | 'policy_denied'
  | 'mode_denied'
  | 'tool_not_registered'
  | 'tool_not_published'
  | 'rule_denied'
  | 'missing_scope_context';

export interface CapabilityDeniedReason {
  toolName: string;
  reasonCode: CapabilityDeniedReasonCode;
  reason: string;
  remediation?: string;
  policyAuthority?: PolicyAuthority;
  contextType?: GovernanceContextType;
}

export interface CapabilityResolutionSnapshot {
  workflowRunId: string;
  jobId: string;
  scopeId: string | null;
  mode: OrchestrationMode | null;
  callableToolNames: string[];
  denied: CapabilityDeniedReason[];
  approvalRequiredToolNames: string[];
  agentToolPolicy: ToolPolicyDocument | null;
}

export interface CapabilityPreflightResult extends CapabilityResolutionSnapshot {
  ok: boolean;
  reasonCode?:
    | 'required_tool_undefined'
    | 'required_tool_not_callable'
    | 'output_tool_undefined'
    | 'output_tool_not_callable'
    | 'output_contract_invalid'
    | 'output_contract_tool_not_callable';
  message?: string;
  remediation?: string;
  failedTool?: string;
}
