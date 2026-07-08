import { describe, expect, it } from 'vitest';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { toLearningCandidateListItem } from './learning.mapper';

function baseCandidate(): LearningCandidate {
  return {
    id: 'candidate-1',
    scope_type: 'global',
    scopeId: null,
    candidate_type: 'runtime_learning',
    title: 'title',
    summary: 'summary',
    fingerprint: 'fp',
    signals_json: {},
    score: 0.5,
    confidence: 0.5,
    recurrence_count: 1,
    stage_diversity_count: 1,
    failure_reduction_relevance: 0,
    recency_decay: 1,
    source_quality_confidence: 0,
    status: 'pending',
    diagnostics_json: null,
    routing_target: null,
    promoted_memory_segment_id: null,
    promoted_at: null,
    human_approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    archived_by: null,
    archived_at: null,
    archive_reason: null,
    first_seen_at: new Date('2026-06-01T00:00:00.000Z'),
    last_seen_at: new Date('2026-06-02T00:00:00.000Z'),
    created_at: new Date('2026-06-01T00:00:00.000Z'),
    updated_at: new Date('2026-06-02T00:00:00.000Z'),
  };
}

describe('toLearningCandidateListItem', () => {
  it('surfaces the promotion, decision, and recurrence timestamps', () => {
    const candidate = {
      ...baseCandidate(),
      promoted_at: new Date('2026-06-03T00:00:00.000Z'),
      human_approved_at: new Date('2026-06-01T12:00:00.000Z'),
      rejected_at: new Date('2026-06-04T00:00:00.000Z'),
      rejected_by: 'reviewer-1',
      rejection_reason: 'Not useful',
      archived_at: new Date('2026-06-05T00:00:00.000Z'),
      archived_by: 'reviewer-2',
      archive_reason: 'Stale',
    };

    const item = toLearningCandidateListItem(candidate);

    expect(item.promoted_at).toBe('2026-06-03T00:00:00.000Z');
    expect(item.human_approved_at).toBe('2026-06-01T12:00:00.000Z');
    expect(item.first_seen_at).toBe('2026-06-01T00:00:00.000Z');
    expect(item.last_seen_at).toBe('2026-06-02T00:00:00.000Z');
    expect(item.rejected_at).toBe('2026-06-04T00:00:00.000Z');
    expect(item.rejected_by).toBe('reviewer-1');
    expect(item.rejection_reason).toBe('Not useful');
    expect(item.archived_at).toBe('2026-06-05T00:00:00.000Z');
    expect(item.archived_by).toBe('reviewer-2');
    expect(item.archive_reason).toBe('Stale');
  });

  it('surfaces null timestamps as null, not throwing', () => {
    const item = toLearningCandidateListItem(baseCandidate());

    expect(item.promoted_at).toBeNull();
    expect(item.rejected_at).toBeNull();
    expect(item.archived_at).toBeNull();
  });
});
