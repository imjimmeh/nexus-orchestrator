export const FAILURE_CLASSIFICATION_AUDIT_EVENT =
  'workflow.failure.classification.decided' as const;

export const REPAIR_POLICY_CLASSES = [
  'dependency_missing',
  'config_missing_local',
  'runtime_artifact_stale',
  'runtime_stall_recoverable',
  'provider_transient',
  'context_window_exceeded',
  'tool_contract_mismatch',
  'credential_missing',
  'quality_gate_failed',
  'merge_dirty_worktree',
  'split_coverage_invalid',
  'ambiguous_failure',
] as const;

export const REPAIR_POLICY_ELIGIBILITIES = [
  'allow',
  'deny',
  'human_required',
] as const;

export type RepairPolicyClass = (typeof REPAIR_POLICY_CLASSES)[number];
export type RepairEligibility = (typeof REPAIR_POLICY_ELIGIBILITIES)[number];
export type FailureClassificationSafetyTag = 'destructive_operation';

export type FailureEvidenceReferenceKind =
  | 'event_ledger'
  | 'workflow_event'
  | 'job_output'
  | 'session_tree'
  | 'runtime_diagnostic';

export interface FailureEvidenceReference {
  kind: FailureEvidenceReferenceKind;
  id?: string;
  summary: string;
}

export interface FailureEvidenceEvent {
  id: string;
  domain: string;
  name: string;
  outcome: string;
  severity: string;
  jobId?: string;
  stepId?: string;
  payload?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  occurredAt: string;
}

export interface FailureEvidenceTranscriptReference {
  kind: 'session_tree';
  sessionTreeId: string;
  eventIndex: number;
  summary: string;
}

export interface FailureEvidenceRuntimeDiagnostics {
  skillMounts?: Record<string, unknown>;
  hostMounts?: Record<string, unknown>;
  collectionErrors: string[];
}

export interface NormalizedFailureEvidence {
  workflowRunId: string;
  workflowId: string;
  jobId?: string;
  events: FailureEvidenceEvent[];
  jobOutput?: Record<string, unknown> | null;
  errorCode?: string;
  errorMessage?: string;
  transcriptReferences: FailureEvidenceTranscriptReference[];
  runtimeDiagnostics: FailureEvidenceRuntimeDiagnostics;
}

export interface FailureClassificationDecision {
  class: RepairPolicyClass;
  confidence: number;
  reason: string;
  /**
   * Sanitized actual failure-evidence message that drove the classification
   * (the concrete downstream violation text, not the static classifier reason).
   * Threaded into repair delegation so a re-dispatched producer job receives the
   * specific violation as feedback. Absent when no evidence message was captured.
   */
  failureMessage?: string;
  safetyTags?: FailureClassificationSafetyTag[];
  evidenceReferences: FailureEvidenceReference[];
  eligibility: RepairEligibility;
  allowedRepairActionIds: string[];
}
