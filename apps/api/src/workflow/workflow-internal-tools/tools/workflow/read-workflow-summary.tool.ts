import { Injectable } from '@nestjs/common';
import {
  ReadWorkflowSummaryInput,
  readWorkflowSummarySchema,
} from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { WorkflowMetaToolsHandler } from '../../handlers/workflow-meta-tools.handler';

@Injectable()
export class ReadWorkflowSummaryTool implements IInternalToolHandler<ReadWorkflowSummaryInput> {
  constructor(private readonly handler: WorkflowMetaToolsHandler) {}

  getName(): string {
    return 'read_workflow_summary';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context', 'workflows'],
      description: 'Read a compact summary of a workflow definition.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/workflows/read-summary',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          workflow_id: 'workflow_id',
        },
      },
      inputSchema: readWorkflowSummarySchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: ReadWorkflowSummaryInput,
  ) {
    return this.handler.readWorkflowSummary(params.workflow_id);
  }
}
