import { Injectable } from '@nestjs/common';
import { listWorkflowsSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { WorkflowMetaToolsHandler } from '../../handlers/workflow-meta-tools.handler';

interface ListWorkflowsParams {
  include_inactive?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ListWorkflowsTool implements IInternalToolHandler<ListWorkflowsParams> {
  constructor(private readonly workflowTools: WorkflowMetaToolsHandler) {}

  getName(): string {
    return 'list_workflows';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context'],
      description: 'List workflow definitions with pagination support.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/workflows/list',
        bodyMapping: {
          include_inactive: 'include_inactive',
          limit: 'limit',
          offset: 'offset',
        },
      },
      inputSchema: listWorkflowsSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: ListWorkflowsParams,
  ): Promise<Record<string, unknown>> {
    return this.workflowTools.listWorkflows(params);
  }
}
