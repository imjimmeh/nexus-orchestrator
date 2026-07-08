import type { CapabilityDeniedReason } from '../tool/capability-preflight.types';

export type ProfileDecision =
  | 'allow'
  | 'deny'
  | 'approval_required'
  | 'unchecked';

export type ModeOutcome = 'allow' | 'deny' | 'require_approval';

export type RuleEffect = 'allow' | 'deny' | 'require_approval' | null;

export interface PolicyEngineInput {
  capabilityName: string;
  isRegistered: boolean;
  publicationStatus?: string | null;
  profileDecision?: ProfileDecision;
  workflowDenied?: boolean;
  workflowAllowed?: boolean;
  modeOutcome?: ModeOutcome | 'unchecked';
  ruleEffect?: RuleEffect;
  approvalRequiredByProfile?: boolean;
}

export interface PolicyEnginePhaseResult {
  phase: string;
  outcome: 'pass' | 'deny' | 'approval_required' | 'bypassed';
}

export interface PolicyExplanation {
  phases: PolicyEnginePhaseResult[];
  decidedBy: string;
}

export interface PolicyDecision {
  status: 'allow' | 'deny' | 'approval_required';
  deniedReason?: CapabilityDeniedReason;
  explanation: PolicyExplanation;
}
