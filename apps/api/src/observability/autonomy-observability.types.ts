export const AUTONOMY_EVENT_NAMES = {
  learningRunStarted: 'memory.learning.run.started',
  learningRunCompleted: 'memory.learning.run.completed',
  learningCandidateCreated: 'memory.learning.candidate_created',
  learningPromotionSucceeded: 'memory.learning.promotion_succeeded',
  learningPromotionFailed: 'memory.learning.promotion_failed',
  learningPromoted: 'memory.learning.promoted.v1',
  learningRouted: 'memory.learning.routed.v1',
  skillProposalCreated: 'memory.learning.skill_proposal_created',
  skillProposalApproved: 'memory.learning.skill_proposal_approved',
  skillProposalRejected: 'memory.learning.skill_proposal_rejected',
  learningCandidateRejected: 'memory.learning.candidate_rejected',
  learningCandidateArchived: 'memory.learning.candidate_archived',
  skillProposalApprovalFailed: 'memory.learning.skill_proposal_approval_failed',
  qaDecisionSubmitted: 'context_item.status_transition.succeeded',
  failureClassificationDecided: 'workflow.failure.classification.decided',
  repairDelegationDecided: 'workflow.repair-delegation.decided',
  repairDelegationDoctorRequested:
    'workflow.repair-delegation.doctor.requested',
  repairDelegationSysadminRequested:
    'workflow.repair-delegation.sysadmin.requested',
  repairDelegationCompleted: 'workflow.repair-delegation.completed',
  runtimeFeedbackSignalIngested: 'runtime.feedback.signal_ingested',
  runtimeFeedbackSignalSkipped: 'runtime.feedback.signal_skipped',
  runtimeFeedbackCandidateCreated: 'runtime.feedback.candidate_created',
  distillationCompleted: 'memory.distillation.completed.v1',
  distillationFailed: 'memory.distillation.failed.v1',
  memorySettingChanged: 'memory.setting.changed.v1',
  memoryFeedbackRecorded: 'memory.feedback.recorded.v1',
  workflowPostmortemRecorded: 'memory.workflow.postmortem_recorded.v1',
  memoryDecayShadow: 'memory.decay.shadow.v1',
  memoryContradictionDetected: 'memory.contradiction.detected.v1',
  memoryProbationShadow: 'memory.probation.shadow.v1',
  memoryConvergenceRecorderSucceeded:
    'memory.convergence.recorder_succeeded.v1',
  memoryRetentionRecalibrated: 'memory.retention.recalibrated.v1',
  memoryRetentionRecalibrationSkipped:
    'memory.retention.recalibration_skipped.v1',
  memoryConvergenceRecorderFailed: 'memory.convergence.recorder_failed.v1',
} as const;

export const AUTONOMY_TRIGGER_NAMES = {
  qaDecisionSubmitted: 'context_item.submit_qa_decision',
} as const;

export const AUTONOMY_EVENT_CATEGORIES = [
  'learning',
  'review',
  'failure_classification',
  'repair',
] as const;

export type AutonomyEventCategory = (typeof AUTONOMY_EVENT_CATEGORIES)[number];

export type AutonomyEvidenceReferenceKind =
  | 'event_ledger'
  | 'workflow_event'
  | 'learning_candidate'
  | 'skill_proposal'
  | 'session_tree'
  | 'workflow_run'
  | 'workflow_job'
  | 'job_output'
  | 'runtime_diagnostic'
  | 'doctor_repair_history'
  | 'context_item';

export interface AutonomyEvidenceReference {
  kind: AutonomyEvidenceReferenceKind;
  id?: string;
  summary: string;
}

export interface AutonomyNextStep {
  label: string;
  severity: 'info' | 'warning' | 'error';
  href?: string;
}

export interface AutonomySummaryItem {
  category: AutonomyEventCategory;
  title: string;
  status: 'in_progress' | 'succeeded' | 'denied' | 'failed' | 'needs_review';
  occurredAt?: string;
  summary: string;
  evidence: AutonomyEvidenceReference[];
  nextSteps: AutonomyNextStep[];
}
