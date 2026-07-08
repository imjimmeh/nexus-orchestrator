import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FeedbackWeightTunerService } from './feedback-weight-tuner.service';
import type { SignalWeightHistoryRepository } from '../database/repositories/signal-weight-history.repository';
import type { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import type { MemorySegmentFeedbackService } from '../memory-segment-feedback.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { MemorySegment } from '../database/entities/memory-segment.entity';
import type { ScoringWeightVector } from './feedback-weight-tuner.types';
import {
  CANDIDATE_SCORING_W_RECURRENCE,
  CANDIDATE_SCORING_BETA,
} from '../../settings/candidate-scoring-settings.constants';
import { FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING } from '../../settings/feedback-weight-tuner.settings.constants';

function makeCandidate(
  id: string,
  segmentId: string | null,
): LearningCandidate {
  return {
    id,
    scope_type: 'project',
    scopeId: 'scope-1',
    candidate_type: 'agent_capture',
    title: 'Lesson',
    summary: 'A lesson',
    fingerprint: `fp-${id}`,
    signals_json: {},
    score: 0.7,
    confidence: 0.7,
    recurrence_count: 4,
    stage_diversity_count: 2,
    failure_reduction_relevance: 0,
    recency_decay: 0.8,
    source_quality_confidence: 0.9,
    status: 'promoted',
    diagnostics_json: null,
    promoted_memory_segment_id: segmentId,
    promoted_at: new Date(),
    human_approved_at: null,
    routing_target: 'project',
    first_seen_at: new Date(),
    last_seen_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function makeSegment(overrides: Partial<MemorySegment> = {}): MemorySegment {
  return {
    archived_at: null,
    superseded_by: null,
    ...overrides,
  } as MemorySegment;
}

interface SettingsMock {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

function makeSettings(overrides: Record<string, unknown> = {}): SettingsMock {
  const store = new Map<string, unknown>(Object.entries(overrides));
  const get = vi.fn(async (key: string, def: unknown) =>
    store.has(key) ? store.get(key) : def,
  );
  const set = vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
    return {};
  });
  return { get, set };
}

describe('FeedbackWeightTunerService', () => {
  let history: {
    create: ReturnType<typeof vi.fn>;
    markApplied: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findLatestApplied: ReturnType<typeof vi.fn>;
    findRecent: ReturnType<typeof vi.fn>;
  };
  let candidateRepo: { list: ReturnType<typeof vi.fn> };
  let segmentRepo: { findById: ReturnType<typeof vi.fn> };
  let feedback: { computeUsefulnessForSegments: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    history = {
      create: vi.fn().mockResolvedValue({ id: 'row-1' }),
      markApplied: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue(null),
      findLatestApplied: vi.fn().mockResolvedValue(null),
      findRecent: vi.fn().mockResolvedValue([]),
    };
    candidateRepo = { list: vi.fn().mockResolvedValue({ data: [], total: 0 }) };
    segmentRepo = { findById: vi.fn().mockResolvedValue(makeSegment()) };
    feedback = {
      computeUsefulnessForSegments: vi.fn().mockResolvedValue(new Map()),
    };
  });

  function build(settings: SettingsMock): FeedbackWeightTunerService {
    return new FeedbackWeightTunerService(
      history as unknown as SignalWeightHistoryRepository,
      candidateRepo as unknown as LearningCandidateRepository,
      segmentRepo as unknown as MemorySegmentCrudRepository,
      feedback as unknown as MemorySegmentFeedbackService,
      settings as unknown as SystemSettingsService,
    );
  }

  it('disabled flag → no-op before any query (no candidate load, no write)', async () => {
    const settings = makeSettings({
      [FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING]: false,
    });
    const service = build(settings);

    const outcome = await service.runTune();

    expect(outcome).toEqual({
      applied: false,
      reason: 'disabled',
      sampleSize: 0,
      boundedDelta: 0,
      historyId: undefined,
    });
    expect(candidateRepo.list).not.toHaveBeenCalled();
    expect(history.create).not.toHaveBeenCalled();
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('requests the first page of promoted candidates (offset:0 -> page:1, Task 17)', async () => {
    const settings = makeSettings({
      [FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING]: true,
      feedback_weight_tuner_min_samples: 2,
    });
    const service = build(settings);

    await service.runTune();

    expect(candidateRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['promoted'], page: 1 }),
    );
  });

  it('below min_samples → writes an insufficient_samples row, applies nothing', async () => {
    const settings = makeSettings({
      [FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING]: true,
      feedback_weight_tuner_min_samples: 50,
    });
    // No promoted candidates → zero labelled samples → below 50.
    candidateRepo.list.mockResolvedValue({ data: [], total: 0 });
    const service = build(settings);

    const outcome = await service.runTune();

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('insufficient_samples');
    expect(outcome.sampleSize).toBe(0);
    expect(history.create).toHaveBeenCalledTimes(1);
    expect(history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        applied: false,
        reason: 'insufficient_samples',
      }),
    );
    // Settings (the live weights) were NOT mutated.
    expect(settings.set).not.toHaveBeenCalled();
    expect(history.markApplied).not.toHaveBeenCalled();
  });

  it('at/above min_samples → writes history with previous+new BEFORE apply, then marks applied', async () => {
    const settings = makeSettings({
      [FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING]: true,
      feedback_weight_tuner_min_samples: 2,
    });
    const candidates = [
      makeCandidate('a', 'seg-a'),
      makeCandidate('b', 'seg-b'),
      makeCandidate('c', 'seg-c'),
    ];
    candidateRepo.list.mockResolvedValue({ data: candidates, total: 3 });
    segmentRepo.findById.mockResolvedValue(makeSegment());
    feedback.computeUsefulnessForSegments.mockResolvedValue(
      new Map([
        ['seg-a', { usefulness: 0.9, sampleSize: 5 }], // positive
        ['seg-b', { usefulness: 0.1, sampleSize: 5 }], // negative
        ['seg-c', { usefulness: 0.8, sampleSize: 4 }], // positive
      ]),
    );
    const service = build(settings);

    const outcome = await service.runTune();

    expect(outcome.applied).toBe(true);
    expect(outcome.reason).toBe('retuned');
    expect(outcome.sampleSize).toBe(3);

    // A retune history row carries BOTH the new weights and the prior weights.
    const retuneCall = history.create.mock.calls.find(
      ([arg]) => arg.reason === 'retuned',
    );
    expect(retuneCall).toBeDefined();
    const row = retuneCall![0];
    expect(row.weights_json).toBeDefined();
    expect(row.previous_weights_json).toBeDefined();
    expect(row.applied).toBe(false);
    expect(row.training_sample_size).toBe(3);

    // The history row is written BEFORE the live weights are mutated.
    const createOrder = history.create.mock.invocationCallOrder[0];
    const firstSetOrder = settings.set.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(firstSetOrder);

    // All five scoring parameters are persisted, then the row is marked applied.
    expect(settings.set).toHaveBeenCalledTimes(5);
    expect(history.markApplied).toHaveBeenCalledWith('row-1');
  });

  it('bounds each applied weight within max_delta of the prior weight', async () => {
    const settings = makeSettings({
      [FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING]: true,
      feedback_weight_tuner_min_samples: 2,
      feedback_weight_tuner_max_delta: 0.1,
    });
    const candidates = [
      makeCandidate('a', 'seg-a'),
      makeCandidate('b', 'seg-b'),
    ];
    candidateRepo.list.mockResolvedValue({ data: candidates, total: 2 });
    feedback.computeUsefulnessForSegments.mockResolvedValue(
      new Map([
        ['seg-a', { usefulness: 0.95, sampleSize: 8 }],
        ['seg-b', { usefulness: 0.05, sampleSize: 8 }],
      ]),
    );
    const service = build(settings);

    await service.runTune();

    // Defaults: w_recurrence 0.4, w_source_quality 0.8, w_recency 0.6,
    // w_diversity 0.3, beta -1.0. Every applied value is within 0.1.
    const priorByKey: Record<string, number> = {
      [CANDIDATE_SCORING_W_RECURRENCE]: 0.4,
      candidate_scoring_w_source_quality: 0.8,
      candidate_scoring_w_recency: 0.6,
      candidate_scoring_w_diversity: 0.3,
      [CANDIDATE_SCORING_BETA]: -1.0,
    };
    for (const [key, value] of settings.set.mock.calls) {
      expect(
        Math.abs((value as number) - priorByKey[key as string]),
      ).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it('revertToHistory restores the prior weights exactly and records the revert', async () => {
    const settings = makeSettings();
    const previous: ScoringWeightVector = {
      w_recurrence: 0.4,
      w_source_quality: 0.8,
      w_recency: 0.6,
      w_diversity: 0.3,
      beta: -1.0,
    };
    const current: ScoringWeightVector = {
      w_recurrence: 0.45,
      w_source_quality: 0.85,
      w_recency: 0.65,
      w_diversity: 0.35,
      beta: -0.95,
    };
    history.findById.mockResolvedValue({
      id: 'row-7',
      weights_json: current,
      previous_weights_json: previous,
    });
    const service = build(settings);

    const reverted = await service.revertToHistory('row-7');

    expect(reverted).toBe(true);
    // The exact prior weights are re-applied to the five settings keys.
    expect(settings.set).toHaveBeenCalledWith(
      CANDIDATE_SCORING_W_RECURRENCE,
      0.4,
    );
    expect(settings.set).toHaveBeenCalledWith(CANDIDATE_SCORING_BETA, -1.0);
    // The revert is itself versioned (new weights = prior, applied = true).
    expect(history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        weights_json: previous,
        previous_weights_json: current,
        applied: true,
        reason: 'revert',
      }),
    );
  });

  it('revertToHistory returns false for a missing row', async () => {
    history.findById.mockResolvedValue(null);
    const service = build(makeSettings());
    expect(await service.revertToHistory('nope')).toBe(false);
  });

  it('fail-soft: a thrown error during the pass reports reason=error and applies nothing', async () => {
    const settings = makeSettings({
      [FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING]: true,
      feedback_weight_tuner_min_samples: 1,
    });
    candidateRepo.list.mockRejectedValue(new Error('db down'));
    const service = build(settings);

    const outcome = await service.runTune();

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('error');
    expect(settings.set).not.toHaveBeenCalled();
  });
});
