import { Injectable } from '@nestjs/common';
import { workflowIdentitySchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { WorkflowMetaToolsHandler } from '../../handlers/workflow-meta-tools.handler';

interface DeleteWorkflowDefinitionParams {
  workflow_id: string;
}

@Injectable()
export class DeleteWorkflowDefinitionTool implements IInternalToolHandler<DeleteWorkflowDefinitionParams> {
  constructor(private readonly workflowTools: WorkflowMetaToolsHandler) {}

  getName(): string {
    return 'delete_workflow_definition';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'approval_gated'],
      description: 'Deactivate a workflow definition by workflow_id.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/workflows/delete',
        bodyMapping: {
          workflow_id: 'workflow_id',
        },
      },
      mutatingAction: 'delete_workflow_definition',
      inputSchema: workflowIdentitySchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: DeleteWorkflowDefinitionParams,
  ): Promise<Record<string, unknown>> {
    return this.workflowTools.deleteWorkflow(params.workflow_id);
  }
}
