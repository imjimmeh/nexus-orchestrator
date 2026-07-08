import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { IMemorySegment } from '@nexus/core';
import { MemoryContradictionService } from './memory-contradiction.service';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import { MemorySegmentLearningCandidateRepository } from '../database/repositories/memory-segment.learning-candidate.repository';
import { ImprovementProposalRepository } from '../../improvement/database/repositories/improvement-proposal.repository';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { MemoryManagerService } from '../memory-manager.service';
import { LearningPromotionPolicyService } from './learning-promotion-policy.service';
import { PromotionGovernancePolicyService } from './promotion-governance-policy.service';
import {
  buildGovernanceRoutedEvent,
  buildPromotedEvent,
  buildPromotionFailedEvent,
  buildPromotionSucceededEvent,
} from './learning-promotion.events';
import type {
  GovernanceRoutedOutcome,
  LearningPromotionOptions,
  LearningPromotionPolicyDecision,
  LearningPromotionResult,
  LearningPromotionStatus,
  PromotionFailureStage,
  RouteDispatch,
  SegmentDestination,
} from './learning-promotion.types';
import type { GovernanceDecision } from './promotion-governance-policy.types';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { LEARNING_PROMOTION_MIN_CONFIDENCE_SETTING } from '../../settings/learning-settings.constants';
import { MemoryMetricsService } from '../memory-metrics.service';
import { MetricsService } from '../../observability/metrics.service';
import {
  buildMetadata,
  isPromotedCandidate,
  isUniqueViolation,
  normalizeRequestedBy,
  readLesson,
  readProvenanceString,
  readPromotionPolicy,
  toAlreadyPromotedDecision,
} from './learning-promotion.helpers';
import {
  PromotionEvent,
  PromotionState,
} from './learning-promotion.state.types';
import { transition } from './learning-promotion.state';
import {
  ensureMemorySegmentOrFailWrite,
  evaluatePolicyOrDeny,
  markPromotedAndFinalize,
} from './learning-promotion.finalize';
import type { FinalizeStepDependencies } from './learning-promotion.finalize.types';
import { dispatchByRoute } from './learning-promotion.dispatch';
import type { RouteDispatchDependencies } from './learning-promotion.dispatch.types';

const PROMOTION_CLAIM_STALE_AFTER_MS = 15 * 60 * 1000;

type GovernanceTerminalEvent = Extract<
  PromotionEvent,
  'GOVERNANCE_DROP' | 'GOVERNANCE_SKILL_ROUTE' | 'GOVERNANCE_REQUIRES_PROPOSAL'
>;

/**
 * Map a governance-terminal {@link LearningPromotionStatus} (drop / proposal /
 * requires_proposal) onto the matching {@link PromotionEvent}. Throws if the
 * status is not a governance terminal — callers must only invoke this with
 * one of the three governance outcomes from `dispatchByRoute`.
 */
function governanceTerminalEvent(
  status: LearningPromotionStatus,
): GovernanceTerminalEvent {
  switch (status) {
    case 'dropped':
      return 'GOVERNANCE_DROP';
    case 'routed_to_proposal':
      return 'GOVERNANCE_SKILL_ROUTE';
    case 'requires_proposal':
      return 'GOVERNANCE_REQUIRES_PROPOSAL';
    case 'promoted':
      throw new Error(
        'Cannot map governance terminal for status=promoted; this is the auto-promote path, not a governance terminal.',
      );
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled governance outcome: ${String(exhaustive)}`);
    }
  }
}

@Injectable()
export class LearningPromotionService {
  constructor(
    private readonly candidates: LearningCandidateRepository,
    private readonly memorySegments: MemorySegmentCrudRepository,
    private readonly learningCandidateSegments: MemorySegmentLearningCandidateRepository,
    private readonly memoryManager: MemoryManagerService,
    private readonly policy: LearningPromotionPolicyService,
    private readonly eventLedger: EventLedgerService,
    private readonly settings: SystemSettingsService,
    private readonly memoryMetrics: MemoryMetricsService,
    private readonly metrics: MetricsService,
    private readonly governancePolicy: PromotionGovernancePolicyService,
    private readonly improvementProposals: ImprovementProposalRepository,
    @Optional() private readonly contradiction?: MemoryContradictionService,
  ) {}

  /**
   * Drive `LearningPromotionService`'s promotion flow as an explicit state
   * machine. Every external call returns a value that maps to a single
   * {@link PromotionEvent}; the next state is computed by
   * {@link transition} so the flow control is auditable from one place.
   * The state machine itself lives in `./learning-promotion.state` and is
   * unit tested in isolation.
   */
  async promoteCandidate(
    candidateId: string,
    options: LearningPromotionOptions = {},
  ): Promise<LearningPromotionResult> {
    const requestedBy = normalizeRequestedBy(options.requestedBy);
    const { candidate, state: loadedState } =
      await this.loadCandidateOrThrow(candidateId);

    if (isPromotedCandidate(candidate)) {
      transition(loadedState, 'ALREADY_PROMOTED');
      return this.returnExistingPromotion(candidate);
    }

    const afterPendingState = transition(loadedState, 'PENDING_PROMOTION');
    const claimStartedAt = new Date();
    const staleBefore = new Date(
      claimStartedAt.getTime() - PROMOTION_CLAIM_STALE_AFTER_MS,
    );
    const claimedCandidate = await this.candidates.claimPendingPromotion(
      candidate.id,
      { staleBefore, claimedAt: claimStartedAt },
    );
    if (!claimedCandidate) {
      transition(afterPendingState, 'CLAIM_LOST');
      return await this.throwPromotionClaimConflict(candidate.id, {
        requestedBy,
      });
    }
    const afterClaimState = transition(afterPendingState, 'CLAIM_ACQUIRED');

    const dispatch = await this.dispatchByRoute(
      claimedCandidate,
      claimStartedAt,
      requestedBy,
    );
    if (dispatch.handled) {
      transition(
        afterClaimState,
        governanceTerminalEvent(dispatch.result.status),
      );
      return dispatch.result;
    }
    const afterRouteState = transition(
      afterClaimState,
      'GOVERNANCE_AUTO_PROMOTE',
    );

    return await this.finalizeAutoPromotion(
      afterRouteState,
      claimedCandidate,
      claimStartedAt,
      { requestedBy, destination: dispatch.destination },
    );
  }

  /**
   * Promote each candidate independently via the existing claim-based
   * {@link promoteCandidate} flow, sequentially, reporting a per-item result.
   * Not a single DB transaction: promotion creates external memory-segment
   * side effects and already has its own per-candidate concurrency guard
   * (`claimPendingPromotion`), so partial success across the batch is the
   * correct semantics, not all-or-nothing.
   */
  async bulkPromote(
    candidateIds: string[],
    options: LearningPromotionOptions = {},
  ): Promise<
    Array<{
      candidateId: string;
      result?: LearningPromotionResult;
      error?: string;
    }>
  > {
    const results: Array<{
      candidateId: string;
      result?: LearningPromotionResult;
      error?: string;
    }> = [];

    for (const candidateId of candidateIds) {
      try {
        const result = await this.promoteCandidate(candidateId, options);
        results.push({ candidateId, result });
      } catch (error) {
        results.push({
          candidateId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Step 1: load the candidate by id and advance the state machine from
   * `IDLE`. Returns the candidate + next state, OR throws
   * `NotFoundException` (after a `CANDIDATE_NOT_FOUND` transition) when the
   * candidate is missing. Keeps the public method from doing two DB calls.
   */
  private async loadCandidateOrThrow(
    candidateId: string,
  ): Promise<{ candidate: LearningCandidate; state: PromotionState }> {
    const candidate = await this.candidates.findById(candidateId);
    if (!candidate) {
      transition(PromotionState.IDLE, 'CANDIDATE_NOT_FOUND');
      throw new NotFoundException(
        `Learning candidate ${candidateId} not found`,
      );
    }
    return {
      candidate,
      state: transition(PromotionState.IDLE, 'CANDIDATE_FOUND'),
    };
  }

  /** Consult `routing_target` + the governance matrix; an un-routed candidate is a no-op. */
  private dispatchByRoute(
    candidate: LearningCandidate,
    claimStartedAt: Date,
    requestedBy: string | undefined,
  ): Promise<RouteDispatch> {
    return dispatchByRoute(
      this.buildRouteDispatchDependencies(),
      candidate,
      claimStartedAt,
      requestedBy,
    );
  }

  /** Build the dependency bundle the route dispatch functions consume. */
  private buildRouteDispatchDependencies(): RouteDispatchDependencies {
    return {
      candidates: this.candidates,
      improvementProposals: this.improvementProposals,
      governancePolicy: this.governancePolicy,
      releasePromotionClaim: (candidateId, claimStartedAt) =>
        this.candidates.releasePromotionClaim(candidateId, claimStartedAt),
      emitGovernanceOutcome: (candidate, governance, outcome, options) =>
        this.emitGovernanceOutcome(candidate, governance, outcome, options),
    };
  }

  /**
   * Drive the auto-promotion tail of the flow on the state machine. Each
   * external call is its own step that emits one event; cleanup + telemetry
   * for each failure stage is performed in the step that owns the call.
   */
  private async finalizeAutoPromotion(
    startState: PromotionState,
    claimedCandidate: LearningCandidate,
    claimStartedAt: Date,
    options: {
      requestedBy: string | undefined;
      destination?: SegmentDestination;
    },
  ): Promise<LearningPromotionResult> {
    const { requestedBy, destination } = options;
    const deps = this.buildFinalizeStepDependencies();
    const minimumConfidence = await this.settings.get<number>(
      LEARNING_PROMOTION_MIN_CONFIDENCE_SETTING,
      0.5,
    );

    const { decision, state: policyState } = await evaluatePolicyOrDeny(
      deps,
      claimedCandidate,
      startState,
      claimStartedAt,
      minimumConfidence,
      requestedBy,
    );

    const { segment: memorySegment, state: segmentState } =
      await ensureMemorySegmentOrFailWrite(
        deps,
        claimedCandidate,
        decision,
        policyState,
        claimStartedAt,
        { requestedBy, destination },
      );

    return await markPromotedAndFinalize(
      deps,
      claimedCandidate,
      memorySegment,
      decision,
      segmentState,
      claimStartedAt,
      requestedBy,
    );
  }

  /**
   * Build the dependency bundle the auto-promotion step functions consume.
   * Re-built per call so a future caller can't accidentally share state
   * across flow invocations; cheap because all members are method refs.
   */
  private buildFinalizeStepDependencies(): FinalizeStepDependencies {
    return {
      candidates: this.candidates,
      policy: this.policy,
      settings: this.settings,
      contradiction: this.contradiction,
      findExistingMemorySegment: (candidate) =>
        this.findExistingMemorySegment(candidate),
      createMemorySegment: (candidate, decision, opts) =>
        this.createMemorySegment(candidate, decision, opts),
      returnExistingPromotion: (candidate) =>
        this.returnExistingPromotion(candidate),
      emitSucceeded: (candidate, memorySegment, decision, opts) =>
        this.emitSucceeded(candidate, memorySegment, decision, opts),
      emitPromoted: (candidate, memorySegment, decision) =>
        this.emitPromoted(candidate, memorySegment, decision),
      emitFailed: (candidate, decision, memorySegment, stage, opts) =>
        this.emitFailed(candidate, decision, memorySegment, stage, opts),
    };
  }

  private async throwPromotionClaimConflict(
    id: string,
    options: LearningPromotionOptions = {},
  ): Promise<LearningPromotionResult> {
    const latest = await this.candidates.findById(id);
    if (!latest) {
      throw new NotFoundException(`Learning candidate ${id} not found`);
    }

    if (isPromotedCandidate(latest)) {
      return this.returnExistingPromotion(latest);
    }

    const decision = this.policy.evaluate(latest);
    await this.emitFailed(latest, decision, null, 'claim_promotion', options);

    throw new ConflictException(
      `Learning candidate ${id} is not available for promotion`,
    );
  }

  private async returnExistingPromotion(
    candidate: LearningCandidate & { promoted_memory_segment_id: string },
  ): Promise<LearningPromotionResult> {
    const memorySegment = await this.findPromotedMemorySegment(candidate);
    if (!memorySegment) {
      throw new ConflictException(
        `Learning candidate ${candidate.id} promoted memory segment was not found`,
      );
    }

    const decision =
      readPromotionPolicy(memorySegment) ??
      toAlreadyPromotedDecision(candidate);

    return {
      candidate_id: candidate.id,
      memory_segment_id: memorySegment.id,
      status: 'promoted',
      policy_decision: decision,
      candidate,
      memory_segment: memorySegment,
      routing_target: candidate.routing_target,
    };
  }

  /** Create the memory segment; un-routed candidates keep today's project/fact shape. */
  private async createMemorySegment(
    candidate: LearningCandidate,
    decision: LearningPromotionPolicyDecision,
    options: {
      requestedBy?: string;
      destination?: SegmentDestination;
    } = {},
  ): Promise<IMemorySegment> {
    const { requestedBy, destination } = options;
    const entityType = destination?.entityType ?? candidate.scope_type;
    const entityId = destination?.entityId ?? candidate.scopeId ?? 'global';
    const memoryType = destination?.memoryType ?? 'fact';
    const metadata = buildMetadata(candidate, decision, {
      requestedBy,
      probationUntil: destination?.probationUntil ?? undefined,
      routingTarget: candidate.routing_target,
    });

    const created = await this.memoryManager
      .createMemorySegment(
        entityType,
        entityId,
        readLesson(candidate),
        memoryType,
        metadata,
      )
      .catch(async (error: unknown) => {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        const existing = await this.findExistingMemorySegment(candidate);
        if (!existing) {
          throw error;
        }

        return existing;
      });

    return this.stampGovernanceState(created, destination?.governanceState);
  }

  private async stampGovernanceState(
    segment: IMemorySegment,
    governanceState: string | null | undefined,
  ): Promise<IMemorySegment> {
    if (!governanceState) {
      return segment;
    }
    const updated = await this.memorySegments.update(segment.id, {
      governance_state: governanceState,
    });
    return updated ?? segment;
  }

  private async findExistingMemorySegment(
    candidate: LearningCandidate,
  ): Promise<IMemorySegment | null> {
    return this.learningCandidateSegments.findLearningCandidateSegment(
      candidate.scope_type,
      candidate.scopeId ?? 'global',
      candidate.id,
    );
  }

  private async findPromotedMemorySegment(
    candidate: LearningCandidate & { promoted_memory_segment_id: string },
  ): Promise<IMemorySegment | null> {
    const byId = await this.memorySegments.findById(
      candidate.promoted_memory_segment_id,
    );
    if (byId) {
      return byId;
    }

    return this.findExistingMemorySegment(candidate);
  }

  private emitSucceeded(
    candidate: LearningCandidate,
    memorySegment: IMemorySegment,
    decision: LearningPromotionPolicyDecision,
    options: LearningPromotionOptions = {},
  ): Promise<void> {
    return this.eventLedger.emitBestEffort(
      buildPromotionSucceededEvent(
        candidate,
        memorySegment,
        decision,
        options.requestedBy,
      ),
    );
  }

  private emitPromoted(
    candidate: LearningCandidate,
    memorySegment: IMemorySegment,
    decision: LearningPromotionPolicyDecision,
  ): Promise<void> {
    const scope = `${candidate.scope_type}:${candidate.scopeId ?? 'global'}`;
    const sourceDecisionId =
      readProvenanceString(candidate, 'sourceDecisionId') ??
      `policy:${decision.policyName}:${decision.code}`;
    this.memoryMetrics.recordLearningPromoted({
      candidate_id: candidate.id,
      confidence: candidate.confidence,
      scope,
      source_decision_id: sourceDecisionId,
    });
    this.metrics.recordLearningPromoted();
    return this.eventLedger.emitBestEffort(
      buildPromotedEvent(
        candidate,
        memorySegment,
        decision,
        scope,
        sourceDecisionId,
      ),
    );
  }

  private emitGovernanceOutcome(
    candidate: LearningCandidate,
    governance: GovernanceDecision,
    outcome: GovernanceRoutedOutcome,
    options: { requestedBy?: string; skillProposalId?: string } = {},
  ): Promise<void> {
    return this.eventLedger.emitBestEffort(
      buildGovernanceRoutedEvent(candidate, governance, outcome, options),
    );
  }

  private emitFailed(
    candidate: LearningCandidate,
    decision: LearningPromotionPolicyDecision,
    memorySegment: IMemorySegment | null,
    failureStage: PromotionFailureStage,
    options: LearningPromotionOptions = {},
  ): Promise<void> {
    return this.eventLedger.emitBestEffort(
      buildPromotionFailedEvent(
        candidate,
        decision,
        memorySegment,
        failureStage,
        options.requestedBy,
      ),
    );
  }
}
