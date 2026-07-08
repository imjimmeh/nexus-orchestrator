import { Injectable } from '@nestjs/common';
import { workflowCreateSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { WorkflowMetaToolsHandler } from '../../handlers/workflow-meta-tools.handler';

interface CreateWorkflowDefinitionParams {
  yaml_definition: string;
}

@Injectable()
export class CreateWorkflowDefinitionTool implements IInternalToolHandler<CreateWorkflowDefinitionParams> {
  constructor(private readonly workflowTools: WorkflowMetaToolsHandler) {}

  getName(): string {
    return 'create_workflow_definition';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'approval_gated'],
      description: 'Create a new workflow definition from yaml_definition.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/workflows/create',
        bodyMapping: {
          yaml_definition: 'yaml_definition',
        },
      },
      mutatingAction: 'create_workflow_definition',
      inputSchema: workflowCreateSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: CreateWorkflowDefinitionParams,
  ): Promise<Record<string, unknown>> {
    return this.workflowTools.createWorkflow(params);
  }
}
