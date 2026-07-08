import { Inject, Injectable } from '@nestjs/common';
import {
  formatRunningWorkflowsSummary,
  normalizeOptionalString,
} from '@nexus/core';
import {
  WORKFLOW_PERSISTENCE_SERVICE,
  type IWorkflowPersistenceService,
} from '../kernel/interfaces/workflow-kernel.ports';
import type {
  ListRunningWorkflowsParams,
  ListRunningWorkflowsResult,
} from './workflow-runtime-running-workflows.service.types';

/**
 * Read-only runtime capability that lets an orchestrating agent see the
 * workflows already active for its scope, so it does not re-spawn work that is
 * already in flight. Backs both the `list_running_workflows` tool and the
 * running-workflows block auto-injected into orchestration prompts.
 */
@Injectable()
export class WorkflowRuntimeRunningWorkflowsService {
  constructor(
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
  ) {}

  async listRunningWorkflows(
    params: ListRunningWorkflowsParams,
  ): Promise<ListRunningWorkflowsResult> {
    const callerRunId =
      normalizeOptionalString(params.workflow_run_id) ?? undefined;
    const scopeId = await this.resolveScopeId(params.scope_id, callerRunId);

    if (!scopeId) {
      return { scope_id: null, count: 0, running_workflows: [], summary: '' };
    }

    const runningWorkflows =
      await this.workflowPersistence.getRunningWorkflowSummariesByScopeId(
        scopeId,
        { excludeRunId: callerRunId, limit: params.limit },
      );

    return {
      scope_id: scopeId,
      count: runningWorkflows.length,
      running_workflows: runningWorkflows,
      summary: formatRunningWorkflowsSummary(runningWorkflows, params.limit),
    };
  }

  private async resolveScopeId(
    explicitScopeId: string | undefined,
    callerRunId: string | undefined,
  ): Promise<string | null> {
    const direct = normalizeOptionalString(explicitScopeId);
    if (direct) {
      return direct;
    }
    if (!callerRunId) {
      return null;
    }

    const run = await this.workflowPersistence.getWorkflowRun(callerRunId);
    const trigger =
      run?.state_variables && typeof run.state_variables.trigger === 'object'
        ? (run.state_variables.trigger as Record<string, unknown>)
        : {};
    return (
      normalizeOptionalString(trigger.scopeId) ??
      normalizeOptionalString(trigger.scope_id) ??
      null
    );
  }
}
