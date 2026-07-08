import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type {
  LearningPromotionResult,
  RouteDispatch,
} from './learning-promotion.types';
import {
  buildSkillCreateProposalDraft,
  isSkillRoute,
  resolveSegmentDestination,
} from './learning-promotion.helpers';
import type {
  GovernanceDecision,
  GovernanceEvaluationInput,
} from './promotion-governance-policy.types';
import type { RouteDispatchDependencies } from './learning-promotion.dispatch.types';

/**
 * Consult `routing_target` + the governance matrix BEFORE the existing
 * 0.5-floor policy. An un-routed candidate is a no-op (handled=false) so the
 * existing auto-promote path runs unchanged. A routed candidate's verdict is
 * one of `dropped` / `routed_to_proposal` / `requires_proposal` (handled=true)
 * or auto-promote (handled=false with a destination).
 */
export async function dispatchByRoute(
  deps: RouteDispatchDependencies,
  candidate: LearningCandidate,
  claimStartedAt: Date,
  requestedBy: string | undefined,
): Promise<RouteDispatch> {
  const routingTarget = candidate.routing_target;
  if (!routingTarget) {
    return { handled: false };
  }

  const governance = await deps.governancePolicy.evaluate({
    routingTarget: routingTarget as GovernanceEvaluationInput['routingTarget'],
    confidence: candidate.confidence,
  });

  try {
    if (governance.drop) {
      return {
        handled: true,
        result: await handleDrop(
          deps,
          candidate,
          claimStartedAt,
          governance,
          requestedBy,
        ),
      };
    }
    if (governance.autoPromote) {
      return {
        handled: false,
        destination: resolveSegmentDestination(candidate, governance),
      };
    }
    if (isSkillRoute(routingTarget)) {
      return {
        handled: true,
        result: await handleSkillProposal(
          deps,
          candidate,
          claimStartedAt,
          governance,
          requestedBy,
        ),
      };
    }
    return {
      handled: true,
      result: await handleRequiresProposal(
        deps,
        candidate,
        claimStartedAt,
        governance,
        requestedBy,
      ),
    };
  } catch (error) {
    await deps.candidates
      .releasePromotionClaim(candidate.id, claimStartedAt)
      .catch(() => undefined);
    throw error;
  }
}

/** Mark the candidate `dropped` + emit the governance outcome. */
export async function handleDrop(
  deps: RouteDispatchDependencies,
  candidate: LearningCandidate,
  claimStartedAt: Date,
  governance: GovernanceDecision,
  requestedBy: string | undefined,
): Promise<LearningPromotionResult> {
  const updated = await deps.candidates.markStatusIfClaimed(
    candidate.id,
    'dropped',
    claimStartedAt,
  );
  await deps.emitGovernanceOutcome(candidate, governance, 'dropped', {
    requestedBy,
  });
  return {
    candidate_id: candidate.id,
    status: 'dropped',
    candidate: updated ?? candidate,
    governance_decision: governance,
    routing_target: candidate.routing_target,
  };
}

/** Create a pending skill_create improvement proposal + mark candidate `routed_to_proposal`. */
export async function handleSkillProposal(
  deps: RouteDispatchDependencies,
  candidate: LearningCandidate,
  claimStartedAt: Date,
  governance: GovernanceDecision,
  requestedBy: string | undefined,
): Promise<LearningPromotionResult> {
  const proposal = await deps.improvementProposals.create(
    buildSkillCreateProposalDraft(candidate),
  );
  const updated = await deps.candidates.markStatusIfClaimed(
    candidate.id,
    'routed_to_proposal',
    claimStartedAt,
  );
  await deps.emitGovernanceOutcome(
    candidate,
    governance,
    'routed_to_proposal',
    { requestedBy, skillProposalId: proposal.id },
  );
  return {
    candidate_id: candidate.id,
    status: 'routed_to_proposal',
    candidate: updated ?? candidate,
    governance_decision: governance,
    routing_target: candidate.routing_target,
    skill_proposal_id: proposal.id,
  };
}

/** "Never auto-lands" rail: release the claim + leave the candidate pending. */
export async function handleRequiresProposal(
  deps: RouteDispatchDependencies,
  candidate: LearningCandidate,
  claimStartedAt: Date,
  governance: GovernanceDecision,
  requestedBy: string | undefined,
): Promise<LearningPromotionResult> {
  await deps.candidates.releasePromotionClaim(candidate.id, claimStartedAt);
  await deps.emitGovernanceOutcome(candidate, governance, 'requires_proposal', {
    requestedBy,
  });
  const latest = await deps.candidates.findById(candidate.id);
  return {
    candidate_id: candidate.id,
    status: 'requires_proposal',
    candidate: latest ?? candidate,
    governance_decision: governance,
    routing_target: candidate.routing_target,
  };
}
