import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WORKFLOW_RUN_FAILED_EVENT } from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import { WORKFLOW_DEFINITION_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import { WORKFLOW_ENGINE_SERVICE } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowDefinitionRepository,
  IWorkflowEngineService,
} from '../workflow/kernel/interfaces/workflow-kernel.ports';

const WORKFLOW_FAILURE_DOCTOR_IDENTIFIER = 'workflow_failure_doctor';
const ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER = 'workflow_environment_repair';

@Injectable()
export class WorkflowFailureDoctorTriggerListener {
  private readonly logger = new Logger(
    WorkflowFailureDoctorTriggerListener.name,
  );
  private readonly triggeredRunIds = new Set<string>();

  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
  ) {}

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async handleWorkflowRunFailed(event: WorkflowRunEvent): Promise<void> {
    try {
      if (this.triggeredRunIds.has(event.workflowRunId)) {
        return;
      }

      const doctorWorkflow = await this.workflowRepo.findByIdentifier(
        WORKFLOW_FAILURE_DOCTOR_IDENTIFIER,
        { includeInactive: true },
      );
      if (!doctorWorkflow?.is_active) {
        return;
      }

      if (
        await this.isSelfOrRepairWorkflow(event.workflowId, doctorWorkflow.id)
      ) {
        return;
      }

      this.triggeredRunIds.add(event.workflowRunId);

      const runId = await this.workflowEngine.startWorkflow(doctorWorkflow.id, {
        event: 'workflow.failure_doctor',
        source: 'workflow_failure_doctor_trigger',
        scopeId: this.readScopeId(event.stateVariables),
        failed_workflow_run_id: event.workflowRunId,
        failed_workflow_id: event.workflowId,
        failure_reason: event.reason ?? null,
      });

      if (!runId) {
        this.triggeredRunIds.delete(event.workflowRunId);
      }
    } catch (error) {
      this.triggeredRunIds.delete(event.workflowRunId);
      this.logger.warn(
        `Failed to trigger workflow failure doctor for run ${event.workflowRunId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async isSelfOrRepairWorkflow(
    failedWorkflowId: string,
    doctorWorkflowId: string,
  ): Promise<boolean> {
    if (failedWorkflowId === doctorWorkflowId) {
      return true;
    }
    const repairWorkflow = await this.workflowRepo.findByIdentifier(
      ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER,
      { includeInactive: true },
    );
    return repairWorkflow?.id === failedWorkflowId;
  }

  private readScopeId(
    stateVariables: Record<string, unknown>,
  ): string | undefined {
    const trigger = stateVariables?.trigger;
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
      return undefined;
    }
    const scopeId = (trigger as Record<string, unknown>).scopeId;
    return typeof scopeId === 'string' && scopeId.trim().length > 0
      ? scopeId.trim()
      : undefined;
  }
}
