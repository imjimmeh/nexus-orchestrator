import type { CapabilityDeniedReason } from '../tool/capability-preflight.types';

export type ProfileToolDecision = 'allow' | 'deny' | 'approval_required';

export interface ProfileToolPolicyInput {
  toolName: string;
  candidateToolNames?: string[];
  allowedTools: string[];
  deniedTools?: string[];
  approvalRequiredTools?: string[];
}

export type ModeOutcome = 'allow' | 'deny' | 'require_approval';

export interface PreflightCapabilityDecisionInput {
  toolName: string;
  isRegistered: boolean;
  publicationStatus?: string | null;
  allowedByPolicy: boolean;
  ruleEffect: 'allow' | 'deny' | 'require_approval' | null;
  modeOutcome: ModeOutcome;
}

export interface PreflightCapabilityDecisionResult {
  status: 'allow' | 'deny' | 'approval_required';
  deniedReason?: CapabilityDeniedReason;
}

export interface RuntimeSnapshotDecisionInput {
  capabilityName: string;
  callableTools: Set<string>;
  approvalRequiredTools: Set<string>;
  deniedTools: Array<Record<string, unknown>>;
}

export interface RuntimeSnapshotDecisionResult {
  status: 'allow' | 'denied' | 'approval_required';
  reason?: string;
  deniedReasonCode?: string;
}
