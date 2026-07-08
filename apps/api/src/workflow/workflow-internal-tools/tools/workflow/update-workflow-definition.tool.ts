import { Injectable } from '@nestjs/common';
import { workflowUpdateSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { WorkflowMetaToolsHandler } from '../../handlers/workflow-meta-tools.handler';

interface UpdateWorkflowDefinitionParams {
  workflow_id: string;
  yaml_definition: string;
}

@Injectable()
export class UpdateWorkflowDefinitionTool implements IInternalToolHandler<UpdateWorkflowDefinitionParams> {
  constructor(private readonly workflowTools: WorkflowMetaToolsHandler) {}

  getName(): string {
    return 'update_workflow_definition';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'approval_gated'],
      description: 'Update an existing workflow definition by workflow_id.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/workflows/update',
        bodyMapping: {
          workflow_id: 'workflow_id',
          yaml_definition: 'yaml_definition',
        },
      },
      mutatingAction: 'update_workflow_definition',
      inputSchema: workflowUpdateSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: UpdateWorkflowDefinitionParams,
  ): Promise<Record<string, unknown>> {
    return this.workflowTools.updateWorkflow(params);
  }
}
