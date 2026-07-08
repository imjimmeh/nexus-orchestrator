import { Injectable } from '@nestjs/common';
import { SearchWorkflowsInput, searchWorkflowsSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { WorkflowMetaToolsHandler } from '../../handlers/workflow-meta-tools.handler';

@Injectable()
export class SearchWorkflowsTool implements IInternalToolHandler<SearchWorkflowsInput> {
  constructor(private readonly handler: WorkflowMetaToolsHandler) {}

  getName(): string {
    return 'search_workflows';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context', 'workflows'],
      description: 'Search workflow definitions by query.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/workflows/search',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          query: 'query',
          include_inactive: 'include_inactive',
          limit: 'limit',
          offset: 'offset',
        },
      },
      inputSchema: searchWorkflowsSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: SearchWorkflowsInput,
  ) {
    return this.handler.searchWorkflows(params);
  }
}
