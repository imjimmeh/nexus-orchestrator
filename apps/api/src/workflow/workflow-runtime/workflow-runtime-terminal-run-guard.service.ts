import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isTerminalWorkflowRunStatus } from '@nexus/core';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import type { WorkflowRuntimeTerminalRunActionContext } from './workflow-runtime-terminal-run-guard.types';

@Injectable()
export class WorkflowRuntimeTerminalRunGuardService {
  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepository: IWorkflowRunRepository,
  ) {}

  async assertRunIsActive(
    workflowRunId: string,
    context: WorkflowRuntimeTerminalRunActionContext,
  ): Promise<void> {
    const run = await this.runRepository.findById(workflowRunId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${workflowRunId} not found`);
    }

    if (!this.isTerminalStatus(run.status)) {
      return;
    }

    throw new ConflictException({
      code: 'workflow_run_terminal',
      retryable: false,
      workflowRunId,
      status: run.status,
      action: context.action,
      message: `Workflow run ${workflowRunId} has terminal status ${run.status}; ${context.action} is not allowed. Stop work immediately; no further workflow runtime tool calls are accepted for this run.`,
    });
  }

  isTerminalStatus(status: unknown): boolean {
    return isTerminalWorkflowRunStatus(status);
  }
}
