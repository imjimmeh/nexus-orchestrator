import { describe, expect, it } from 'vitest';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { LearningPromotionPolicyService } from './learning-promotion-policy.service';

describe('LearningPromotionPolicyService', () => {
  it('approves valid pending runtime-learning candidates by default', () => {
    const service = new LearningPromotionPolicyService();

    const decision = service.evaluate(createCandidate());

    expect(decision).toMatchObject({
      approved: true,
      code: 'approved',
      policyName: 'runtime-learning-auto-promotion',
    });
    expect(decision.policyVersion).toEqual(expect.any(String));
  });

  it('denies candidates without a lesson in signals or summary', () => {
    const service = new LearningPromotionPolicyService();

    const decision = service.evaluate(
      createCandidate({
        summary: '   ',
        signals_json: { lesson: '   ' },
      }),
    );

    expect(decision).toMatchObject({
      approved: false,
      code: 'missing_lesson',
    });
  });

  it('denies non-pending and already promoted candidates', () => {
    const service = new LearningPromotionPolicyService();

    expect(
      service.evaluate(createCandidate({ status: 'rejected' })),
    ).toMatchObject({
      approved: false,
      code: 'not_pending',
    });
    expect(
      service.evaluate(
        createCandidate({ promoted_memory_segment_id: 'memory-1' }),
      ),
    ).toMatchObject({ approved: false, code: 'already_promoted' });
    expect(
      service.evaluate(createCandidate({ promoted_at: new Date() })),
    ).toMatchObject({
      approved: false,
      code: 'already_promoted',
    });
  });

  it('only approves claimed in-progress candidates when they are claimable', () => {
    const service = new LearningPromotionPolicyService();
    const candidate = createCandidate({ status: 'promotion_in_progress' });

    expect(service.evaluate(candidate)).toMatchObject({
      approved: false,
      code: 'not_pending',
    });
    expect(
      service.evaluate(candidate, { allowClaimedCandidate: true }),
    ).toMatchObject({
      approved: true,
      code: 'approved',
    });
  });

  it('rejects candidates by default when confidence is below 0.5 (the new default threshold)', () => {
    const service = new LearningPromotionPolicyService();

    const decision = service.evaluate(createCandidate({ confidence: 0.3 }));

    expect(decision).toMatchObject({
      approved: false,
      code: 'low_confidence',
      minimumConfidence: 0.5,
      confidence: 0.3,
    });
  });

  it('approves candidates by default when confidence is at or above 0.5', () => {
    const service = new LearningPromotionPolicyService();

    const decision = service.evaluate(createCandidate({ confidence: 0.5 }));

    expect(decision).toMatchObject({
      approved: true,
      code: 'approved',
    });
  });

  it('denies candidates below a configured minimum confidence', () => {
    const service = new LearningPromotionPolicyService();

    const decision = service.evaluate(createCandidate({ confidence: 0.4 }), {
      minimumConfidence: 0.9,
    });

    expect(decision).toMatchObject({
      approved: false,
      code: 'low_confidence',
      minimumConfidence: 0.9,
      confidence: 0.4,
    });
  });
});

function createCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    id: 'candidate-1',
    scope_type: 'global',
    scopeId: null,
    candidate_type: 'runtime_learning',
    title: 'Prefer deterministic tests',
    summary: 'Prefer deterministic tests for workflow repair behavior.',
    fingerprint: 'fingerprint-1',
    signals_json: {
      lesson: 'Prefer deterministic tests for workflow repair behavior.',
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
