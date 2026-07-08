import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import type {
  AgentExecutionContext,
  AgentUserContext,
} from './workflow-runtime/workflow-runtime-tools.types';

/**
 * Centralises resolution of agent execution context (WorkflowRunId + JobId)
 * from either an explicit params object or a JWT `agent:<runId>:<jobId>` token.
 *
 * Used by WorkflowRuntimeToolsService, WorkflowRuntimeSubagentToolsService,
 * and WorkflowRuntimeMeshDelegationToolsService in place of duplicated
 * parseAgentExecutionContext helpers.
 */
@Injectable()
export class ExecutionContextResolverService {
  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepository: IWorkflowRunRepository,
  ) {}

  /**
   * Parses `agent:<workflowRunId>:<jobId>` from a userId string.
   * Returns null when the format does not match.
   */
  parseAgentToken(userId: string | undefined): AgentExecutionContext | null {
    if (!userId?.startsWith('agent:')) {
      return null;
    }

    const parts = userId.split(':');
    if (parts.length < 3) {
      return null;
    }

    const workflowRunId = parts[1]?.trim();
    const jobId = parts[2]?.trim();

    if (!workflowRunId || !jobId) {
      return null;
    }

    return { workflowRunId, jobId };
  }

  /**
   * Resolves the WorkflowRunId from an explicit param or the JWT agent token.
   * Throws BadRequestException when neither source provides a value.
   */
  resolveWorkflowRunId(params: {
    workflowRunId?: string;
    user?: AgentUserContext;
  }): string {
    const fromToken = this.parseAgentToken(params.user?.userId);
    const resolved =
      params.workflowRunId ??
      params.user?.workflowRunId ??
      fromToken?.workflowRunId;

    if (!resolved) {
      throw new BadRequestException(
        'workflow_run_id is required when agent token context is unavailable',
      );
    }

    return resolved;
  }

  /**
   * Resolves a full AgentExecutionContext from params + JWT token, falling back
   * to `current_step_id` on the run when jobId cannot be derived from the token.
   * Throws BadRequestException when no run or job can be resolved.
   */
  async resolveAgentExecutionContext(params: {
    workflowRunId?: string;
    jobId?: string;
    user?: AgentUserContext;
  }): Promise<AgentExecutionContext> {
    const fromToken = this.parseAgentToken(params.user?.userId);

    const workflowRunId =
      params.workflowRunId ??
      params.user?.workflowRunId ??
      fromToken?.workflowRunId;
    if (!workflowRunId) {
      throw new BadRequestException(
        'workflow_run_id is required when agent token context is unavailable',
      );
    }

    const run = await this.runRepository.findById(workflowRunId);
    if (!run) {
      throw new BadRequestException(`Workflow run ${workflowRunId} not found`);
    }

    const jobId =
      params.user?.jobId ??
      fromToken?.jobId ??
      params.jobId ??
      run.current_step_id;
    if (!jobId) {
      throw new BadRequestException(
        `Unable to resolve job_id for workflow run ${workflowRunId}`,
      );
    }

    return { workflowRunId, jobId };
  }
}
