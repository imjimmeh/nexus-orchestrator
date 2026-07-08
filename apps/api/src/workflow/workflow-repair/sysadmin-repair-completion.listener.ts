import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { readString } from '@nexus/core';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  type IWorkflowDefinitionRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { WORKFLOW_RUN_COMPLETED_EVENT } from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';
import {
  REPAIR_DELEGATION_COMPLETED_EVENT,
  type RepairDelegationCompletedEvent,
} from './repair-delegation.types';
import { sanitizeCompletionMessage } from './completion-message-sanitizer';

const ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER = 'workflow_environment_repair';
const REPAIR_ENVIRONMENT_JOB_ID = 'repair_environment';
const INVALID_STATUS_FALLBACK_MESSAGE =
  'Sysadmin repair workflow did not report a valid status.';
const FAILED_STATUS_FALLBACK_MESSAGE = 'Sysadmin repair workflow failed.';
const SUCCEEDED_STATUS_FALLBACK_MESSAGE = 'Sysadmin repair workflow succeeded.';

interface SysadminRepairTriggerContext {
  workflowRunId: string;
  workflowId: string;
  failedJobId?: string;
  policyActionId: string;
  attempt: number;
}

@Injectable()
export class SysadminRepairCompletionListener {
  private readonly logger = new Logger(SysadminRepairCompletionListener.name);
  private readonly completedRepairWorkflowRunIds = new Set<string>();

  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async handleWorkflowCompleted(event: WorkflowRunEvent): Promise<void> {
    try {
      if (!(await this.isEnvironmentRepairWorkflow(event.workflowId))) {
        return;
      }

      const triggerContext = this.readTriggerContext(event);
      if (!triggerContext) {
        return;
      }

      if (this.completedRepairWorkflowRunIds.has(event.workflowRunId)) {
        return;
      }
      this.completedRepairWorkflowRunIds.add(event.workflowRunId);

      this.eventEmitter.emit(
        REPAIR_DELEGATION_COMPLETED_EVENT,
        buildRepairDelegationCompletedEvent(event, triggerContext),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to process sysadmin repair completion for run ${event.workflowRunId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async isEnvironmentRepairWorkflow(
    workflowId: string,
  ): Promise<boolean> {
    const repairWorkflow = await this.workflowRepo.findByIdentifier(
      ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER,
    );
    return repairWorkflow?.id === workflowId;
  }

  private readTriggerContext(
    event: WorkflowRunEvent,
  ): SysadminRepairTriggerContext | null {
    const trigger = readRecord(event.stateVariables.trigger);
    const workflowRunId = readNonEmptyString(trigger?.workflowRunId);
    const workflowId = readNonEmptyString(trigger?.workflowId);
    const policyActionId = readNonEmptyString(trigger?.policyActionId);
    const attempt = readNumber(trigger?.attempt);

    if (!workflowRunId || !workflowId || !policyActionId || attempt === null) {
      this.logger.warn(
        `Skipping sysadmin repair completion for run ${event.workflowRunId}: missing original repair context.`,
      );
      return null;
    }

    return {
      workflowRunId,
      workflowId,
      failedJobId: readNonEmptyString(trigger?.failedJobId) ?? undefined,
      policyActionId,
      attempt,
    };
  }
}

function buildRepairDelegationCompletedEvent(
  event: WorkflowRunEvent,
  triggerContext: SysadminRepairTriggerContext,
): RepairDelegationCompletedEvent {
  const output = readRepairEnvironmentOutput(event.stateVariables);
  const status = readRepairStatus(output?.status);

  return {
    workflowRunId: triggerContext.workflowRunId,
    workflowId: triggerContext.workflowId,
    failedJobId: triggerContext.failedJobId,
    policyActionId: triggerContext.policyActionId,
    executionPath: 'sysadmin_workflow',
    attempt: triggerContext.attempt,
    status: status ?? 'failed',
    message: readCompletionMessage(output?.summary, status),
    repairWorkflowRunId: event.workflowRunId,
  };
}

function readRepairEnvironmentOutput(
  stateVariables: Record<string, unknown>,
): Record<string, unknown> | null {
  const jobs = readRecord(stateVariables.jobs);
  const repairJob = readRecord(jobs?.[REPAIR_ENVIRONMENT_JOB_ID]);
  return readRecord(repairJob?.output);
}

function readRepairStatus(value: unknown): 'succeeded' | 'failed' | null {
  if (value === 'succeeded' || value === 'failed') {
    return value;
  }

  return null;
}

function readCompletionMessage(
  summary: unknown,
  status: 'succeeded' | 'failed' | null,
): string {
  const message = readNonEmptyString(summary);
  if (message) {
    return sanitizeCompletionMessage(message);
  }

  if (status === 'succeeded') {
    return SUCCEEDED_STATUS_FALLBACK_MESSAGE;
  }

  if (status === 'failed') {
    return FAILED_STATUS_FALLBACK_MESSAGE;
  }

  return INVALID_STATUS_FALLBACK_MESSAGE;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  const trimmed = readString(value)?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
