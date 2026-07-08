import { describe, expect, it } from 'vitest';

import {
  AUTONOMY_EVENT_CATEGORIES,
  AUTONOMY_EVENT_NAMES,
  AUTONOMY_TRIGGER_NAMES,
  type AutonomyEventCategory,
  type AutonomyEvidenceReference,
  type AutonomyNextStep,
} from './autonomy-observability.types';

describe('autonomy observability contracts', () => {
  it('keeps autonomy event names stable', () => {
    expect(AUTONOMY_EVENT_NAMES).toEqual({
      learningRunStarted: 'memory.learning.run.started',
      learningRunCompleted: 'memory.learning.run.completed',
      learningCandidateCreated: 'memory.learning.candidate_created',
      learningCandidateRejected: 'memory.learning.candidate_rejected',
      learningCandidateArchived: 'memory.learning.candidate_archived',
      learningPromotionSucceeded: 'memory.learning.promotion_succeeded',
      learningPromotionFailed: 'memory.learning.promotion_failed',
      learningPromoted: 'memory.learning.promoted.v1',
      learningRouted: 'memory.learning.routed.v1',
      skillProposalCreated: 'memory.learning.skill_proposal_created',
      skillProposalApproved: 'memory.learning.skill_proposal_approved',
      skillProposalRejected: 'memory.learning.skill_proposal_rejected',
      skillProposalApprovalFailed:
        'memory.learning.skill_proposal_approval_failed',
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
    });
  });

  it('keeps autonomy trigger names stable', () => {
    expect(AUTONOMY_TRIGGER_NAMES).toEqual({
      qaDecisionSubmitted: 'context_item.submit_qa_decision',
    });
  });

  it('defines autonomy event categories', () => {
    const category: AutonomyEventCategory = 'failure_classification';

    expect(category).toBe('failure_classification');
    expect(AUTONOMY_EVENT_CATEGORIES).toEqual([
      'learning',
      'review',
      'failure_classification',
      'repair',
    ]);
  });

  it('supports evidence references and next steps without raw content', () => {
    const evidence: AutonomyEvidenceReference = {
      kind: 'workflow_run',
      id: 'run-123',
      summary: 'Workflow run reached a repair decision.',
    };
    const nextStep: AutonomyNextStep = {
      label: 'Review repair decision',
      severity: 'warning',
      href: '/workflow-runs/run-123',
    };

    expect(evidence).toEqual({
      kind: 'workflow_run',
      id: 'run-123',
      summary: 'Workflow run reached a repair decision.',
    });
    expect(nextStep).toEqual({
      label: 'Review repair decision',
      severity: 'warning',
      href: '/workflow-runs/run-123',
    });
  });
});
