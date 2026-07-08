import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { PromoteLearningCandidateHandler } from '../../handlers/promote-learning-candidate.handler';

export const promoteLearningCandidateSchema = z.object({
  candidate_id: z.string(),
  operator_scope: z.string().optional(),
});

type PromoteLearningCandidateParams = z.infer<
  typeof promoteLearningCandidateSchema
>;

@Injectable()
export class PromoteLearningCandidateTool implements IInternalToolHandler<PromoteLearningCandidateParams> {
  constructor(
    private readonly promoteLearningCandidateHandler: PromoteLearningCandidateHandler,
  ) {}

  getName(): string {
    return 'promote_learning_candidate';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'context'],
      description: 'Promote a learning candidate to persistent memory segment.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/learning/candidates/promote',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          candidate_id: 'candidate_id',
          operator_scope: 'operator_scope',
        },
      },
      inputSchema: promoteLearningCandidateSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: PromoteLearningCandidateParams,
  ): Promise<Record<string, unknown>> {
    return this.promoteLearningCandidateHandler.promoteCandidate(params);
  }
}
