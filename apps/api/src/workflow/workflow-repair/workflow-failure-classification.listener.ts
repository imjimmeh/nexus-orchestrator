import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { readString } from '@nexus/core';
import { WORKFLOW_RUN_FAILED_EVENT } from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { WorkflowRepairDispatchService } from './workflow-repair-dispatch.service';
import type { FailureClassificationDecision } from './failure-classification.types';
import { WorkflowFailureClassificationService } from './workflow-failure-classification.service';

@Injectable()
export class WorkflowFailureClassificationListener {
  private readonly logger = new Logger(
    WorkflowFailureClassificationListener.name,
  );

  constructor(
    private readonly classification: WorkflowFailureClassificationService,
    private readonly repairDispatch: WorkflowRepairDispatchService,
  ) {}

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async handleWorkflowRunFailed(event: WorkflowRunEvent): Promise<void> {
    let decision: FailureClassificationDecision;
    try {
      decision = await this.classification.classifyRunFailure(
        event.workflowRunId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to classify workflow run ${event.workflowRunId} failure: ${message}`,
      );
      return;
    }

    try {
      const failedJobId = resolveFailedJobId(event.stateVariables);
      await this.repairDispatch.dispatchIfAllowed({
        workflowRunId: event.workflowRunId,
        workflowId: event.workflowId,
        ...(failedJobId ? { failedJobId } : {}),
        decision,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to dispatch workflow repair for run ${event.workflowRunId}: ${message}`,
      );
    }
  }
}

function resolveFailedJobId(
  stateVariables: Record<string, unknown>,
): string | undefined {
  return (
    readNonEmptyString(stateVariables.current_step_id) ??
    readNonEmptyString(readRecord(stateVariables.trigger)?.failed_job_id)
  );
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | undefined {
  const trimmed = readString(value)?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
