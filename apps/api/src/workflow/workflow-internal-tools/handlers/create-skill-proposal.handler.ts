import { Injectable } from '@nestjs/common';
import { ImprovementProposalService } from '../../../improvement/improvement-proposal.service';
import { requireNonEmptyString } from '../../workflow-runtime/workflow-runtime-tools.helpers';
import {
  buildCreateSkillProposalDraft,
  toCreateSkillProposalResult,
  toExistingSkillProposalResult,
} from './create-skill-proposal.helpers';

/**
 * Extracted handler for the `create_skill_proposal` runtime capability
 * (refactoring work item: split `MemoryToolsHandler` per public method).
 *
 * Routes an agent-initiated skill proposal onto the `skill_create`
 * improvement pipeline (Epic A/B) — GOVERNED (unlike the learning-promotion
 * skill route, which bypasses governance because `PromotionGovernancePolicy`
 * already gated it upstream). The legacy `SkillImprovementProposalRepository`
 * write path has been retired; proposals now flow through
 * `ImprovementProposalService.submitProposal`. See
 * {@link buildCreateSkillProposalDraft} for the draft shape.
 */
@Injectable()
export class CreateSkillProposalHandler {
  constructor(
    private readonly improvementProposals: ImprovementProposalService,
  ) {}

  async createSkillProposal(params: {
    candidate_id: string;
    target_skill_name: string;
    proposal_title: string;
    proposal_summary: string;
    patch_markdown: string;
    rationale?: string;
  }): Promise<Record<string, unknown>> {
    const candidateId = requireNonEmptyString(
      params.candidate_id,
      'candidate_id',
    );
    const targetSkillName = requireNonEmptyString(
      params.target_skill_name,
      'target_skill_name',
    );
    const proposalTitle = requireNonEmptyString(
      params.proposal_title,
      'proposal_title',
    );
    const proposalSummary = requireNonEmptyString(
      params.proposal_summary,
      'proposal_summary',
    );
    const patchMarkdown = requireNonEmptyString(
      params.patch_markdown,
      'patch_markdown',
    );

    const existing =
      await this.improvementProposals.findPendingSkillCreateByTargetName(
        targetSkillName,
      );
    if (existing !== null) {
      return toExistingSkillProposalResult(existing);
    }

    const draft = buildCreateSkillProposalDraft(candidateId, {
      target_skill_name: targetSkillName,
      proposal_title: proposalTitle,
      proposal_summary: proposalSummary,
      patch_markdown: patchMarkdown,
      rationale: params.rationale,
    });
    const result = await this.improvementProposals.submitProposal(draft);
    return toCreateSkillProposalResult(result);
  }
}
