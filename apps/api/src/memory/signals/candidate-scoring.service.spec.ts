import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CandidateScoringService } from './candidate-scoring.service';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { TemplateNoiseClassifier } from './template-noise.classifier';
import {
  CANDIDATE_SCORING_W_RECURRENCE_DEFAULT,
  CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT,
  CANDIDATE_SCORING_W_RECENCY_DEFAULT,
  CANDIDATE_SCORING_W_DIVERSITY_DEFAULT,
  CANDIDATE_SCORING_BETA_DEFAULT,
  CANDIDATE_SCORING_LAMBDA_DEFAULT,
  CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT,
  SOURCE_QUALITY_LOW_SIGNAL_PRIOR,
} from '../../settings/candidate-scoring-settings.constants';

// ── Fixtures ─────────────────────────────────────────────────────────────────

let candidateSeq = 0;

function makeCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  candidateSeq++;
  return {
    id: `cand-${candidateSeq.toString().padStart(3, '0')}`,
    scope_type: 'global',
    scopeId: null,
    candidate_type: 'agent_capture',
    title: 'Use parameterised queries to prevent SQL injection',
    summary: 'Always use parameterised queries; never concatenate user input.',
    fingerprint: `fp-${candidateSeq.toString()}`,
    signals_json: {},
    score: 0,
    confidence: 0.7,
    recurrence_count: 1,
    stage_diversity_count: 1,
    routing_target: null,
    failure_reduction_relevance: 0.6,
    recency_decay: 1.0,
    source_quality_confidence: 0,
    status: 'pending',
    diagnostics_json: null,
    promoted_memory_segment_id: null,
    promoted_at: null,
    human_approved_at: null,
    first_seen_at: new Date('2024-01-01T00:00:00Z'),
    last_seen_at: new Date('2024-01-01T00:00:00Z'),
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Build a fully-mocked service with injectable overrides. */
function makeSvc(
  options: {
    candidates?: LearningCandidate[];
    isLowSignal?: boolean;
  } = {},
) {
  const { candidates = [], isLowSignal = false } = options;

  const candidateRepo = {
    list: vi.fn().mockResolvedValue({
      data: candidates,
      total: candidates.length,
    }),
    updateById: vi.fn().mockResolvedValue(null),
  } as unknown as LearningCandidateRepository;

  const settings = {
    get: vi
      .fn()
      .mockImplementation((_key: string, def: unknown) => Promise.resolve(def)),
  } as unknown as SystemSettingsService;

  const classifier = {
    classify: vi.fn().mockReturnValue({ isTemplate: isLowSignal, isLowSignal }),
  } as unknown as TemplateNoiseClassifier;

  const svc = new CandidateScoringService(candidateRepo, settings, classifier);
  return { svc, candidateRepo, settings, classifier };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute the expected logistic score given normalised signals. */
function expectedLogistic(signals: {
  wRecurrence: number;
  logRecurrence: number;
  wSourceQuality: number;
  sourceQuality: number;
  wRecency: number;
  recencyDecay: number;
  wDiversity: number;
  diversityNorm: number;
  beta: number;
}): number {
  const raw =
    signals.wRecurrence * signals.logRecurrence +
    signals.wSourceQuality * signals.sourceQuality +
    signals.wRecency * signals.recencyDecay +
    signals.wDiversity * signals.diversityNorm +
    signals.beta;
  return 1 / (1 + Math.exp(-raw));
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('CandidateScoringService', () => {
  beforeEach(() => {
    candidateSeq = 0;
  });

  it('requests the first page of pending candidates (offset:0 -> page:1, Task 17)', async () => {
    const { svc, candidateRepo } = makeSvc({ candidates: [] });

    await svc.scoreAll();

    expect(candidateRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['pending'], page: 1 }),
    );
  });

  // (a) Templated / low-signal candidates score LOW
  describe('source_quality_confidence — templated/low-signal prior', () => {
    it('sets source_quality_confidence = 0.2 for a templated candidate', async () => {
      const candidate = makeCandidate({
        candidate_type: 'agent_capture', // high-quality type, but content is low-signal
        title:
          'Workflow run 550e8400-e29b-41d4-a716-446655440000 for scope my-project completed cleanly in 42s',
        summary: 'No actionable content here.',
        recurrence_count: 5,
        stage_diversity_count: 3,
        routing_target: null,
        first_seen_at: new Date(), // recent
      });

      const { svc, candidateRepo } = makeSvc({
        candidates: [candidate],
        isLowSignal: true,
      });

      await svc.scoreAll();

      const call = (candidateRepo.updateById as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const updates = call[1] as Record<string, unknown>;
      expect(updates.source_quality_confidence).toBeCloseTo(
        SOURCE_QUALITY_LOW_SIGNAL_PRIOR,
        5,
      );
    });

    it('produces a composite score < 0.5 for a low-signal candidate (below logistic midpoint)', async () => {
      const candidate = makeCandidate({
        candidate_type: 'agent_capture',
        recurrence_count: 1,
        stage_diversity_count: 1,
        routing_target: null,
        first_seen_at: new Date(),
      });

      const { svc, candidateRepo } = makeSvc({
        candidates: [candidate],
        isLowSignal: true,
      });

      await svc.scoreAll();

      const call = (candidateRepo.updateById as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const updates = call[1] as Record<string, unknown>;
      // Low-signal prior (0.2) drives the score below the logistic midpoint (0.5)
      // even when recency is maximum. Default β=-1.0 ensures this.
      expect(updates.score as number).toBeLessThan(0.5);
    });
  });

  // (b) agent_capture with high recurrence + recent scores HIGH
  describe('agent_capture with high recurrence and recent first_seen_at', () => {
    it('scores > 0.6 for a high-quality, high-recurrence, recent candidate', async () => {
      const candidate = makeCandidate({
        candidate_type: 'agent_capture',
        recurrence_count: 10,
        stage_diversity_count: 4,
        routing_target: null,
        first_seen_at: new Date(), // today — maximum recency
      });

      const { svc, candidateRepo } = makeSvc({
        candidates: [candidate],
        isLowSignal: false,
      });

      await svc.scoreAll();

      const call = (candidateRepo.updateById as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const updates = call[1] as Record<string, unknown>;
      expect(updates.score as number).toBeGreaterThan(0.6);
      expect(updates.source_quality_confidence).toBeCloseTo(0.9, 5);
    });
  });

  // (c) recency_decay decreases with age
  describe('recency_decay', () => {
    it('assigns a higher recency_decay to a recent candidate than to an old one', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const recent = makeCandidate({ first_seen_at: now });
      const old = makeCandidate({ first_seen_at: thirtyDaysAgo });

      const { svc: svcRecent, candidateRepo: repoRecent } = makeSvc({
        candidates: [recent],
      });
      const { svc: svcOld, candidateRepo: repoOld } = makeSvc({
        candidates: [old],
      });

      await svcRecent.scoreAll();
      await svcOld.scoreAll();

      const recentDecay = (
        (repoRecent.updateById as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as Record<string, unknown>
      ).recency_decay as number;

      const oldDecay = (
        (repoOld.updateById as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as Record<string, unknown>
      ).recency_decay as number;

      expect(recentDecay).toBeGreaterThan(oldDecay);
    });

    it('computes recency_decay = exp(-λ * Δdays) with default λ', () => {
      const lambda = CANDIDATE_SCORING_LAMBDA_DEFAULT;
      const deltaDays = 7;
      const expected = Math.exp(-lambda * deltaDays);
      expect(expected).toBeCloseTo(0.704, 2); // sanity check on the formula
    });
  });

  // (d) recurrence_count set by clustering is READ, not overwritten
  describe('recurrence_count preservation', () => {
    it('does NOT overwrite recurrence_count in the update payload', async () => {
      const candidate = makeCandidate({ recurrence_count: 7 });
      const { svc, candidateRepo } = makeSvc({ candidates: [candidate] });

      await svc.scoreAll();

      const updates = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
        .mock.calls[0][1] as Record<string, unknown>;
      expect('recurrence_count' in updates).toBe(false);
    });

    it('uses the existing recurrence_count in the score computation', async () => {
      const highRecurrence = makeCandidate({
        recurrence_count: 10,
        candidate_type: 'agent_capture',
        first_seen_at: new Date(),
      });
      const singletonRecurrence = makeCandidate({
        recurrence_count: 1,
        candidate_type: 'agent_capture',
        first_seen_at: new Date(),
      });

      const { svc: svcHigh, candidateRepo: repoHigh } = makeSvc({
        candidates: [highRecurrence],
      });
      const { svc: svcLow, candidateRepo: repoLow } = makeSvc({
        candidates: [singletonRecurrence],
      });

      await svcHigh.scoreAll();
      await svcLow.scoreAll();

      const highScore = (
        (repoHigh.updateById as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as Record<string, unknown>
      ).score as number;
      const lowScore = (
        (repoLow.updateById as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as Record<string, unknown>
      ).score as number;

      expect(highScore).toBeGreaterThan(lowScore);
    });
  });

  // (e) signals_json carries the per-signal breakdown
  describe('signals_json breakdown', () => {
    it('includes all expected signal keys in signals_json', async () => {
      const candidate = makeCandidate();
      const { svc, candidateRepo } = makeSvc({ candidates: [candidate] });

      await svc.scoreAll();

      const updates = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
        .mock.calls[0][1] as Record<string, unknown>;
      const signals = updates.signals_json as Record<string, unknown>;

      expect(signals).toHaveProperty('source_quality_confidence');
      expect(signals).toHaveProperty('recency_decay');
      expect(signals).toHaveProperty('recurrence_count');
      expect(signals).toHaveProperty('stage_diversity_norm');
      expect(signals).toHaveProperty('composite_raw');
      expect(signals).toHaveProperty('weights');
    });

    it('stores numeric values in signals_json', async () => {
      const candidate = makeCandidate({ recurrence_count: 3 });
      const { svc, candidateRepo } = makeSvc({ candidates: [candidate] });

      await svc.scoreAll();

      const updates = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
        .mock.calls[0][1] as Record<string, unknown>;
      const signals = updates.signals_json as Record<string, unknown>;

      expect(typeof signals.source_quality_confidence).toBe('number');
      expect(typeof signals.recency_decay).toBe('number');
      expect(typeof signals.recurrence_count).toBe('number');
      expect(signals.recurrence_count).toBe(3);
    });
  });

  // (f) Idempotency — same inputs yield same score
  describe('idempotency', () => {
    it('produces the same score on a second scoreAll call for unchanged data', async () => {
      const candidate = makeCandidate({
        candidate_type: 'struggle',
        recurrence_count: 3,
        stage_diversity_count: 2,
        routing_target: null,
        first_seen_at: new Date('2024-03-01T00:00:00Z'),
      });

      const { svc, candidateRepo } = makeSvc({ candidates: [candidate] });

      await svc.scoreAll();
      const firstScore = (
        (candidateRepo.updateById as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as Record<string, unknown>
      ).score as number;

      // Reset the mock and run again with same candidate
      (candidateRepo.updateById as ReturnType<typeof vi.fn>).mockClear();
      await svc.scoreAll();
      const secondScore = (
        (candidateRepo.updateById as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as Record<string, unknown>
      ).score as number;

      expect(firstScore).toBeCloseTo(secondScore, 10);
    });
  });

  // Score formula verification
  describe('composite score formula', () => {
    it('matches expected logistic output for a known set of inputs', async () => {
      const now = new Date();
      // Use first_seen_at = now so recency_decay ≈ 1.0 (Δdays ≈ 0)
      const candidate = makeCandidate({
        candidate_type: 'agent_capture',
        recurrence_count: 1,
        stage_diversity_count: 1,
        routing_target: null,
        first_seen_at: now,
      });

      const { svc, candidateRepo } = makeSvc({ candidates: [candidate] });

      await svc.scoreAll();

      const updates = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
        .mock.calls[0][1] as Record<string, unknown>;

      // Expected: recency ≈ 1.0, recurrence log(1)=0, diversity 1/5=0.2,
      //           source_quality = 0.9
      const expectedScore = expectedLogistic({
        wRecurrence: CANDIDATE_SCORING_W_RECURRENCE_DEFAULT,
        logRecurrence: 0, // log(1) = 0
        wSourceQuality: CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT,
        sourceQuality: 0.9,
        wRecency: CANDIDATE_SCORING_W_RECENCY_DEFAULT,
        recencyDecay: 1.0, // Δdays ≈ 0
        wDiversity: CANDIDATE_SCORING_W_DIVERSITY_DEFAULT,
        diversityNorm: 1 / CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT,
        beta: CANDIDATE_SCORING_BETA_DEFAULT,
      });

      expect(updates.score as number).toBeCloseTo(expectedScore, 2);
    });
  });

  // scoreOne — direct single-candidate scoring
  describe('scoreOne', () => {
    it('scores a single candidate and returns the ScoringResult', async () => {
      const candidate = makeCandidate({
        candidate_type: 'agent_capture',
        recurrence_count: 2,
        first_seen_at: new Date(),
      });

      const { svc } = makeSvc({ candidates: [candidate] });

      const result = await svc.scoreOne(candidate);

      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.source_quality_confidence).toBeCloseTo(0.9, 5);
      expect(result.recency_decay).toBeGreaterThan(0);
      expect(result.recency_decay).toBeLessThanOrEqual(1);
      expect(result.signals_json).toBeDefined();
    });

    it('does NOT call candidateRepo.updateById from scoreOne', async () => {
      const candidate = makeCandidate();
      const { svc, candidateRepo } = makeSvc({ candidates: [candidate] });

      await svc.scoreOne(candidate);

      expect(
        (candidateRepo.updateById as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(0);
    });
  });

  // Source-quality prior by candidate_type
  describe('source_quality_confidence priors by candidate_type', () => {
    it.each([
      ['agent_capture', 0.9],
      ['struggle', 0.8],
      ['runtime_learning', 0.5],
      ['unknown_type', 0.5],
    ])(
      'assigns source_quality_confidence = %d for candidate_type = %s',
      async (candidateType, expectedPrior) => {
        const candidate = makeCandidate({ candidate_type: candidateType });
        const { svc, candidateRepo } = makeSvc({
          candidates: [candidate],
          isLowSignal: false,
        });

        await svc.scoreAll();

        const updates = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
          .mock.calls[0][1] as Record<string, unknown>;
        expect(updates.source_quality_confidence).toBeCloseTo(expectedPrior, 5);
      },
    );
  });

  // Empty pass — no candidates
  describe('scoreAll with no pending candidates', () => {
    it('returns zero counts and does not call updateById', async () => {
      const { svc, candidateRepo } = makeSvc({ candidates: [] });

      const result = await svc.scoreAll();

      expect(result.scored).toBe(0);
      expect(
        (candidateRepo.updateById as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(0);
    });
  });
});
