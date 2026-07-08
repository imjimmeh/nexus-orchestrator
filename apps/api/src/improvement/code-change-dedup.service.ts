import { Injectable } from '@nestjs/common';
import type { CodeChangeProposalPayload } from '@nexus/core';
import { CodeChangeProposalPayloadSchema } from '@nexus/core';
import { normalizeCodeChangeTitle } from './code-change-dedup.helpers';
import type { ImprovementProposal } from './database/entities/improvement-proposal.entity';
import { ImprovementProposalRepository } from './database/repositories/improvement-proposal.repository';

export const CODE_CHANGE_DEDUP_RECENT_DAYS = 30;
export const CODE_CHANGE_DEDUP_STATUSES = ['pending', 'applied'] as const;

/**
 * Finds an existing `code_change` proposal that describes the same
 * underlying issue as a new draft, so intake can bump `occurrence_count`
 * on the existing row instead of filing a duplicate.
 *
 * Exact normalized-title equality (`normalizeCodeChangeTitle`) against the
 * recent-candidate corpus (`ImprovementProposalRepository
 * .findRecentByKindAndStatuses`) is currently the ONLY dedup tier.
 *
 * An embedding/lexical-similarity tier (via `ICandidateSimilarity.findNearest`
 * — the same pattern `LearningRouterService.matchExistingSkill` uses for
 * skill dedup) was deliberately left OUT: `EmbeddingSimilarityService` fuses
 * its embedding and lexical arms with Reciprocal Rank Fusion whenever both
 * arms return hits (`RRF_K = 60`), which caps the fused score at
 * `2 / (RRF_K + 1) ≈ 0.033` — structurally below
 * `CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT` (0.85). Comparing a fused score to
 * 0.85 can never fire, so wiring that tier in here would look like working
 * similarity dedup while never actually deduping anything.
 * `ICandidateSimilarity` has no raw 0..1 cosine/lexical score separate from
 * the fused `findNearest` result, so there is no principled threshold to
 * substitute. `LearningRouterService.matchExistingSkill` has the identical
 * unresolved RRF/threshold-scale mismatch against the same shared
 * `EmbeddingSimilarityService` — fixing that shared service's threshold
 * semantics is out of scope here; this service intentionally stays on the
 * exact-title tier until it is.
 */
@Injectable()
export class CodeChangeDedupService {
  constructor(private readonly proposals: ImprovementProposalRepository) {}

  async findDuplicate(
    payload: CodeChangeProposalPayload,
  ): Promise<ImprovementProposal | null> {
    const recent = await this.proposals.findRecentByKindAndStatuses(
      'code_change',
      [...CODE_CHANGE_DEDUP_STATUSES],
      CODE_CHANGE_DEDUP_RECENT_DAYS,
    );
    if (recent.length === 0) {
      return null;
    }

    return this.findByNormalizedTitle(payload, recent);
  }

  private findByNormalizedTitle(
    payload: CodeChangeProposalPayload,
    recent: ImprovementProposal[],
  ): ImprovementProposal | null {
    const normalizedTitle = normalizeCodeChangeTitle(payload.title);
    for (const proposal of recent) {
      const existing = this.readPayload(proposal);
      if (
        existing !== null &&
        normalizeCodeChangeTitle(existing.title) === normalizedTitle
      ) {
        return proposal;
      }
    }
    return null;
  }

  /**
   * Parses a stored proposal's payload, tolerating rows whose payload has
   * drifted from the current `CodeChangeProposalPayloadSchema` (e.g. a
   * legacy row from before a schema change). A single unparsable row in the
   * dedup window must not fail intake for every new `code_change`
   * submission, so this skips (returns `null` for) the offending row instead
   * of throwing.
   */
  private readPayload(
    proposal: ImprovementProposal,
  ): CodeChangeProposalPayload | null {
    const result = CodeChangeProposalPayloadSchema.safeParse(proposal.payload);
    return result.success ? result.data : null;
  }
}
