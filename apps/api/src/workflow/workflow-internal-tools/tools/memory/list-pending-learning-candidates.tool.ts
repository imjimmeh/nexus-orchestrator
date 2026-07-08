import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { ListPendingLearningCandidatesHandler } from '../../handlers/list-pending-learning-candidates.handler';

export const listPendingLearningCandidatesSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
});

type ListPendingLearningCandidatesParams = z.infer<
  typeof listPendingLearningCandidatesSchema
>;

@Injectable()
export class ListPendingLearningCandidatesTool implements IInternalToolHandler<ListPendingLearningCandidatesParams> {
  constructor(
    private readonly listPendingLearningCandidatesHandler: ListPendingLearningCandidatesHandler,
  ) {}

  getName(): string {
    return 'list_pending_learning_candidates';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context'],
      description: 'List pending memory learning candidates.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/learning/candidates/list-pending',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          limit: 'limit',
          offset: 'offset',
        },
      },
      inputSchema: listPendingLearningCandidatesSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: ListPendingLearningCandidatesParams,
  ): Promise<Record<string, unknown>> {
    return this.listPendingLearningCandidatesHandler.listPendingCandidates(
      params,
    );
  }
}
