import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { RejectLearningCandidateHandler } from '../../handlers/reject-learning-candidate.handler';

export const rejectLearningCandidateSchema = z.object({
  candidate_id: z.string(),
  reason: z.string().optional(),
});

type RejectLearningCandidateParams = z.infer<
  typeof rejectLearningCandidateSchema
>;

@Injectable()
export class RejectLearningCandidateTool implements IInternalToolHandler<RejectLearningCandidateParams> {
  constructor(
    private readonly rejectLearningCandidateHandler: RejectLearningCandidateHandler,
  ) {}

  getName(): string {
    return 'reject_learning_candidate';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'context'],
      description: 'Reject a learning candidate.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/learning/candidates/reject',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          candidate_id: 'candidate_id',
          reason: 'reason',
        },
      },
      inputSchema: rejectLearningCandidateSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: RejectLearningCandidateParams,
  ): Promise<Record<string, unknown>> {
    return this.rejectLearningCandidateHandler.rejectCandidate(params);
  }
}
