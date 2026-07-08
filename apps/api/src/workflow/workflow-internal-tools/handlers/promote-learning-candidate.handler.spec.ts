import { describe, expect, it, vi } from 'vitest';
import type { LearningCandidate } from '../../../memory/database/entities/learning-candidate.entity';
import { PromoteLearningCandidateHandler } from './promote-learning-candidate.handler';

describe('PromoteLearningCandidateHandler', () => {
  it('returns pending_approval and does not call promoteCandidate when neither human_approved_at nor operator_scope is set', async () => {
    const candidates = new Map<string, LearningCandidate>();
    candidates.set('candidate-1', buildCandidate({ human_approved_at: null }));
    const candidateRepository = {
      findById: vi.fn((id: string) =>
        Promise.resolve(candidates.get(id) ?? null),
      ),
    };
    const promoteCandidate = vi.fn().mockResolvedValue({
      candidate_id: 'candidate-1',
      memory_segment_id: 'memory-1',
      status: 'promoted',
    });
    const learningPromotion = { promoteCandidate };

    const handler = new PromoteLearningCandidateHandler(
      candidateRepository as never,
      learningPromotion as never,
    );

    const result = await handler.promoteCandidate({
      candidate_id: 'candidate-1',
    });

    expect(result).toEqual({
      candidate_id: 'candidate-1',
      status: 'pending_approval',
      reason: 'Human approval required for unattended sweep promotion',
    });
    expect(promoteCandidate).not.toHaveBeenCalled();
  });

  it('proceeds to full promotion when human_approved_at is a valid Date', async () => {
    const candidates = new Map<string, LearningCandidate>();
    candidates.set(
      'candidate-1',
      buildCandidate({
        human_approved_at: new Date('2026-05-16T10:00:00.000Z'),
      }),
    );
    const candidateRepository = {
      findById: vi.fn((id: string) =>
        Promise.resolve(candidates.get(id) ?? null),
      ),
    };
    const promoteResult = {
      candidate_id: 'candidate-1',
      memory_segment_id: 'memory-1',
      status: 'promoted',
    };
    const promoteCandidate = vi.fn().mockResolvedValue(promoteResult);
    const learningPromotion = { promoteCandidate };

    const handler = new PromoteLearningCandidateHandler(
      candidateRepository as never,
      learningPromotion as never,
    );

    const result = await handler.promoteCandidate({
      candidate_id: 'candidate-1',
    });

    expect(promoteCandidate).toHaveBeenCalledTimes(1);
    expect(promoteCandidate).toHaveBeenCalledWith('candidate-1', {
      requestedBy: 'workflow_sweep',
    });
    expect(result).toEqual({
      candidate_id: 'candidate-1',
      memory_segment_id: 'memory-1',
      status: 'promoted',
    });
  });

  it('proceeds to full promotion when operator_scope is supplied even with human_approved_at null', async () => {
    const candidates = new Map<string, LearningCandidate>();
    candidates.set('candidate-1', buildCandidate({ human_approved_at: null }));
    const candidateRepository = {
      findById: vi.fn((id: string) =>
        Promise.resolve(candidates.get(id) ?? null),
      ),
    };
    const promoteResult = {
      candidate_id: 'candidate-1',
      memory_segment_id: 'memory-1',
      status: 'promoted',
    };
    const promoteCandidate = vi.fn().mockResolvedValue(promoteResult);
    const learningPromotion = { promoteCandidate };

    const handler = new PromoteLearningCandidateHandler(
      candidateRepository as never,
      learningPromotion as never,
    );

    const result = await handler.promoteCandidate({
      candidate_id: 'candidate-1',
      operator_scope: 'sre-oncall',
    });

    expect(promoteCandidate).toHaveBeenCalledTimes(1);
    expect(promoteCandidate).toHaveBeenCalledWith('candidate-1', {
      requestedBy: 'workflow_sweep',
    });
    expect(result).toEqual({
      candidate_id: 'candidate-1',
      memory_segment_id: 'memory-1',
      status: 'promoted',
    });
  });
});

function buildCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    id: 'candidate-1',
    scope_type: 'workflow_run',
    scopeId: 'run-123',
    candidate_type: 'runtime_learning',
    title: 'Prefer cited repair evidence before changing workflow behavior.',
    summary: 'Prefer cited repair evidence before changing workflow behavior.',
    fingerprint: 'a'.repeat(64),
    signals_json: {
      lesson: 'Prefer cited repair evidence before changing workflow behavior.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-123',
          summary: 'Cited evidence reduced repair ambiguity.',
        },
      ],
      tags: ['repair', 'evidence'],
      confidence: 0.78,
      provenance: {
        workflowRunId: 'run-123',
        jobId: 'job-456',
        scopeId: 'runtime-scope-789',
        userId: 'user-abc',
        agentProfileName: 'repair-agent',
      },
      source: {
        tool: 'record_learning',
        candidate_type: 'runtime_learning',
      },
    },
    score: 0.78,
    confidence: 0.78,
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
