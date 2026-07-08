import type { ImprovementProposal } from './database/entities/improvement-proposal.entity';

/**
 * `proposal` is nullable because `ImprovementProposalService.submitProposal`
 * can resolve `{ outcome: 'dropped', proposal: null }` when the governance
 * policy drops a low-confidence draft before any row is created — the same
 * outcome intake must surface for a fresh `code_change` submission that
 * never becomes a duplicate.
 */
export interface CodeChangeProposalIntakeResult {
  proposal: ImprovementProposal | null;
  deduplicated: boolean;
}
