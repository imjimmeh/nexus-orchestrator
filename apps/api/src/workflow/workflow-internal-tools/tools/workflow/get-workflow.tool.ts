import { Injectable } from '@nestjs/common';
import { workflowIdentitySchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { WorkflowMetaToolsHandler } from '../../handlers/workflow-meta-tools.handler';

interface WorkflowIdentityParams {
  workflow_id: string;
}

@Injectable()
export class GetWorkflowTool implements IInternalToolHandler<WorkflowIdentityParams> {
  constructor(private readonly workflowTools: WorkflowMetaToolsHandler) {}

  getName(): string {
    return 'get_workflow';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context'],
      description: 'Get a workflow definition by workflow ID.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/workflows/get',
        bodyMapping: {
          workflow_id: 'workflow_id',
        },
      },
      inputSchema: workflowIdentitySchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: WorkflowIdentityParams,
  ): Promise<Record<string, unknown>> {
    return this.workflowTools.getWorkflow(params.workflow_id);
  }
}
