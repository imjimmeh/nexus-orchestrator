import { Inject, Injectable, Optional } from '@nestjs/common';
import { IWorkflowDefinition, readString, WorkflowStatus } from '@nexus/core';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowDefinitionRepository,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { PromptLoaderService } from './prompt-loader.service';
import { WorkflowJobMessageQueueService } from './workflow-job-message-queue.service';
import { WorkflowParserService } from './workflow-parser.service';
import { BudgetDecisionService } from '../cost-governance/budget-decision.service';
import type {
  FailedJobRetryResolvedContext,
  FailedJobRetryResult,
} from './workflow-failed-job-retry.types';
import { buildRunStatusTimestampPatch } from './workflow-run-status-timestamps.helper';

@Injectable()
export class WorkflowFailedJobRetryService {
  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly parser: WorkflowParserService,
    private readonly promptLoader: PromptLoaderService,
    private readonly jobMessageQueue: WorkflowJobMessageQueueService,
    @Optional() private readonly budgetDecisionService?: BudgetDecisionService,
  ) {}

  async retryFailedJobWithMessage(params: {
    workflowRunId: string;
    failedJobId?: string;
    retryPrompt: string;
    onRetryResolved?: (
      context: FailedJobRetryResolvedContext,
    ) => void | Promise<void>;
  }): Promise<FailedJobRetryResult | false> {
    const originalRun = await this.runRepo.findById(params.workflowRunId);
    if (!originalRun || originalRun.status !== WorkflowStatus.FAILED) {
      return false;
    }

    const failedJobId =
      readNonEmptyString(params.failedJobId) ??
      readNonEmptyString(originalRun.current_step_id);
    if (!failedJobId) {
      return false;
    }

    const workflow = await this.workflowRepo.findByIdentifier(
      originalRun.workflow_id,
      { includeInactive: true },
    );
    if (!workflow) {
      return false;
    }

    const definition = await this.loadWorkflowDefinition(
      workflow.yaml_definition,
    );
    const job = definition.jobs?.find(
      (candidate) => candidate.id === failedJobId,
    );
    if (!job) {
      return false;
    }

    await params.onRetryResolved?.({ failedJobId });

    await this.checkRetryBudget(params.workflowRunId);

    await this.runRepo.update(params.workflowRunId, {
      status: WorkflowStatus.RUNNING,
      current_step_id: failedJobId,
    });

    try {
      await this.jobMessageQueue.retryJobWithMessage(
        params.workflowRunId,
        failedJobId,
        job,
        undefined,
        params.retryPrompt,
        definition.permissions || undefined,
        definition.skill_discovery_mode || undefined,
        definition.skills || undefined,
      );
    } catch (error) {
      await this.runRepo.update(params.workflowRunId, {
        status: WorkflowStatus.FAILED,
        current_step_id: failedJobId,
        ...buildRunStatusTimestampPatch(
          originalRun,
          WorkflowStatus.FAILED,
          new Date(),
        ),
      });
      throw error;
    }

    return { retried: true, failedJobId };
  }

  private async checkRetryBudget(runId: string): Promise<void> {
    try {
      const result = await this.budgetDecisionService?.evaluateAction({
        scopeId: null,
        contextType: 'workflow_run',
        contextId: runId,
        actionType: 'step_execution',
        actorType: 'system',
        actorId: null,
        providerName: null,
        modelName: null,
        expectedTokens: null,
        correlationId: runId,
      });
      if (result?.decision === 'deny') {
        throw new Error(`Retry blocked by budget policy: ${result.reasonCode}`);
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('blocked by budget policy')
      ) {
        throw err;
      }
    }
  }

  private async loadWorkflowDefinition(
    yamlDefinition: string,
  ): Promise<IWorkflowDefinition> {
    const parsedDefinition = this.parser.parseWorkflow(yamlDefinition);
    return this.promptLoader.resolveWorkflowPromptsWithRetry(parsedDefinition);
  }
}

function readNonEmptyString(value: unknown): string | null {
  const trimmed = readString(value)?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
