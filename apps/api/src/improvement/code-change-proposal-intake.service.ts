import { Injectable, Logger } from '@nestjs/common';
import { CodeChangeProposalPayloadSchema } from '@nexus/core';
import { CodeChangeDedupService } from './code-change-dedup.service';
import { ImprovementProposalRepository } from './database/repositories/improvement-proposal.repository';
import { ImprovementProposalService } from './improvement-proposal.service';
import type { ImprovementProposalDraft } from './improvement-proposal.service.types';
import type { CodeChangeProposalIntakeResult } from './code-change-proposal-intake.service.types';

/**
 * Single, mandatory entry point for `code_change` producers. Runs dedup
 * before any row is created: a duplicate bumps `occurrence_count` on the
 * existing proposal so recurring failure classes become a prioritization
 * signal, never queue spam. Only a genuinely new issue reaches
 * `ImprovementProposalService.submitProposal` (Epic A governance/apply
 * pipeline).
 */
@Injectable()
export class CodeChangeProposalIntakeService {
  private readonly logger = new Logger(CodeChangeProposalIntakeService.name);

  constructor(
    private readonly dedup: CodeChangeDedupService,
    private readonly proposals: ImprovementProposalRepository,
    private readonly proposalService: ImprovementProposalService,
  ) {}

  async submitCodeChangeProposal(
    draft: ImprovementProposalDraft,
  ): Promise<CodeChangeProposalIntakeResult> {
    const payload = CodeChangeProposalPayloadSchema.parse(draft.payload);
    const duplicate = await this.dedup.findDuplicate(payload);
    if (duplicate) {
      const refreshed = await this.proposals.bumpOccurrence(duplicate.id);
      this.logger.log(
        `code_change draft deduplicated against proposal ${duplicate.id}`,
      );
      return { proposal: refreshed ?? duplicate, deduplicated: true };
    }
    const submitted = await this.proposalService.submitProposal(draft);
    return { proposal: submitted.proposal, deduplicated: false };
  }
}
