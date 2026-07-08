import type { IMemorySegment } from '@nexus/core';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import type { EmitEventLedgerParams } from '../../observability/event-ledger.service.types';
import {
  normalizeRequestedBy,
  readProvenanceString,
  toEventPolicy,
} from './learning-promotion.helpers';
import type {
  GovernanceRoutedOutcome,
  LearningPromotionPolicyDecision,
  PromotionFailureStage,
} from './learning-promotion.types';
import type { GovernanceDecision } from './promotion-governance-policy.types';

const PROMOTION_FAILURE_ERROR_CODE = 'LEARNING_PROMOTION_FAILED';
const PROMOTION_FAILURE_MESSAGE = 'Learning promotion failed.';

function provenance(candidate: LearningCandidate): {
  workflowRunId?: string;
  jobId?: string;
} {
  return {
    workflowRunId: readProvenanceString(candidate, 'workflowRunId'),
    jobId: readProvenanceString(candidate, 'jobId'),
  };
}

export function buildPromotionSucceededEvent(
  candidate: LearningCandidate,
  memorySegment: IMemorySegment,
  decision: LearningPromotionPolicyDecision,
  requestedByRaw: string | undefined,
): EmitEventLedgerParams {
  const requestedBy = normalizeRequestedBy(requestedByRaw);
  return {
    domain: 'memory',
    eventName: AUTONOMY_EVENT_NAMES.learningPromotionSucceeded,
    outcome: 'success',
    ...provenance(candidate),
    payload: {
      candidate_id: candidate.id,
      memory_segment_id: memorySegment.id,
      scope_type: candidate.scope_type,
      scope_id: candidate.scopeId,
      ...(requestedBy ? { requested_by: requestedBy } : {}),
      confidence: candidate.confidence,
      promotion_policy: toEventPolicy(decision),
    },
  };
}

export function buildPromotedEvent(
  candidate: LearningCandidate,
  memorySegment: IMemorySegment,
  decision: LearningPromotionPolicyDecision,
  scope: string,
  sourceDecisionId: string,
): EmitEventLedgerParams {
  return {
    domain: 'memory',
    eventName: AUTONOMY_EVENT_NAMES.learningPromoted,
    outcome: 'success',
    ...provenance(candidate),
    payload: {
      candidate_id: candidate.id,
      memory_segment_id: memorySegment.id,
      confidence: candidate.confidence,
      scope,
      scope_type: candidate.scope_type,
      scope_id: candidate.scopeId,
      source_decision_id: sourceDecisionId,
      promotion_policy: toEventPolicy(decision),
    },
  };
}

export function buildGovernanceRoutedEvent(
  candidate: LearningCandidate,
  governance: GovernanceDecision,
  outcome: GovernanceRoutedOutcome,
  options: { requestedBy?: string; skillProposalId?: string } = {},
): EmitEventLedgerParams {
  const requestedBy = normalizeRequestedBy(options.requestedBy);
  return {
    domain: 'memory',
    eventName: AUTONOMY_EVENT_NAMES.learningRouted,
    outcome: 'success',
    ...provenance(candidate),
    payload: {
      candidate_id: candidate.id,
      routing_target: candidate.routing_target,
      routed_outcome: outcome,
      governance_reason: governance.reason,
      requires_proposal: governance.requiresProposal,
      drop: governance.drop,
      ...(options.skillProposalId
        ? { skill_proposal_id: options.skillProposalId }
        : {}),
      ...(requestedBy ? { requested_by: requestedBy } : {}),
      confidence: candidate.confidence,
    },
  };
}

export function buildPromotionFailedEvent(
  candidate: LearningCandidate,
  decision: LearningPromotionPolicyDecision,
  memorySegment: IMemorySegment | null,
  failureStage: PromotionFailureStage,
  requestedByRaw: string | undefined,
): EmitEventLedgerParams {
  const requestedBy = normalizeRequestedBy(requestedByRaw);
  return {
    domain: 'memory',
    eventName: AUTONOMY_EVENT_NAMES.learningPromotionFailed,
    outcome: 'failure',
    ...provenance(candidate),
    payload: {
      candidate_id: candidate.id,
      ...(memorySegment ? { memory_segment_id: memorySegment.id } : {}),
      failure_stage: failureStage,
      scope_type: candidate.scope_type,
      scope_id: candidate.scopeId,
      ...(requestedBy ? { requested_by: requestedBy } : {}),
      confidence: candidate.confidence,
      promotion_policy: toEventPolicy(decision),
    },
    errorCode: PROMOTION_FAILURE_ERROR_CODE,
    errorMessage: PROMOTION_FAILURE_MESSAGE,
  };
}
