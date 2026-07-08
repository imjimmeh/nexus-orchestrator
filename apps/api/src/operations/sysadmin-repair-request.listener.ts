import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { WORKFLOW_DEFINITION_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import { WORKFLOW_ENGINE_SERVICE } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowDefinitionRepository,
  IWorkflowEngineService,
} from '../workflow/kernel/interfaces/workflow-kernel.ports';
import {
  REPAIR_DELEGATION_COMPLETED_EVENT,
  REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT,
  type RepairDelegationCompletedEvent,
  type RepairDelegationRequestEvent,
} from '../workflow/workflow-repair/repair-delegation.types';

const ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER = 'workflow_environment_repair';

@Injectable()
export class SysadminRepairRequestListener {
  private readonly logger = new Logger(SysadminRepairRequestListener.name);

  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT)
  async handleSysadminRepairRequested(
    event: RepairDelegationRequestEvent,
  ): Promise<void> {
    try {
      const repairWorkflow = await this.workflowRepo.findByIdentifier(
        ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER,
        { includeInactive: true },
      );
      if (!repairWorkflow?.is_active) {
        this.emitFailure(
          event,
          `Repair workflow '${ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER}' not found or inactive`,
        );
        return;
      }

      const repairRunId = await this.workflowEngine.startWorkflow(
        repairWorkflow.id,
        {
          event: 'workflow.repair-delegation.sysadmin',
          source: 'sysadmin_repair_request',
          workflowRunId: event.workflowRunId,
          workflowId: event.workflowId,
          failedJobId: event.failedJobId,
          policyActionId: event.policyActionId,
          concreteActionId: event.concreteActionId,
          attempt: event.attempt,
        },
      );

      if (!repairRunId) {
        this.emitFailure(
          event,
          'Repair workflow start returned no run id (skipped by concurrency policy)',
        );
      }
    } catch (error) {
      this.emitFailure(
        event,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private emitFailure(
    event: RepairDelegationRequestEvent,
    message: string,
  ): void {
    this.logger.warn(
      `Sysadmin repair request for run ${event.workflowRunId} failed: ${message}`,
    );
    this.eventEmitter.emit(REPAIR_DELEGATION_COMPLETED_EVENT, {
      workflowRunId: event.workflowRunId,
      workflowId: event.workflowId,
      failedJobId: event.failedJobId,
      policyActionId: event.policyActionId,
      executionPath: 'sysadmin_workflow',
      attempt: event.attempt,
      status: 'failed',
      message,
    } satisfies RepairDelegationCompletedEvent);
  }
}
