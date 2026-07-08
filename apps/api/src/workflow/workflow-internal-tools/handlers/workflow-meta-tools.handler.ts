import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { IWorkflowDefinition } from '@nexus/core';
import { WORKFLOW_PERSISTENCE_SERVICE } from '../../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowPersistenceService } from '../../kernel/interfaces/workflow-kernel.ports';
import { requireNonEmptyString } from '../../workflow-runtime/workflow-runtime-tools.helpers';

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

@Injectable()
export class WorkflowMetaToolsHandler {
  constructor(
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
  ) {}

  async listWorkflows(params: {
    include_inactive?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Record<string, unknown>> {
    const pagination = this.resolvePagination(params.limit, params.offset);
    const workflows = await this.workflowPersistence.getAllWorkflowsPaged(
      pagination,
      {
        includeInactive: !!params.include_inactive,
      },
    );

    return {
      include_inactive: !!params.include_inactive,
      total: workflows.total,
      limit: pagination.limit,
      offset: pagination.offset,
      workflows: workflows.data,
    };
  }

  async getWorkflow(workflowId: string): Promise<Record<string, unknown>> {
    const workflow = await this.workflowPersistence.getWorkflow(
      requireNonEmptyString(workflowId, 'workflow_id'),
    );

    return {
      workflow,
    };
  }

  async createWorkflow(params: {
    yaml_definition: string;
  }): Promise<Record<string, unknown>> {
    const workflow = await this.workflowPersistence.createWorkflow(
      requireNonEmptyString(params.yaml_definition, 'yaml_definition'),
    );

    return {
      workflow,
    };
  }

  async updateWorkflow(params: {
    workflow_id: string;
    yaml_definition: string;
  }): Promise<Record<string, unknown>> {
    const updated = await this.workflowPersistence.updateWorkflow(
      requireNonEmptyString(params.workflow_id, 'workflow_id'),
      requireNonEmptyString(params.yaml_definition, 'yaml_definition'),
    );

    if (!updated) {
      throw new NotFoundException(`Workflow ${params.workflow_id} not found`);
    }

    return {
      workflow: updated,
    };
  }

  async deleteWorkflow(workflowId: string): Promise<Record<string, unknown>> {
    const normalizedWorkflowId = requireNonEmptyString(
      workflowId,
      'workflow_id',
    );
    await this.workflowPersistence.deleteWorkflow(normalizedWorkflowId);

    return {
      workflow_id: normalizedWorkflowId,
      deactivated: true,
    };
  }

  async searchWorkflows(params: {
    query?: string;
    include_inactive?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Record<string, unknown>> {
    const workflowsResult = await this.listWorkflows({
      include_inactive: params.include_inactive,
      limit: params.limit,
      offset: params.offset,
    });

    const query = params.query?.trim().toLowerCase();
    const data = (workflowsResult.workflows as IWorkflowDefinition[]) || [];

    return {
      ...workflowsResult,
      workflows: query
        ? data.filter((workflow) =>
            JSON.stringify(workflow).toLowerCase().includes(query),
          )
        : data,
    };
  }

  async readWorkflowSummary(
    workflowId: string,
  ): Promise<Record<string, unknown>> {
    const { workflow } = (await this.getWorkflow(workflowId)) as {
      workflow: IWorkflowDefinition;
    };

    return {
      workflow: this.summarizeWorkflow(workflow),
    };
  }

  private summarizeWorkflow(
    workflow: IWorkflowDefinition,
  ): Record<string, unknown> {
    return {
      workflow_id: workflow.workflow_id,
      name: workflow.name,
      description: workflow.description,
      trigger: workflow.trigger,
      jobs: (workflow.jobs || []).map((job) => {
        const jobRecord = job as unknown as Record<string, unknown>;
        return {
          id: jobRecord.id,
          type: jobRecord.type,
          tier: jobRecord.tier,
          agent_profile: readOptionalString(jobRecord.agent_profile),
          depends_on: jobRecord.depends_on,
        };
      }),
      permissions: workflow.permissions,
    };
  }

  private resolvePagination(
    limit?: number,
    offset?: number,
  ): {
    limit: number;
    offset: number;
  } {
    const resolvedLimit =
      typeof limit === 'number' && Number.isInteger(limit) && limit > 0
        ? limit
        : 20;
    const resolvedOffset =
      typeof offset === 'number' && Number.isInteger(offset) && offset >= 0
        ? offset
        : 0;

    return {
      limit: resolvedLimit,
      offset: resolvedOffset,
    };
  }
}
