import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DoctorRepairExecutorService } from './doctor-repair-executor.service';
import {
  REPAIR_DELEGATION_COMPLETED_EVENT,
  REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT,
  type RepairDelegationCompletedEvent,
  type RepairDelegationRequestEvent,
} from '../workflow/workflow-repair/repair-delegation.types';

@Injectable()
export class DoctorRepairDelegationListener {
  constructor(
    private readonly doctorRepairExecutor: DoctorRepairExecutorService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT)
  async handleDoctorRepairRequested(
    event: RepairDelegationRequestEvent,
  ): Promise<void> {
    if (!event.concreteActionId) {
      this.emitCompletion(event, {
        status: 'failed',
        message: 'Missing concrete doctor repair action id',
      });
      return;
    }

    try {
      const result = await this.doctorRepairExecutor.execute({
        action_id: event.concreteActionId,
        dry_run: false,
        requested_by: 'workflow_repair_delegation',
        arguments: {
          workflowRunId: event.workflowRunId,
          failedJobId: event.failedJobId,
          validationMessage: resolveValidationMessage(event),
          policyActionId: event.policyActionId,
          repairAttempt: event.attempt,
        },
      });

      this.emitCompletion(event, {
        status: result.status === 'failed' ? 'failed' : 'succeeded',
        message: result.message,
        doctorRepairAttemptId: result.attempt_id,
      });
    } catch (error) {
      this.emitCompletion(event, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private emitCompletion(
    event: RepairDelegationRequestEvent,
    completion: Pick<RepairDelegationCompletedEvent, 'message' | 'status'> &
      Pick<Partial<RepairDelegationCompletedEvent>, 'doctorRepairAttemptId'>,
  ): void {
    this.eventEmitter.emit(REPAIR_DELEGATION_COMPLETED_EVENT, {
      workflowRunId: event.workflowRunId,
      workflowId: event.workflowId,
      failedJobId: event.failedJobId,
      policyActionId: event.policyActionId,
      executionPath: 'doctor',
      attempt: event.attempt,
      status: completion.status,
      message: completion.message,
      doctorRepairAttemptId: completion.doctorRepairAttemptId,
    } satisfies RepairDelegationCompletedEvent);
  }
}

/**
 * Prefer the concrete (sanitized) failure-evidence message so the re-dispatched
 * producer receives the actual violation. Fall back to the static classifier
 * reason when no evidence message was threaded through.
 */
function resolveValidationMessage(event: RepairDelegationRequestEvent): string {
  const failureMessage = event.failureMessage?.trim();
  return failureMessage && failureMessage.length > 0
    ? failureMessage
    : event.decision.reason;
}
