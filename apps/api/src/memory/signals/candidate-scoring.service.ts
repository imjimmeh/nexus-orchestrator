import { Injectable, Logger } from '@nestjs/common';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { TemplateNoiseClassifier } from './template-noise.classifier';
import { PENDING_STATUS, MAX_SIGNAL_LOAD } from './signal-load.constants';
import {
  CANDIDATE_SCORING_W_RECURRENCE,
  CANDIDATE_SCORING_W_SOURCE_QUALITY,
  CANDIDATE_SCORING_W_RECENCY,
  CANDIDATE_SCORING_W_DIVERSITY,
  CANDIDATE_SCORING_BETA,
  CANDIDATE_SCORING_LAMBDA,
  CANDIDATE_SCORING_DIVERSITY_CAP,
  CANDIDATE_SCORING_W_RECURRENCE_DEFAULT,
  CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT,
  CANDIDATE_SCORING_W_RECENCY_DEFAULT,
  CANDIDATE_SCORING_W_DIVERSITY_DEFAULT,
  CANDIDATE_SCORING_BETA_DEFAULT,
  CANDIDATE_SCORING_LAMBDA_DEFAULT,
  CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT,
  SOURCE_QUALITY_PRIORS,
  SOURCE_QUALITY_DEFAULT_PRIOR,
  SOURCE_QUALITY_LOW_SIGNAL_PRIOR,
  coerceNonNegativeNumber,
} from '../../settings/candidate-scoring-settings.constants';
import type {
  CandidateScoringResult,
  ScoringPassResult,
} from './candidate-scoring.types';
import type { SignalCandidate } from './pipeline.types';

export type { CandidateScoringResult, ScoringPassResult };
export type { SignalCandidate } from './pipeline.types';

// ── Private types ─────────────────────────────────────────────────────────────

/** Resolved runtime weights read from SystemSettingsService. */
interface ScoringWeights {
  wRecurrence: number;
  wSourceQuality: number;
  wRecency: number;
  wDiversity: number;
  beta: number;
  lambda: number;
  diversityCap: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Pure computation helpers ──────────────────────────────────────────────────

/**
 * Logistic sigmoid: `1 / (1 + exp(-x))`.
 * Maps any real number to (0, 1), where negative x → near 0, positive → near 1.
 */
function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute the recency-decay factor.
 *
 * `decay = exp(-λ · Δdays)` where `Δdays` is the number of elapsed days
 * since `referenceDate` (i.e. `first_seen_at`). Δdays is floored at 0 so
 * a future timestamp (clock skew) never exceeds 1.
 */
function computeRecencyDecay(referenceDate: Date, lambda: number): number {
  const nowMs = Date.now();
  const deltaMs = Math.max(0, nowMs - referenceDate.getTime());
  const deltaDays = deltaMs / MILLISECONDS_PER_DAY;
  return Math.exp(-lambda * deltaDays);
}

/**
 * Resolve the source-quality confidence prior for a candidate.
 *
 * Low-signal classification (from `TemplateNoiseClassifier`) always wins;
 * otherwise the per-type prior from `SOURCE_QUALITY_PRIORS` is used.
 *
 * Parameter type uses the shared pipeline {@link SignalCandidate} subset
 * (`candidate_type` / `title` / `summary`) because this helper only reads
 * those three fields to feed `TemplateNoiseClassifier` and the per-type
 * prior lookup. `LearningCandidate` and any wider row shape remains
 * assignable to this parameter because the subset is structural.
 */
function computeSourceQuality(
  candidate: Pick<SignalCandidate, 'candidate_type' | 'title' | 'summary'>,
  classifier: TemplateNoiseClassifier,
): number {
  const { isLowSignal } = classifier.classify(candidate);
  if (isLowSignal) {
    return SOURCE_QUALITY_LOW_SIGNAL_PRIOR;
  }
  return (
    SOURCE_QUALITY_PRIORS[candidate.candidate_type] ??
    SOURCE_QUALITY_DEFAULT_PRIOR
  );
}

/**
 * Compute the normalised stage-diversity fraction, clamped to [0, 1].
 *
 * `diversityNorm = min(stage_diversity_count, diversityCap) / diversityCap`
 */
function computeDiversityNorm(
  stageDiversityCount: number,
  diversityCap: number,
): number {
  return Math.min(stageDiversityCount, diversityCap) / diversityCap;
}

/**
 * Compute the composite logistic score from individual signals and weights.
 *
 * Formula:
 * ```
 * raw = w_recurrence · log(recurrence_count + 1)
 *     + w_source_quality · source_quality_confidence
 *     + w_recency · recency_decay
 *     + w_diversity · diversity_norm
 *     + β
 *
 * score = σ(raw) = 1 / (1 + exp(-raw))
 * ```
 *
 * Notes:
 * - `log(recurrence_count + 1)` is used (not `log(recurrence_count)`) to
 *   avoid −∞ for a singleton (recurrence_count = 1 → log(2) ≈ 0.69).
 *   Actually the brief says log(recurrence_count) with recurrence_count ≥ 1,
 *   but log(1) = 0, which is well-defined. We use Math.log(recurrence_count)
 *   directly so a singleton contributes 0 to the recurrence term.
 */
function computeScore(
  sourceQuality: number,
  recencyDecay: number,
  diversityNorm: number,
  recurrenceCount: number,
  weights: ScoringWeights,
): { score: number; raw: number } {
  const raw =
    weights.wRecurrence * Math.log(recurrenceCount) +
    weights.wSourceQuality * sourceQuality +
    weights.wRecency * recencyDecay +
    weights.wDiversity * diversityNorm +
    weights.beta;
  return { score: logistic(raw), raw };
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Populates the ranking columns (`score`, `recency_decay`,
 * `source_quality_confidence`, `stage_diversity_count`, `signals_json`) on
 * `status='pending'` {@link LearningCandidate} rows so the downstream sweep
 * can consume pre-ranked candidates rather than triaging everything.
 *
 * **Scheduler ordering**
 * The scoring pass must run AFTER {@link CandidateClustererService} (which
 * sets `recurrence_count`) and BEFORE the 2am `memory_learning_sweep`.
 * The nightly cluster pass fires at 01:00 UTC; the scoring pass should
 * fire at 01:30 UTC (or be chained immediately after clustering completes
 * inside the clusterer processor).
 *
 * **`recurrence_count` is read-only**
 * The clusterer owns `recurrence_count`. This service reads the value from
 * the entity and uses it in the composite score but never writes it back.
 *
 * **Idempotency**
 * Only `status='pending'` rows are loaded. Re-running the pass on unchanged
 * data produces the same scores because all inputs are deterministic given
 * the candidate's fields and the current time (recency is the only
 * time-varying input — a re-score on the same calendar day changes recency
 * decay by < 0.1 % for λ = 0.05).
 *
 * **Weights**
 * Weights and λ are read from {@link SystemSettingsService} on each call to
 * `resolveWeights()` so operators can tune them without a restart. They live
 * under the `candidate_scoring_*` namespace in `system_settings`.
 */
@Injectable()
export class CandidateScoringService {
  private readonly logger = new Logger(CandidateScoringService.name);

  constructor(
    private readonly candidateRepo: LearningCandidateRepository,
    private readonly settings: SystemSettingsService,
    private readonly classifier: TemplateNoiseClassifier,
  ) {}

  /**
   * Score all `status='pending'` candidates and persist the results.
   *
   * Each candidate is updated with:
   * - `source_quality_confidence` — per-type prior (or low-signal override)
   * - `recency_decay` — exp(-λ · Δdays) from `first_seen_at`
   * - `stage_diversity_count` — unchanged (preserved from entity; future
   *   emitters will populate this; defaults to 1 when not set)
   * - `score` — composite logistic
   * - `signals_json` — per-signal breakdown for the UI score popover
   *
   * **`recurrence_count` is NOT written** — owned by the clusterer.
   */
  async scoreAll(): Promise<ScoringPassResult> {
    const { data: pending } = await this.candidateRepo.list({
      statuses: [PENDING_STATUS],
      limit: MAX_SIGNAL_LOAD,
      page: 1,
    });

    if (pending.length === 0) {
      return { scored: 0, totalPending: 0 };
    }

    const weights = await this.resolveWeights();
    let scored = 0;

    for (const candidate of pending) {
      try {
        const result = this.computeScoring(candidate, weights);
        await this.candidateRepo.updateById(candidate.id, {
          source_quality_confidence: result.source_quality_confidence,
          recency_decay: result.recency_decay,
          stage_diversity_count: result.stage_diversity_count,
          score: result.score,
          signals_json: result.signals_json,
        });
        scored++;
      } catch (error) {
        const err = error as Error;
        this.logger.warn(
          `CandidateScoringService: failed to score candidate ${candidate.id}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `CandidateScoringService pass: pending=${pending.length.toString()}, scored=${scored.toString()}`,
    );

    return { scored, totalPending: pending.length };
  }

  /**
   * Compute and return the scoring result for a single candidate WITHOUT
   * persisting it. Useful for testing, preview, and the clusterer chain
   * calling scoring inline.
   *
   * Does NOT call `candidateRepo.updateById`.
   */
  async scoreOne(
    candidate: LearningCandidate,
  ): Promise<CandidateScoringResult> {
    const weights = await this.resolveWeights();
    return this.computeScoring(candidate, weights);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Pure synchronous scoring computation over a resolved `ScoringWeights`
   * object. All time-varying logic is confined to `computeRecencyDecay`;
   * everything else is a deterministic function of the candidate's fields
   * and the weights, so two calls with the same inputs produce the same
   * output (modulo sub-millisecond clock skew in recency decay).
   */
  private computeScoring(
    candidate: LearningCandidate,
    weights: ScoringWeights,
  ): CandidateScoringResult {
    const sourceQuality = computeSourceQuality(candidate, this.classifier);
    const recencyDecay = computeRecencyDecay(
      candidate.first_seen_at,
      weights.lambda,
    );
    const diversityNorm = computeDiversityNorm(
      candidate.stage_diversity_count,
      weights.diversityCap,
    );

    const { score, raw } = computeScore(
      sourceQuality,
      recencyDecay,
      diversityNorm,
      candidate.recurrence_count,
      weights,
    );

    const signalsJson: Record<string, unknown> = {
      source_quality_confidence: sourceQuality,
      recency_decay: recencyDecay,
      recurrence_count: candidate.recurrence_count,
      stage_diversity_norm: diversityNorm,
      composite_raw: raw,
      weights: {
        w_recurrence: weights.wRecurrence,
        w_source_quality: weights.wSourceQuality,
        w_recency: weights.wRecency,
        w_diversity: weights.wDiversity,
        beta: weights.beta,
        lambda: weights.lambda,
        diversity_cap: weights.diversityCap,
      },
    };

    return {
      score,
      source_quality_confidence: sourceQuality,
      recency_decay: recencyDecay,
      stage_diversity_count: candidate.stage_diversity_count,
      signals_json: signalsJson,
    };
  }

  /**
   * Read the composite-score weights from `SystemSettingsService`.
   * Invalid or missing values fall back to the defaults defined in
   * `candidate-scoring-settings.constants.ts`.
   *
   * Called once per `scoreAll()` / `scoreOne()` invocation so the
   * pass always uses a consistent set of weights even when settings
   * change mid-pass (unlikely but deterministic).
   */
  private async resolveWeights(): Promise<ScoringWeights> {
    const [
      wRecurrence,
      wSourceQuality,
      wRecency,
      wDiversity,
      beta,
      lambda,
      diversityCap,
    ] = await Promise.all([
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
      this.settings.get<unknown>(
        CANDIDATE_SCORING_LAMBDA,
        CANDIDATE_SCORING_LAMBDA_DEFAULT,
      ),
      this.settings.get<unknown>(
        CANDIDATE_SCORING_DIVERSITY_CAP,
        CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT,
      ),
    ]);

    return {
      wRecurrence: coerceNonNegativeNumber(
        wRecurrence,
        CANDIDATE_SCORING_W_RECURRENCE_DEFAULT,
      ),
      wSourceQuality: coerceNonNegativeNumber(
        wSourceQuality,
        CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT,
      ),
      wRecency: coerceNonNegativeNumber(
        wRecency,
        CANDIDATE_SCORING_W_RECENCY_DEFAULT,
      ),
      wDiversity: coerceNonNegativeNumber(
        wDiversity,
        CANDIDATE_SCORING_W_DIVERSITY_DEFAULT,
      ),
      // beta may be negative — do not coerce to non-negative
      beta:
        typeof beta === 'number' && Number.isFinite(beta)
          ? beta
          : CANDIDATE_SCORING_BETA_DEFAULT,
      lambda: coerceNonNegativeNumber(lambda, CANDIDATE_SCORING_LAMBDA_DEFAULT),
      diversityCap: coerceNonNegativeNumber(
        diversityCap,
        CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT,
      ),
    };
  }
}
