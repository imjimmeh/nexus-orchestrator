export type ImprovementProposalKind =
  | "skill_create"
  | "skill_assignment"
  | "workflow_definition_change"
  | "agent_profile_change"
  | "code_change";

export type ImprovementProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied"
  | "failed"
  | "rolled_back";

export type GovernanceMode = "tiered" | "manual" | "autonomous";

export type GovernanceAction = "auto_apply" | "propose" | "drop";

export type ImprovementEvidenceClass = "struggle_backed" | "inference";

export interface AgentProfileAssignmentTarget {
  type: "agent_profile";
  profileName: string;
}

export interface WorkflowStepAssignmentTarget {
  type: "workflow_step";
  workflowName: string;
  stepId?: string;
}

export type AssignmentTarget =
  | AgentProfileAssignmentTarget
  | WorkflowStepAssignmentTarget;

export const IMPROVEMENT_PROPOSAL_KINDS = [
  "skill_create",
  "skill_assignment",
  "workflow_definition_change",
  "agent_profile_change",
  "code_change",
] as const satisfies readonly ImprovementProposalKind[];

export const IMPROVEMENT_PROPOSAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "applied",
  "failed",
  "rolled_back",
] as const satisfies readonly ImprovementProposalStatus[];

export const GOVERNANCE_MODES: readonly GovernanceMode[] = [
  "tiered",
  "manual",
  "autonomous",
] as const;
