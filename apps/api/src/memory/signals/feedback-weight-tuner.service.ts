import { Injectable, Logger, Optional } from '@nestjs/common';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import { MemorySegmentFeedbackService } from '../memory-segment-feedback.service';
import { SignalWeightHistoryRepository } from '../database/repositories/signal-weight-history.repository';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { trainLogisticRegression } from './feedback-weight-tuner.train';
import { boundWeights } from './feedback-weight-tuner.bound';
import {
  deriveCandidateLabel,
  extractCandidateFeatures,
} from './feedback-weight-tuner.labels';
import type { LabelledSample } from './feedback-weight-tuner.train.types';
import type {
  ScoringWeightVector,
  WeightTuneOutcome,
} from './feedback-weight-tuner.types';
import { PROMOTED_STATUS, MAX_SIGNAL_LOAD } from './signal-load.constants';
import {
  CANDIDATE_SCORING_W_RECURRENCE,
  CANDIDATE_SCORING_W_SOURCE_QUALITY,
  CANDIDATE_SCORING_W_RECENCY,
  CANDIDATE_SCORING_W_DIVERSITY,
  CANDIDATE_SCORING_BETA,
  CANDIDATE_SCORING_DIVERSITY_CAP,
  CANDIDATE_SCORING_W_RECURRENCE_DEFAULT,
  CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT,
  CANDIDATE_SCORING_W_RECENCY_DEFAULT,
  CANDIDATE_SCORING_W_DIVERSITY_DEFAULT,
  CANDIDATE_SCORING_BETA_DEFAULT,
  CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT,
  coerceNonNegativeNumber,
} from '../../settings/candidate-scoring-settings.constants';
import {
  FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING,
  FEEDBACK_WEIGHT_TUNER_MAX_DELTA_SETTING,
  FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_SETTING,
  FEEDBACK_WEIGHT_TUNER_ENABLED_DEFAULT,
  FEEDBACK_WEIGHT_TUNER_MAX_DELTA_DEFAULT,
  FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_DEFAULT,
  coerceFeedbackWeightTunerEnabled,
  coerceFeedbackWeightTunerMaxDelta,
  coerceFeedbackWeightTunerMinSamples,
} from '../../settings/feedback-weight-tuner.settings.constants';

export type {
  ScoringWeightVector,
  WeightTuneOutcome,
} from './feedback-weight-tuner.types';

/** Usefulness ratio at/above which a promoted segment counts as a positive label. */
const LABEL_USEFULNESS_THRESHOLD = 0.6;

/** Minimum usefulness votes before a promoted segment can drive a label. */
const LABEL_MIN_VOTES = 3;

/** Gradient-descent hyper-parameters for the weekly retrain. */
const TRAIN_ITERATIONS = 2_000;
const TRAIN_LEARNING_RATE = 0.1;
const TRAIN_L2 = 0.01;

const REASON_INSUFFICIENT = 'insufficient_samples';
const REASON_RETUNED = 'retuned';
const REASON_REVERT = 'revert';

interface TunerConfig {
  readonly enabled: boolean;
  readonly maxDelta: number;
  readonly minSamples: number;
}

/**
 * Weekly, bounded, versioned, reversible logistic-regression retune of the
 * candidate-scoring weights (EPIC-212 Phase-3 Task 9).
 *
 * Pipeline: derive labelled samples from promoted candidates + their segment
 * outcomes → train an L2-regularised logistic regression (pure
 * {@link trainLogisticRegression}) → clamp each new weight to within
 * `feedback_weight_tuner_max_delta` of the live weight (pure
 * {@link boundWeights}) → write a `signal_weight_history` row BEFORE applying
 * → apply to the `candidate_scoring_*` settings only when the labelled sample
 * size meets `feedback_weight_tuner_min_samples`.
 *
 * Default-OFF and fail-soft: a disabled flag no-ops before any DB query; every
 * dependency that could be absent is `@Optional()`; any thrown error writes
 * nothing and reports `reason='error'`. With the flag off the hand-set
 * Phase-1 weights are byte-for-byte untouched.
 */
@Injectable()
export class FeedbackWeightTunerService {
  private readonly logger = new Logger(FeedbackWeightTunerService.name);

  constructor(
    private readonly history: SignalWeightHistoryRepository,
    private readonly candidateRepo: LearningCandidateRepository,
    private readonly segmentRepo: MemorySegmentCrudRepository,
    @Optional() private readonly feedback?: MemorySegmentFeedbackService,
    @Optional() private readonly settings?: SystemSettingsService,
  ) {}

  /**
   * Run one weekly tuner pass. Returns the outcome (applied / reason / sample
   * size / clamp magnitude). Never throws — a failure is logged and reported
   * as `reason='error'`.
   */
  async runTune(now: Date = new Date()): Promise<WeightTuneOutcome> {
    const config = await this.resolveConfig();
    if (!config.enabled) {
      return this.outcome(false, 'disabled', 0, 0);
    }

    try {
      const samples = await this.buildLabelledSamples(now);
      const current = await this.resolveCurrentWeights();

      if (samples.length < config.minSamples) {
        const row = await this.history.create({
          weights_json: current,
          previous_weights_json: current,
          training_sample_size: samples.length,
          bounded_delta: 0,
          applied: false,
          reason: REASON_INSUFFICIENT,
        });
        return this.outcome(
          false,
          'insufficient_samples',
          samples.length,
          0,
          row.id,
        );
      }

      return await this.trainBoundApply(samples, current);
    } catch (error) {
      this.logger.warn(
        `FeedbackWeightTunerService.runTune failed: ${(error as Error).message}`,
      );
      return this.outcome(false, 'error', 0, 0);
    }
  }

  /**
   * Revert the live scoring weights to the `previous_weights_json` captured on
   * a specific history row, recording the revert as a new history row. Returns
   * `true` when the revert was applied, `false` when the row (or its prior
   * snapshot) is missing.
   */
  async revertToHistory(id: string): Promise<boolean> {
    const row = await this.history.findById(id);
    if (!row || row.previous_weights_json === null) {
      return false;
    }

    await this.applyWeights(row.previous_weights_json);
    await this.history.create({
      weights_json: row.previous_weights_json,
      previous_weights_json: row.weights_json,
      training_sample_size: 0,
      bounded_delta: 0,
      applied: true,
      reason: REASON_REVERT,
    });
    return true;
  }

  /** Revert to the `previous_weights_json` of the latest applied retune. */
  async revertLatest(): Promise<boolean> {
    const latest = await this.history.findLatestApplied();
    if (!latest) {
      return false;
    }
    return this.revertToHistory(latest.id);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async trainBoundApply(
    samples: LabelledSample[],
    current: ScoringWeightVector,
  ): Promise<WeightTuneOutcome> {
    const trained = trainLogisticRegression(samples, {
      iterations: TRAIN_ITERATIONS,
      learningRate: TRAIN_LEARNING_RATE,
      l2: TRAIN_L2,
    });

    const proposed: ScoringWeightVector = {
      w_recurrence: trained.weights[0],
      w_source_quality: trained.weights[1],
      w_recency: trained.weights[2],
      w_diversity: trained.weights[3],
      beta: trained.intercept,
    };

    const config = await this.resolveConfig();
    const { bounded, boundedDelta } = boundWeights(
      proposed,
      current,
      config.maxDelta,
    );

    // Write the versioned history row BEFORE mutating the live weights so a
    // crash mid-apply still leaves a reversible record of the change.
    const row = await this.history.create({
      weights_json: bounded,
      previous_weights_json: current,
      training_sample_size: samples.length,
      bounded_delta: boundedDelta,
      applied: false,
      reason: REASON_RETUNED,
    });

    await this.applyWeights(bounded);
    await this.history.markApplied(row.id);

    return this.outcome(true, 'retuned', samples.length, boundedDelta, row.id);
  }

  private async buildLabelledSamples(now: Date): Promise<LabelledSample[]> {
    const { data: promoted } = await this.candidateRepo.list({
      statuses: [PROMOTED_STATUS],
      limit: MAX_SIGNAL_LOAD,
      page: 1,
    });

    const segmentIds = promoted
      .map((c) => c.promoted_memory_segment_id)
      .filter((id): id is string => id !== null);

    const usefulnessMap = this.feedback
      ? await this.feedback.computeUsefulnessForSegments(segmentIds, now)
      : new Map<string, { usefulness: number | null; sampleSize: number }>();

    const diversityCap = await this.resolveDiversityCap();
    const samples: LabelledSample[] = [];

    for (const candidate of promoted) {
      const sample = await this.buildSampleForCandidate(
        candidate,
        usefulnessMap,
        diversityCap,
      );
      if (sample) {
        samples.push(sample);
      }
    }

    return samples;
  }

  private async buildSampleForCandidate(
    candidate: LearningCandidate,
    usefulnessMap: Map<
      string,
      { usefulness: number | null; sampleSize: number }
    >,
    diversityCap: number,
  ): Promise<LabelledSample | null> {
    const segmentId = candidate.promoted_memory_segment_id;
    if (segmentId === null) {
      return null;
    }

    const segment = await this.segmentRepo.findById(segmentId, {
      includeArchived: true,
    });
    const usefulness = usefulnessMap.get(segmentId) ?? {
      usefulness: null,
      sampleSize: 0,
    };

    const label = deriveCandidateLabel(
      {
        archived: segment?.archived_at != null,
        superseded: segment?.superseded_by != null,
        usefulness: usefulness.usefulness,
        sampleSize: usefulness.sampleSize,
      },
      {
        usefulnessThreshold: LABEL_USEFULNESS_THRESHOLD,
        minVotes: LABEL_MIN_VOTES,
      },
    );

    if (label === null) {
      return null;
    }

    return {
      features: extractCandidateFeatures(candidate, diversityCap),
      label,
    };
  }

  private async applyWeights(weights: ScoringWeightVector): Promise<void> {
    if (!this.settings) {
      return;
    }
    await this.settings.set(
      CANDIDATE_SCORING_W_RECURRENCE,
      weights.w_recurrence,
    );
    await this.settings.set(
      CANDIDATE_SCORING_W_SOURCE_QUALITY,
      weights.w_source_quality,
    );
    await this.settings.set(CANDIDATE_SCORING_W_RECENCY, weights.w_recency);
    await this.settings.set(CANDIDATE_SCORING_W_DIVERSITY, weights.w_diversity);
    await this.settings.set(CANDIDATE_SCORING_BETA, weights.beta);
  }

  private async resolveCurrentWeights(): Promise<ScoringWeightVector> {
    if (!this.settings) {
      return {
        w_recurrence: CANDIDATE_SCORING_W_RECURRENCE_DEFAULT,
        w_source_quality: CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT,
        w_recency: CANDIDATE_SCORING_W_RECENCY_DEFAULT,
        w_diversity: CANDIDATE_SCORING_W_DIVERSITY_DEFAULT,
        beta: CANDIDATE_SCORING_BETA_DEFAULT,
      };
    }

    const [wRecurrence, wSourceQuality, wRecency, wDiversity, beta] =
      await Promise.all([
        this.settings.get<unknown>(
          CANDIDATE_SCORING_W_RECURRENCE,
          CANDIDATE_SCORING_W_RECURRENCE_DEFAULT,
        ),
        this.settings.get<unknown>(
          CANDIDATE_SCORING_W_SOURCE_QUALITY,
          CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT,
        ),
        this.settings.get<unknown>(
          CANDIDATE_SCORING_W_RECENCY,
          CANDIDATE_SCORING_W_RECENCY_DEFAULT,
        ),
        this.settings.get<unknown>(
          CANDIDATE_SCORING_W_DIVERSITY,
          CANDIDATE_SCORING_W_DIVERSITY_DEFAULT,
        ),
        this.settings.get<unknown>(
          CANDIDATE_SCORING_BETA,
          CANDIDATE_SCORING_BETA_DEFAULT,
        ),
      ]);

    return {
      w_recurrence: coerceNonNegativeNumber(
        wRecurrence,
        CANDIDATE_SCORING_W_RECURRENCE_DEFAULT,
      ),
      w_source_quality: coerceNonNegativeNumber(
        wSourceQuality,
        CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT,
      ),
      w_recency: coerceNonNegativeNumber(
        wRecency,
        CANDIDATE_SCORING_W_RECENCY_DEFAULT,
      ),
      w_diversity: coerceNonNegativeNumber(
        wDiversity,
        CANDIDATE_SCORING_W_DIVERSITY_DEFAULT,
      ),
      // beta may legitimately be negative — do not coerce to non-negative.
      beta:
        typeof beta === 'number' && Number.isFinite(beta)
          ? beta
          : CANDIDATE_SCORING_BETA_DEFAULT,
    };
  }

  private async resolveDiversityCap(): Promise<number> {
    if (!this.settings) {
      return CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT;
    }
    const raw = await this.settings.get<unknown>(
      CANDIDATE_SCORING_DIVERSITY_CAP,
      CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT,
    );
    return coerceNonNegativeNumber(
      raw,
      CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT,
    );
  }

  private async resolveConfig(): Promise<TunerConfig> {
    if (!this.settings) {
      return {
        enabled: false,
        maxDelta: FEEDBACK_WEIGHT_TUNER_MAX_DELTA_DEFAULT,
        minSamples: FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_DEFAULT,
      };
    }

    try {
      const [enabledRaw, maxDeltaRaw, minSamplesRaw] = await Promise.all([
        this.settings.get<unknown>(
          FEEDBACK_WEIGHT_TUNER_ENABLED_SETTING,
          FEEDBACK_WEIGHT_TUNER_ENABLED_DEFAULT,
        ),
        this.settings.get<unknown>(
          FEEDBACK_WEIGHT_TUNER_MAX_DELTA_SETTING,
          FEEDBACK_WEIGHT_TUNER_MAX_DELTA_DEFAULT,
        ),
        this.settings.get<unknown>(
          FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_SETTING,
          FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_DEFAULT,
        ),
      ]);

      return {
        enabled: coerceFeedbackWeightTunerEnabled(enabledRaw),
        maxDelta: coerceFeedbackWeightTunerMaxDelta(maxDeltaRaw),
        minSamples: coerceFeedbackWeightTunerMinSamples(minSamplesRaw),
      };
    } catch (error) {
      this.logger.warn(
        `FeedbackWeightTunerService config resolve failed; treating as disabled: ${(error as Error).message}`,
      );
      return {
        enabled: false,
        maxDelta: FEEDBACK_WEIGHT_TUNER_MAX_DELTA_DEFAULT,
        minSamples: FEEDBACK_WEIGHT_TUNER_MIN_SAMPLES_DEFAULT,
      };
    }
  }

  private outcome(
    applied: boolean,
    reason: WeightTuneOutcome['reason'],
    sampleSize: number,
    boundedDelta: number,
    historyId?: string,
  ): WeightTuneOutcome {
    return { applied, reason, sampleSize, boundedDelta, historyId };
  }
}
