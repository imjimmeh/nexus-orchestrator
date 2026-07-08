import type { DoctorRepairActionId } from '../../operations/doctor.types';
import type { FailureClassificationDecision } from './failure-classification.types';

export const REPAIR_DELEGATION_AUDIT_EVENT =
  'workflow.repair-delegation.decided' as const;
export const REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT =
  'workflow.repair-delegation.doctor.requested' as const;
export const REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT =
  'workflow.repair-delegation.sysadmin.requested' as const;
export const REPAIR_DELEGATION_COMPLETED_EVENT =
  'workflow.repair-delegation.completed' as const;
export const REPAIR_DELEGATION_STATE_KEY =
  '_internal.repair_delegation' as const;

export type RepairDelegationExecutionPath = 'doctor' | 'sysadmin_workflow';
export type RepairDelegationStatus =
  | 'denied'
  | 'dispatched'
  | 'succeeded'
  | 'failed'
  | 'retry_limit_exceeded';

export interface RepairExecutionPlan {
  path: RepairDelegationExecutionPath;
  policyActionId: string;
  concreteActionId?: DoctorRepairActionId;
}

export interface RepairDelegationRequestEvent {
  workflowRunId: string;
  workflowId: string;
  failedJobId?: string;
  decision: FailureClassificationDecision;
  /**
   * Sanitized concrete failure-evidence message that triggered the repair. When
   * present it is forwarded as the producer re-dispatch feedback in place of the
   * static classifier reason. Optional so other emitters remain unaffected.
   */
  failureMessage?: string;
  policyActionId: string;
  concreteActionId?: DoctorRepairActionId;
  attempt: number;
}

export interface RepairDelegationCompletedEvent {
  workflowRunId: string;
  workflowId: string;
  failedJobId?: string;
  policyActionId: string;
  executionPath: RepairDelegationExecutionPath;
  attempt: number;
  status: 'succeeded' | 'failed';
  message: string;
  repairWorkflowRunId?: string;
  doctorRepairAttemptId?: string;
}

export interface WorkflowRepairDelegationState {
  attempts: Record<string, number>;
  latest?: {
    status: RepairDelegationStatus;
    policyActionId: string;
    executionPath?: RepairDelegationExecutionPath;
    concreteActionId?: DoctorRepairActionId;
    attempt: number;
    failedJobId?: string;
    repairWorkflowRunId?: string;
    doctorRepairAttemptId?: string;
    message?: string;
    recordedAt: string;
  };
}
