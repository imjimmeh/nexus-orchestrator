import type { AutonomyEvidenceReference } from './autonomy-observability.types';
import type {
  RepairEligibility,
  RepairPolicyClass,
} from '../workflow/workflow-repair/failure-classification.types';
import type {
  RepairDelegationExecutionPath,
  RepairDelegationStatus,
} from '../workflow/workflow-repair/repair-delegation.types';
import type { RuntimeFeedbackSkippedReason } from '../runtime-feedback/runtime-feedback.types';

export type SkillProposalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'failed';

export interface SourceEvidenceInput {
  kind?: string;
  id?: string;
  summary?: string;
}

export interface NestedProposalSourceEvidenceInput {
  sourceType?: string;
  sessionTreeId?: string;
  workflowRunId?: string | null;
  chatSessionId?: string | null;
  eventCount?: number;
  truncated?: boolean;
}

export interface ProposalSourceEvidenceInput {
  learning_candidate_id?: string | null;
  source_evidence?: NestedProposalSourceEvidenceInput[];
}

export interface SkillProposalDiagnosticsInput {
  id?: string;
  status: SkillProposalStatus;
  targetSkill?: string;
  title?: string;
  rationale?: string;
  summary?: string;
  rejectionReason?: string;
  diagnostics?: {
    source_evidence?: SourceEvidenceInput[] | ProposalSourceEvidenceInput;
  };
}

export interface FailedDeliverableInput {
  name?: string;
  summary?: string;
  deliverable_id?: string;
  failure_type?: string;
  details?: string;
  affected_files?: string[];
}

export interface QaDecisionSummaryInput {
  decision: 'accept' | 'reject';
  contextId?: string;
  workflowRunId?: string;
  feedback?: string;
  failedDeliverables?: FailedDeliverableInput[];
}

export interface FailureClassificationSummaryInput {
  eligibility: RepairEligibility;
  class: RepairPolicyClass;
  confidence: number;
  reason: string;
  evidenceReferences?: AutonomyEvidenceReference[];
}

export interface RepairDelegationSummaryInput {
  status: RepairDelegationStatus;
  policyAction: string;
  executionPath: RepairDelegationExecutionPath;
  attempt: number;
  message?: string;
  workflowRunId?: string;
  failedJobId?: string;
  doctorRepairAttemptId?: string;
  repairWorkflowRunId?: string;
}

export type RuntimeFeedbackEventName =
  | 'runtime.feedback.signal_ingested'
  | 'runtime.feedback.signal_skipped'
  | 'runtime.feedback.candidate_created';

export interface RuntimeFeedbackPayloadInput {
  group_id?: string;
  signal_type?: string;
  candidate_id?: string;
  skipped_reason?: RuntimeFeedbackSkippedReason | null;
  occurrence_count?: number;
  dedupe_fingerprint_hash?: string;
}

export interface RuntimeFeedbackSummaryInput {
  eventName: RuntimeFeedbackEventName;
  eventLedgerId?: string;
  workflowRunId?: string;
  jobId?: string;
  payload: RuntimeFeedbackPayloadInput;
}

export type LearningLifecycleEventName =
  | 'memory.learning.run.started'
  | 'memory.learning.run.completed';

export interface LearningLifecycleSummaryInput {
  eventName: LearningLifecycleEventName;
  eventLedgerId?: string;
  workflowRunId?: string;
  payload: Record<string, unknown>;
}

export interface LearningCandidateLifecycleSummaryInput {
  eventName: 'memory.learning.candidate_created';
  eventLedgerId?: string;
  workflowRunId?: string;
  jobId?: string;
  payload: Record<string, unknown>;
}
