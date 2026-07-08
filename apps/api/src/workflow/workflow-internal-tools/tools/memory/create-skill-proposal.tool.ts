import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { CreateSkillProposalHandler } from '../../handlers/create-skill-proposal.handler';

export const createSkillProposalSchema = z.object({
  candidate_id: z.string(),
  target_skill_name: z.string(),
  proposal_title: z.string(),
  proposal_summary: z.string(),
  patch_markdown: z.string(),
  rationale: z.string().optional(),
});

type CreateSkillProposalParams = z.infer<typeof createSkillProposalSchema>;

@Injectable()
export class CreateSkillProposalTool implements IInternalToolHandler<CreateSkillProposalParams> {
  constructor(
    private readonly createSkillProposalHandler: CreateSkillProposalHandler,
  ) {}

  getName(): string {
    return 'create_skill_proposal';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'context'],
      description: 'Create a new skill improvement proposal.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/learning/proposals/create',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          candidate_id: 'candidate_id',
          target_skill_name: 'target_skill_name',
          proposal_title: 'proposal_title',
          proposal_summary: 'proposal_summary',
          patch_markdown: 'patch_markdown',
          rationale: 'rationale',
        },
      },
      inputSchema: createSkillProposalSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: CreateSkillProposalParams,
  ): Promise<Record<string, unknown>> {
    return this.createSkillProposalHandler.createSkillProposal(params);
  }
}
