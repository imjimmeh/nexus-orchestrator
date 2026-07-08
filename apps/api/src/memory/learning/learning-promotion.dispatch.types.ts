import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { ImprovementProposalRepository } from '../../improvement/database/repositories/improvement-proposal.repository';
import type { PromotionGovernancePolicyService } from './promotion-governance-policy.service';
import type { GovernanceDecision } from './promotion-governance-policy.types';
import type { GovernanceRoutedOutcome } from './learning-promotion.types';

/** Dependencies the route-aware dispatch needs. */
export interface RouteDispatchDependencies {
  readonly candidates: LearningCandidateRepository;
  /**
   * Injected directly (not `ImprovementProposalService`) — the skill-route
   * dispatch is only reached after `PromotionGovernancePolicyService` has
   * already gated the candidate, so routing it back through
   * `ImprovementGovernancePolicyService` would be double governance.
   */
  readonly improvementProposals: ImprovementProposalRepository;
  readonly governancePolicy: PromotionGovernancePolicyService;
  readonly releasePromotionClaim: (
    candidateId: string,
    claimStartedAt: Date,
  ) => Promise<unknown>;
  readonly emitGovernanceOutcome: (
    candidate: LearningCandidate,
    governance: GovernanceDecision,
    outcome: GovernanceRoutedOutcome,
    options?: { requestedBy?: string; skillProposalId?: string },
  ) => Promise<void>;
}
