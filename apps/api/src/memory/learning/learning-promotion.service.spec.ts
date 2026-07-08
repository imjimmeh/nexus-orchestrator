import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import { MemorySegmentLearningCandidateRepository } from '../database/repositories/memory-segment.learning-candidate.repository';
import { MemoryManagerService } from '../memory-manager.service';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { LearningPromotionPolicyService } from './learning-promotion-policy.service';
import { LearningPromotionService } from './learning-promotion.service';
import { PromotionGovernancePolicyService } from './promotion-governance-policy.service';
import { ImprovementProposalRepository } from '../../improvement/database/repositories/improvement-proposal.repository';
import type { GovernanceDecision } from './promotion-governance-policy.types';
import { MemoryMetricsService } from '../memory-metrics.service';
import { MetricsService } from '../../observability/metrics.service';
import {
  PromotionEvent,
  PromotionState,
} from './learning-promotion.state.types';
import { transition as driveTransition } from './learning-promotion.state';

describe('LearningPromotionService', () => {
  const candidates = {
    findById: vi.fn(),
    claimPendingPromotion: vi.fn(),
    releasePromotionClaim: vi.fn(),
    markPromotedIfClaimed: vi.fn(),
    markStatusIfClaimed: vi.fn(),
  };
  const memoryManager = {
    createMemorySegment: vi.fn(),
  };
  const memorySegments = {
    findById: vi.fn(),
    findLearningCandidateSegment: vi.fn(),
    update: vi.fn(),
  };
  const governancePolicy = {
    evaluate: vi.fn(),
  };
  const improvementProposals = {
    create: vi.fn(),
  };
  const eventLedger = {
    emitBestEffort: vi.fn(),
  };
  const policy = new LearningPromotionPolicyService();
  const settings = {
    get: vi.fn(async (_key: string, defaultValue: unknown) => defaultValue),
  };
  const memoryMetrics = {
    recordBackendRead: vi.fn(),
    recordBackendWrite: vi.fn(),
    recordBackendFallback: vi.fn(),
    recordDistillationCompleted: vi.fn(),
    recordLearningPromoted: vi.fn(),
    setActiveSegments: vi.fn(),
    snapshot: vi.fn(),
  };
  const promMetrics = {
    recordMemoryBackendRead: vi.fn(),
    recordMemoryBackendWrite: vi.fn(),
    setMemoryBackendActiveSegments: vi.fn(),
    recordMemoryBackendFallback: vi.fn(),
    recordDistillationCompleted: vi.fn(),
    recordLearningPromoted: vi.fn(),
  };

  let service: LearningPromotionService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T12:00:00.000Z'));
    vi.clearAllMocks();

    service = new LearningPromotionService(
      candidates as unknown as LearningCandidateRepository,
      memorySegments as unknown as MemorySegmentCrudRepository,
      memorySegments as unknown as MemorySegmentLearningCandidateRepository,
      memoryManager as unknown as MemoryManagerService,
      policy,
      eventLedger as unknown as EventLedgerService,
      settings as any,
      memoryMetrics as unknown as MemoryMetricsService,
      promMetrics as unknown as MetricsService,
      governancePolicy as unknown as PromotionGovernancePolicyService,
      improvementProposals as unknown as ImprovementProposalRepository,
    );

    candidates.findById.mockResolvedValue(createCandidate());
    candidates.claimPendingPromotion.mockResolvedValue(
      createCandidate({ status: 'promotion_in_progress' }),
    );
    candidates.releasePromotionClaim.mockResolvedValue(undefined);
    candidates.markPromotedIfClaimed.mockImplementation(
      (_id: string, memorySegmentId: string, promotedAt: Date) =>
        Object.assign(createCandidate(), {
          status: 'promoted',
          promoted_memory_segment_id: memorySegmentId,
          promoted_at: promotedAt,
        }),
    );
    memoryManager.createMemorySegment.mockResolvedValue(createMemorySegment());
    memorySegments.findById.mockResolvedValue(null);
    memorySegments.findLearningCandidateSegment.mockResolvedValue(null);
    memorySegments.update.mockImplementation(
      (id: string, data: Record<string, unknown>) =>
        Object.assign(createMemorySegment({ id }), data),
    );
    candidates.markStatusIfClaimed.mockImplementation(
      (_id: string, status: string) =>
        Object.assign(createCandidate(), { status }),
    );
    governancePolicy.evaluate.mockResolvedValue(autoPromoteDecision());
    improvementProposals.create.mockResolvedValue({ id: 'proposal-1' });
  });

  it('promotes an approved candidate into memory and marks it promoted', async () => {
    const result = await service.promoteCandidate('candidate-1', {
      requestedBy: 'admin-user',
    });

    expect(memoryManager.createMemorySegment).toHaveBeenCalledWith(
      'workflow',
      'global',
      'Prefer deterministic tests for workflow repair behavior.',
      'fact',
      expect.objectContaining({
        source: 'learning_candidate',
        learning_candidate_id: 'candidate-1',
        scope_type: 'workflow',
        scope_id: null,
        workflow_run_id: 'workflow-run-1',
        job_id: 'job-1',
        agent_profile_name: 'doctor',
        requested_by: 'admin-user',
        confidence: 0.8,
        tags: ['testing', 'repair'],
        evidence: [
          {
            kind: 'job_output',
            id: 'job-1',
            summary: 'Repair succeeded after adding deterministic tests.',
          },
        ],
        promotion_policy: expect.objectContaining({
          approved: true,
          code: 'approved',
        }),
      }),
    );
    expect(candidates.claimPendingPromotion).toHaveBeenCalledWith(
      'candidate-1',
      {
        claimedAt: new Date('2026-05-16T12:00:00.000Z'),
        staleBefore: new Date('2026-05-16T11:45:00.000Z'),
      },
    );
    expect(candidates.markPromotedIfClaimed).toHaveBeenCalledWith(
      'candidate-1',
      'memory-1',
      new Date('2026-05-16T12:00:00.000Z'),
      new Date('2026-05-16T12:00:00.000Z'),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningPromotionSucceeded,
        outcome: 'success',
        payload: expect.objectContaining({
          candidate_id: 'candidate-1',
          memory_segment_id: 'memory-1',
          scope_type: 'workflow',
          scope_id: null,
          requested_by: 'admin-user',
          confidence: 0.8,
          promotion_policy: expect.objectContaining({ code: 'approved' }),
        }),
      }),
    );
    expect(result).toMatchObject({
      candidate_id: 'candidate-1',
      memory_segment_id: 'memory-1',
      status: 'promoted',
      policy_decision: expect.objectContaining({ approved: true }),
      candidate: expect.objectContaining({
        id: 'candidate-1',
        status: 'promoted',
        promoted_memory_segment_id: 'memory-1',
      }),
      memory_segment: expect.objectContaining({ id: 'memory-1' }),
    });
    expect(memoryMetrics.recordLearningPromoted).toHaveBeenCalledWith({
      candidate_id: 'candidate-1',
      confidence: 0.8,
      scope: 'workflow:global',
      source_decision_id: 'policy:runtime-learning-auto-promotion:approved',
    });
    expect(promMetrics.recordLearningPromoted).toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningPromoted,
        outcome: 'success',
        payload: expect.objectContaining({
          candidate_id: 'candidate-1',
          memory_segment_id: 'memory-1',
          confidence: 0.8,
          scope: 'workflow:global',
          scope_type: 'workflow',
          scope_id: null,
          source_decision_id: 'policy:runtime-learning-auto-promotion:approved',
        }),
      }),
    );
  });

  it('throws NotFoundException when the candidate is missing', async () => {
    candidates.findById.mockResolvedValue(null);

    await expect(service.promoteCandidate('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws ConflictException and releases the claim when policy denies the claimed candidate', async () => {
    candidates.claimPendingPromotion.mockResolvedValue(
      createCandidate({
        status: 'promotion_in_progress',
        summary: '   ',
        signals_json: { lesson: '   ' },
      }),
    );

    await expect(
      service.promoteCandidate('candidate-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(candidates.claimPendingPromotion).toHaveBeenCalledWith(
      'candidate-1',
      {
        claimedAt: new Date('2026-05-16T12:00:00.000Z'),
        staleBefore: new Date('2026-05-16T11:45:00.000Z'),
      },
    );
    expect(candidates.releasePromotionClaim).toHaveBeenCalledWith(
      'candidate-1',
      new Date('2026-05-16T12:00:00.000Z'),
    );
    expect(candidates.markPromotedIfClaimed).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningPromotionFailed,
        outcome: 'failure',
        payload: expect.objectContaining({
          candidate_id: 'candidate-1',
          failure_stage: 'policy_denied',
        }),
      }),
    );
  });

  it('reuses an existing learning candidate memory segment instead of creating a duplicate', async () => {
    const existingSegment = createMemorySegment({ id: 'memory-existing' });
    memorySegments.findLearningCandidateSegment.mockResolvedValue(
      existingSegment,
    );

    const result = await service.promoteCandidate('candidate-1');

    expect(memorySegments.findLearningCandidateSegment).toHaveBeenCalledWith(
      'workflow',
      'global',
      'candidate-1',
    );
    expect(memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(candidates.markPromotedIfClaimed).toHaveBeenCalledWith(
      'candidate-1',
      'memory-existing',
      new Date('2026-05-16T12:00:00.000Z'),
      new Date('2026-05-16T12:00:00.000Z'),
    );
    expect(result.memory_segment).toBe(existingSegment);
  });

  it('returns the existing promoted result when promotion is repeated', async () => {
    const promotedCandidate = createCandidate({
      status: 'promoted',
      promoted_memory_segment_id: 'memory-existing',
      promoted_at: new Date('2026-05-16T12:00:00.000Z'),
    });
    const existingSegment = createMemorySegment({ id: 'memory-existing' });
    candidates.findById.mockResolvedValue(promotedCandidate);
    memorySegments.findById.mockResolvedValue(existingSegment);

    const result = await service.promoteCandidate('candidate-1');

    expect(candidates.claimPendingPromotion).not.toHaveBeenCalled();
    expect(memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(candidates.markPromotedIfClaimed).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      candidate_id: 'candidate-1',
      memory_segment_id: 'memory-existing',
      status: 'promoted',
      candidate: promotedCandidate,
      memory_segment: existingSegment,
      policy_decision: expect.objectContaining({
        approved: true,
        code: 'already_promoted',
      }),
    });
  });

  it('recovers a stale in-progress candidate by reusing its existing memory segment', async () => {
    const existingSegment = createMemorySegment({ id: 'memory-existing' });
    candidates.findById.mockResolvedValue(
      createCandidate({ status: 'promotion_in_progress' }),
    );
    candidates.claimPendingPromotion.mockResolvedValue(
      createCandidate({ status: 'promotion_in_progress' }),
    );
    memorySegments.findLearningCandidateSegment.mockResolvedValue(
      existingSegment,
    );

    const result = await service.promoteCandidate('candidate-1');

    expect(candidates.claimPendingPromotion).toHaveBeenCalledWith(
      'candidate-1',
      {
        claimedAt: new Date('2026-05-16T12:00:00.000Z'),
        staleBefore: new Date('2026-05-16T11:45:00.000Z'),
      },
    );
    expect(memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(candidates.markPromotedIfClaimed).toHaveBeenCalledWith(
      'candidate-1',
      'memory-existing',
      new Date('2026-05-16T12:00:00.000Z'),
      new Date('2026-05-16T12:00:00.000Z'),
    );
    expect(result.memory_segment_id).toBe('memory-existing');
  });

  it('throws ConflictException and does not write memory when the promotion claim is lost', async () => {
    candidates.claimPendingPromotion.mockResolvedValue(null);
    candidates.findById
      .mockResolvedValueOnce(createCandidate())
      .mockResolvedValueOnce(
        createCandidate({ status: 'promotion_in_progress' }),
      );

    await expect(
      service.promoteCandidate('candidate-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(candidates.markPromotedIfClaimed).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningPromotionFailed,
        outcome: 'failure',
        payload: expect.objectContaining({
          candidate_id: 'candidate-1',
          failure_stage: 'claim_promotion',
        }),
      }),
    );
  });

  it('returns the existing promoted result when a lost claim reloads a promoted candidate', async () => {
    const promotedCandidate = createCandidate({
      status: 'promoted',
      promoted_memory_segment_id: 'memory-existing',
      promoted_at: new Date('2026-05-16T12:00:00.000Z'),
    });
    const existingSegment = createMemorySegment({ id: 'memory-existing' });
    candidates.claimPendingPromotion.mockResolvedValue(null);
    candidates.findById
      .mockResolvedValueOnce(createCandidate())
      .mockResolvedValueOnce(promotedCandidate);
    memorySegments.findById.mockResolvedValue(existingSegment);

    const result = await service.promoteCandidate('candidate-1');

    expect(memoryManager.createMemorySegment).not.toHaveBeenCalled();
    expect(candidates.markPromotedIfClaimed).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      candidate_id: 'candidate-1',
      memory_segment_id: 'memory-existing',
      status: 'promoted',
      candidate: promotedCandidate,
      memory_segment: existingSegment,
      policy_decision: expect.objectContaining({
        approved: true,
        code: 'already_promoted',
      }),
    });
  });

  it('emits a failure event and leaves the candidate unpromoted when memory write fails', async () => {
    memoryManager.createMemorySegment.mockRejectedValue(
      new Error('backend down'),
    );

    await expect(service.promoteCandidate('candidate-1')).rejects.toThrow(
      'backend down',
    );

    expect(candidates.releasePromotionClaim).toHaveBeenCalledWith(
      'candidate-1',
      new Date('2026-05-16T12:00:00.000Z'),
    );
    expect(candidates.markPromotedIfClaimed).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningPromotionFailed,
        outcome: 'failure',
        errorCode: 'LEARNING_PROMOTION_FAILED',
        errorMessage: 'Learning promotion failed.',
        payload: expect.objectContaining({
          candidate_id: 'candidate-1',
          failure_stage: 'write_memory',
          scope_type: 'workflow',
          scope_id: null,
          confidence: 0.8,
          promotion_policy: expect.objectContaining({ code: 'approved' }),
        }),
      }),
    );
  });

  it('emits a failure event with memory id when marking promotion fails after memory creation', async () => {
    candidates.markPromotedIfClaimed.mockResolvedValue(null);

    await expect(service.promoteCandidate('candidate-1')).rejects.toThrow(
      'Learning candidate candidate-1 promotion finalization failed',
    );

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningPromotionFailed,
        outcome: 'failure',
        payload: expect.objectContaining({
          candidate_id: 'candidate-1',
          memory_segment_id: 'memory-1',
          failure_stage: 'finalize_promotion',
          scope_type: 'workflow',
          scope_id: null,
          confidence: 0.8,
          promotion_policy: expect.objectContaining({ code: 'approved' }),
        }),
      }),
    );
    expect(candidates.releasePromotionClaim).toHaveBeenCalledWith(
      'candidate-1',
      new Date('2026-05-16T12:00:00.000Z'),
    );
  });

  it('returns the existing promoted result when finalization loses a claim to a completed promotion', async () => {
    const promotedCandidate = createCandidate({
      status: 'promoted',
      promoted_memory_segment_id: 'memory-existing',
      promoted_at: new Date('2026-05-16T12:00:00.000Z'),
    });
    const existingSegment = createMemorySegment({ id: 'memory-existing' });
    candidates.findById
      .mockResolvedValueOnce(createCandidate())
      .mockResolvedValueOnce(promotedCandidate);
    candidates.markPromotedIfClaimed.mockResolvedValue(null);
    memorySegments.findById.mockResolvedValue(existingSegment);

    const result = await service.promoteCandidate('candidate-1');

    expect(candidates.releasePromotionClaim).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      candidate_id: 'candidate-1',
      memory_segment_id: 'memory-existing',
      status: 'promoted',
      candidate: promotedCandidate,
      memory_segment: existingSegment,
      policy_decision: expect.objectContaining({
        approved: true,
        code: 'already_promoted',
      }),
    });
  });

  it('reuses the existing memory segment after a duplicate promotion write', async () => {
    const existingSegment = createMemorySegment({ id: 'memory-existing' });
    memoryManager.createMemorySegment.mockRejectedValue({ code: '23505' });
    memorySegments.findLearningCandidateSegment
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingSegment);

    const result = await service.promoteCandidate('candidate-1');

    expect(memoryManager.createMemorySegment).toHaveBeenCalledTimes(1);
    expect(candidates.markPromotedIfClaimed).toHaveBeenCalledWith(
      'candidate-1',
      'memory-existing',
      new Date('2026-05-16T12:00:00.000Z'),
      new Date('2026-05-16T12:00:00.000Z'),
    );
    expect(result.memory_segment).toBe(existingSegment);
  });

  describe('route-aware governance dispatch (EPIC-212 Task 10)', () => {
    it('never auto-promotes a global candidate to a segment, even at confidence 0.99', async () => {
      candidates.claimPendingPromotion.mockResolvedValue(
        createCandidate({
          status: 'promotion_in_progress',
          routing_target: 'global',
          confidence: 0.99,
        }),
      );
      governancePolicy.evaluate.mockResolvedValue(requiresProposalDecision());

      const result = await service.promoteCandidate('candidate-1');

      expect(memoryManager.createMemorySegment).not.toHaveBeenCalled();
      expect(candidates.markPromotedIfClaimed).not.toHaveBeenCalled();
      expect(candidates.releasePromotionClaim).toHaveBeenCalledWith(
        'candidate-1',
        new Date('2026-05-16T12:00:00.000Z'),
      );
      expect(result.status).toBe('requires_proposal');
      expect(result.memory_segment_id).toBeUndefined();
    });

    it('auto-promotes a project candidate into a provisional segment', async () => {
      candidates.claimPendingPromotion.mockResolvedValue(
        createCandidate({
          status: 'promotion_in_progress',
          routing_target: 'project',
        }),
      );
      governancePolicy.evaluate.mockResolvedValue(autoPromoteDecision());

      const result = await service.promoteCandidate('candidate-1');

      expect(memoryManager.createMemorySegment).toHaveBeenCalledWith(
        'workflow',
        'global',
        'Prefer deterministic tests for workflow repair behavior.',
        'fact',
        expect.objectContaining({
          routing_target: 'project',
          probation_until: '2026-05-30T12:00:00.000Z',
        }),
      );
      expect(memorySegments.update).toHaveBeenCalledWith('memory-1', {
        governance_state: 'provisional',
      });
      expect(result.status).toBe('promoted');
      expect(result.memory_segment).toMatchObject({
        governance_state: 'provisional',
      });
    });

    it('auto-promotes an agent_preference candidate into an agent preference segment', async () => {
      candidates.claimPendingPromotion.mockResolvedValue(
        createCandidate({
          status: 'promotion_in_progress',
          routing_target: 'agent_preference',
          scopeId: 'doctor-profile',
          confidence: 0.85,
        }),
      );
      governancePolicy.evaluate.mockResolvedValue(autoPromoteDecision());

      const result = await service.promoteCandidate('candidate-1');

      expect(memoryManager.createMemorySegment).toHaveBeenCalledWith(
        'agent',
        'doctor-profile',
        'Prefer deterministic tests for workflow repair behavior.',
        'preference',
        expect.objectContaining({ routing_target: 'agent_preference' }),
      );
      expect(result.status).toBe('promoted');
    });

    it('routes a skill_new candidate to a pending proposal and writes no segment', async () => {
      candidates.claimPendingPromotion.mockResolvedValue(
        createCandidate({
          status: 'promotion_in_progress',
          routing_target: 'skill_new',
        }),
      );
      governancePolicy.evaluate.mockResolvedValue(proposalRouteDecision());

      const result = await service.promoteCandidate('candidate-1');

      expect(improvementProposals.create).toHaveBeenCalledTimes(1);
      expect(improvementProposals.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'skill_create',
          status: 'pending',
          provenance: expect.objectContaining({
            learning_candidate_id: 'candidate-1',
          }),
        }),
      );
      expect(memoryManager.createMemorySegment).not.toHaveBeenCalled();
      expect(candidates.markPromotedIfClaimed).not.toHaveBeenCalled();
      expect(candidates.markStatusIfClaimed).toHaveBeenCalledWith(
        'candidate-1',
        'routed_to_proposal',
        new Date('2026-05-16T12:00:00.000Z'),
      );
      expect(result.status).toBe('routed_to_proposal');
      expect(result.skill_proposal_id).toBe('proposal-1');
    });

    it('drops a noise candidate without creating anything', async () => {
      candidates.claimPendingPromotion.mockResolvedValue(
        createCandidate({
          status: 'promotion_in_progress',
          routing_target: 'drop',
        }),
      );
      governancePolicy.evaluate.mockResolvedValue(dropDecision());

      const result = await service.promoteCandidate('candidate-1');

      expect(memoryManager.createMemorySegment).not.toHaveBeenCalled();
      expect(improvementProposals.create).not.toHaveBeenCalled();
      expect(candidates.markPromotedIfClaimed).not.toHaveBeenCalled();
      expect(candidates.markStatusIfClaimed).toHaveBeenCalledWith(
        'candidate-1',
        'dropped',
        new Date('2026-05-16T12:00:00.000Z'),
      );
      expect(result.status).toBe('dropped');
    });
  });

  describe('state-machine driven flow (refactor)', () => {
    /**
     * Walk the canonical transition table from a starting state through a
     * sequence of events and return the resulting state. Uses the same pure
     * {@link driveTransition} the service uses, so a passing assertion means
     * the service emitted EXACTLY that event sequence.
     */
    function path(
      start: PromotionState,
      events: ReadonlyArray<PromotionEvent>,
    ): PromotionState {
      return events.reduce(
        (current, event) => driveTransition(current, event),
        start,
      );
    }

    it('walks IDLE → ... → PROMOTED on the happy path', async () => {
      const result = await service.promoteCandidate('candidate-1');

      expect(result.status).toBe('promoted');
      expect(
        path(PromotionState.IDLE, [
          'CANDIDATE_FOUND',
          'PENDING_PROMOTION',
          'CLAIM_ACQUIRED',
          'GOVERNANCE_AUTO_PROMOTE',
          'POLICY_APPROVED',
          'MEMORY_SEGMENT_READY',
          'PROMOTION_MARKED',
        ]),
      ).toBe(PromotionState.PROMOTED);
    });

    it('reaches RETURNED_EXISTING_PROMOTION when the candidate is already promoted', async () => {
      const promotedCandidate = createCandidate({
        status: 'promoted',
        promoted_memory_segment_id: 'memory-existing',
        promoted_at: new Date('2026-05-16T12:00:00.000Z'),
      });
      const existingSegment = createMemorySegment({ id: 'memory-existing' });
      candidates.findById.mockResolvedValue(promotedCandidate);
      memorySegments.findById.mockResolvedValue(existingSegment);

      const result = await service.promoteCandidate('candidate-1');

      expect(result.status).toBe('promoted');
      expect(
        path(PromotionState.IDLE, ['CANDIDATE_FOUND', 'ALREADY_PROMOTED']),
      ).toBe(PromotionState.RETURNED_EXISTING_PROMOTION);
    });

    it('reaches CLAIM_LOST when promotion claim was lost to a concurrent promoter', async () => {
      const promotingCandidate = createCandidate({
        status: 'promotion_in_progress',
      });
      candidates.claimPendingPromotion.mockResolvedValue(null);
      candidates.findById
        .mockResolvedValueOnce(createCandidate())
        .mockResolvedValueOnce(promotingCandidate);

      await expect(
        service.promoteCandidate('candidate-1'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(
        path(PromotionState.IDLE, [
          'CANDIDATE_FOUND',
          'PENDING_PROMOTION',
          'CLAIM_LOST',
        ]),
      ).toBe(PromotionState.CLAIM_LOST);
    });

    it('reaches DROPPED_BY_GOVERNANCE when governance drops the candidate', async () => {
      candidates.claimPendingPromotion.mockResolvedValue(
        createCandidate({
          status: 'promotion_in_progress',
          routing_target: 'drop',
        }),
      );
      governancePolicy.evaluate.mockResolvedValue(dropDecision());

      const result = await service.promoteCandidate('candidate-1');

      expect(result.status).toBe('dropped');
      expect(
        path(PromotionState.IDLE, [
          'CANDIDATE_FOUND',
          'PENDING_PROMOTION',
          'CLAIM_ACQUIRED',
          'GOVERNANCE_DROP',
        ]),
      ).toBe(PromotionState.DROPPED_BY_GOVERNANCE);
    });

    it('reaches REQUIRES_PROPOSAL when global routing forbids auto-promotion', async () => {
      candidates.claimPendingPromotion.mockResolvedValue(
        createCandidate({
          status: 'promotion_in_progress',
          routing_target: 'global',
          confidence: 0.99,
        }),
      );
      governancePolicy.evaluate.mockResolvedValue(requiresProposalDecision());

      const result = await service.promoteCandidate('candidate-1');

      expect(result.status).toBe('requires_proposal');
      expect(
        path(PromotionState.IDLE, [
          'CANDIDATE_FOUND',
          'PENDING_PROMOTION',
          'CLAIM_ACQUIRED',
          'GOVERNANCE_REQUIRES_PROPOSAL',
        ]),
      ).toBe(PromotionState.REQUIRES_PROPOSAL);
    });

    it('reaches ROUTED_TO_SKILL_PROPOSAL for a skill route', async () => {
      candidates.claimPendingPromotion.mockResolvedValue(
        createCandidate({
          status: 'promotion_in_progress',
          routing_target: 'skill_new',
        }),
      );
      governancePolicy.evaluate.mockResolvedValue(proposalRouteDecision());

      const result = await service.promoteCandidate('candidate-1');

      expect(result.status).toBe('routed_to_proposal');
      expect(
        path(PromotionState.IDLE, [
          'CANDIDATE_FOUND',
          'PENDING_PROMOTION',
          'CLAIM_ACQUIRED',
          'GOVERNANCE_SKILL_ROUTE',
        ]),
      ).toBe(PromotionState.ROUTED_TO_SKILL_PROPOSAL);
    });

    it('reaches POLICY_DENIED when the policy rejects a claimed candidate', async () => {
      candidates.claimPendingPromotion.mockResolvedValue(
        createCandidate({
          status: 'promotion_in_progress',
          summary: '   ',
          signals_json: { lesson: '   ' },
        }),
      );

      await expect(
        service.promoteCandidate('candidate-1'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(
        path(PromotionState.IDLE, [
          'CANDIDATE_FOUND',
          'PENDING_PROMOTION',
          'CLAIM_ACQUIRED',
          'GOVERNANCE_AUTO_PROMOTE',
          'POLICY_DENIED',
        ]),
      ).toBe(PromotionState.POLICY_DENIED);
    });

    it('reaches PROMOTION_FAILED when memory write fails', async () => {
      memoryManager.createMemorySegment.mockRejectedValue(
        new Error('backend down'),
      );

      await expect(service.promoteCandidate('candidate-1')).rejects.toThrow(
        'backend down',
      );

      expect(
        path(PromotionState.IDLE, [
          'CANDIDATE_FOUND',
          'PENDING_PROMOTION',
          'CLAIM_ACQUIRED',
          'GOVERNANCE_AUTO_PROMOTE',
          'POLICY_APPROVED',
          'MEMORY_WRITE_FAILED',
        ]),
      ).toBe(PromotionState.PROMOTION_FAILED);
    });

    it('reaches PROMOTION_FAILED via FINALIZE_FAILED when markPromotedIfClaimed returns null', async () => {
      candidates.markPromotedIfClaimed.mockResolvedValue(null);

      await expect(service.promoteCandidate('candidate-1')).rejects.toThrow(
        /promotion finalization failed/,
      );

      expect(
        path(PromotionState.IDLE, [
          'CANDIDATE_FOUND',
          'PENDING_PROMOTION',
          'CLAIM_ACQUIRED',
          'GOVERNANCE_AUTO_PROMOTE',
          'POLICY_APPROVED',
          'MEMORY_SEGMENT_READY',
          'FINALIZE_FAILED',
        ]),
      ).toBe(PromotionState.PROMOTION_FAILED);
    });

    it('reaches PROMOTION_RACE_LOST when a concurrent promoter already completed', async () => {
      const promotedCandidate = createCandidate({
        status: 'promoted',
        promoted_memory_segment_id: 'memory-existing',
        promoted_at: new Date('2026-05-16T12:00:00.000Z'),
      });
      const existingSegment = createMemorySegment({ id: 'memory-existing' });
      candidates.markPromotedIfClaimed.mockResolvedValue(null);
      candidates.findById
        .mockResolvedValueOnce(createCandidate())
        .mockResolvedValueOnce(promotedCandidate);
      memorySegments.findById.mockResolvedValue(existingSegment);

      const result = await service.promoteCandidate('candidate-1');

      expect(result.status).toBe('promoted');
      expect(
        path(PromotionState.IDLE, [
          'CANDIDATE_FOUND',
          'PENDING_PROMOTION',
          'CLAIM_ACQUIRED',
          'GOVERNANCE_AUTO_PROMOTE',
          'POLICY_APPROVED',
          'MEMORY_SEGMENT_READY',
          'PROMOTION_RACE_LOST',
        ]),
      ).toBe(PromotionState.PROMOTION_RACE_LOST);
    });

    it('still drives the state machine when the candidate is missing (terminal CANDIDATE_MISSING)', async () => {
      candidates.findById.mockResolvedValue(null);

      await expect(service.promoteCandidate('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(path(PromotionState.IDLE, ['CANDIDATE_NOT_FOUND'])).toBe(
        PromotionState.CANDIDATE_MISSING,
      );
    });
  });

  describe('bulkPromote', () => {
    it('promotes each candidate independently and reports per-item results', async () => {
      const promoteCandidate = vi
        .spyOn(service, 'promoteCandidate')
        .mockResolvedValueOnce({
          candidate_id: 'c1',
          memory_segment_id: 'm1',
          status: 'promoted',
        } as never)
        .mockRejectedValueOnce(new Error('claim conflict'));

      const results = await service.bulkPromote(['c1', 'c2'], {
        requestedBy: 'reviewer-1',
      });

      expect(promoteCandidate).toHaveBeenNthCalledWith(1, 'c1', {
        requestedBy: 'reviewer-1',
      });
      expect(promoteCandidate).toHaveBeenNthCalledWith(2, 'c2', {
        requestedBy: 'reviewer-1',
      });
      expect(results[0]).toMatchObject({
        candidateId: 'c1',
        result: { candidate_id: 'c1' },
      });
      expect(results[1]).toMatchObject({
        candidateId: 'c2',
        error: 'claim conflict',
      });
    });
  });
});

function autoPromoteDecision(): GovernanceDecision {
  return {
    autoPromote: true,
    governanceState: 'provisional',
    probationUntil: new Date('2026-05-30T12:00:00.000Z'),
    requiresProposal: false,
    drop: false,
    reason: 'project auto-promote',
  };
}

function requiresProposalDecision(): GovernanceDecision {
  return {
    autoPromote: false,
    governanceState: null,
    probationUntil: null,
    requiresProposal: true,
    drop: false,
    reason: 'global never auto-promotes',
  };
}

function proposalRouteDecision(): GovernanceDecision {
  return {
    autoPromote: false,
    governanceState: null,
    probationUntil: null,
    requiresProposal: true,
    drop: false,
    reason: 'skill route is always a proposal',
  };
}

function dropDecision(): GovernanceDecision {
  return {
    autoPromote: false,
    governanceState: null,
    probationUntil: null,
    requiresProposal: false,
    drop: true,
    reason: 'templated noise',
  };
}

function createMemorySegment(overrides: Partial<ReturnMemorySegment> = {}) {
  return {
    id: 'memory-1',
    entity_type: 'workflow',
    entity_id: 'global',
    memory_type: 'fact',
    content: 'Prefer deterministic tests for workflow repair behavior.',
    version: 1,
    metadata_json: {
      source: 'learning_candidate',
      learning_candidate_id: 'candidate-1',
    },
    created_at: new Date('2026-05-16T00:00:00.000Z'),
    updated_at: new Date('2026-05-16T00:00:00.000Z'),
    ...overrides,
  };
}

type ReturnMemorySegment = Awaited<
  ReturnType<MemoryManagerService['createMemorySegment']>
>;

function createCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    id: 'candidate-1',
    scope_type: 'workflow',
    scopeId: null,
    candidate_type: 'runtime_learning',
    title: 'Prefer deterministic tests',
    summary: 'Fallback lesson from summary.',
    fingerprint: 'fingerprint-1',
    signals_json: {
      lesson: 'Prefer deterministic tests for workflow repair behavior.',
      tags: ['testing', 'repair'],
      evidence: [
        {
          kind: 'job_output',
          id: 'job-1',
          summary: 'Repair succeeded after adding deterministic tests.',
        },
      ],
      provenance: {
        workflowRunId: 'workflow-run-1',
        jobId: 'job-1',
        agentProfileName: 'doctor',
      },
    },
    score: 0.8,
    confidence: 0.8,
    recurrence_count: 1,
    stage_diversity_count: 1,
    routing_target: null,
    failure_reduction_relevance: 0,
    recency_decay: 1,
    source_quality_confidence: 0,
    status: 'pending',
    diagnostics_json: null,
    promoted_memory_segment_id: null,
    promoted_at: null,
    human_approved_at: null,
    first_seen_at: new Date('2026-05-16T00:00:00.000Z'),
    last_seen_at: new Date('2026-05-16T00:00:00.000Z'),
    created_at: new Date('2026-05-16T00:00:00.000Z'),
    updated_at: new Date('2026-05-16T00:00:00.000Z'),
    ...overrides,
  };
}
