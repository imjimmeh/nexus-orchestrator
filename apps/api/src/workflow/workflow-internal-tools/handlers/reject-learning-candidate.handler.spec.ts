import { describe, expect, it, vi } from 'vitest';
import type { LearningCandidate } from '../../../memory/database/entities/learning-candidate.entity';
import { RejectLearningCandidateHandler } from './reject-learning-candidate.handler';

describe('RejectLearningCandidateHandler', () => {
  it('rejects a candidate by id and records the rejection reason', async () => {
    const candidates = new Map<string, LearningCandidate>();
    candidates.set('candidate-1', buildCandidate());

    const candidateRepository = {
      updateById: vi.fn((id: string, patch: Partial<LearningCandidate>) => {
        const existing = candidates.get(id);
        if (!existing) {
          return Promise.resolve(null);
        }
        const updated = copyCandidate(existing, patch);
        candidates.set(id, updated);
        return Promise.resolve(updated);
      }),
    };

    const handler = new RejectLearningCandidateHandler(
      candidateRepository as never,
    );

    const result = await handler.rejectCandidate({
      candidate_id: 'candidate-1',
      reason: 'stale lesson',
    });

    expect(result).toEqual({
      candidate_id: 'candidate-1',
      status: 'rejected',
    });
    expect(candidateRepository.updateById).toHaveBeenCalledWith('candidate-1', {
      status: 'rejected',
      diagnostics_json: { rejection_reason: 'stale lesson' },
    });
    expect(candidates.get('candidate-1')?.status).toBe('rejected');
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

function copyCandidate(
  candidate: LearningCandidate,
  overrides: Partial<LearningCandidate>,
): LearningCandidate {
  return Object.assign(buildCandidate(), candidate, overrides);
}
