/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the EPIC-212 Phase 1
 * candidate-similarity threshold + candidate-scoring weight knobs
 * (work item 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 4).
 *
 * The fragment consolidates eight keyed defaults that drive the
 * `EmbeddingSimilarityService` (dedup) and the
 * `CandidateScoringService` (logistic composite) of the learning
 * candidate pipeline:
 *
 *   - `candidate_similarity_threshold` — minimum cosine similarity
 *     score for two candidates to be considered near-duplicates
 *     by the dedup sweep.
 *   - `candidate_scoring_w_recurrence` — log-recurrence weight
 *     for the logistic score formula.
 *   - `candidate_scoring_w_source_quality` — source-quality
 *     confidence weight for the logistic score formula.
 *   - `candidate_scoring_w_recency` — recency-decay weight for
 *     the logistic score formula.
 *   - `candidate_scoring_w_diversity` — stage-diversity weight
 *     for the logistic score formula.
 *   - `candidate_scoring_beta` — logistic bias term β.
 *   - `candidate_scoring_lambda` — decay constant λ for the
 *     exponential recency-decay formula.
 *   - `candidate_scoring_diversity_cap` — stage-diversity cap.
 *
 * The keys + defaults + bounds live in the sibling files
 * `../memory/signals/candidate-similarity.config` (the threshold
 * setting) and `./candidate-scoring-settings.constants` (the
 * seven weight / bias / lambda / cap settings). The fragment
 * imports the typed keys and hardcoded defaults directly so the
 * seeded values stay byte-identical to the runtime constants the
 * scoring / similarity services fall back to, and the
 * description strings can quote the same numeric defaults the
 * services use.
 *
 * The weights are intentionally conservative hand-set priors.
 * EPIC-212 Phase 3 tunes them against empirical promotion success
 * data; all weight keys use the `candidate_scoring_*` namespace
 * so operators can filter them in the settings UI.
 *
 * Extracted out of `system-settings.defaults.ts` so that file
 * stays under the project's `max-lines` lint cap while the
 * operator-tunable knob surface continues to grow across
 * milestones. The spread keeps the seeded defaults byte-identical
 * to the pre-refactor inline registry.
 */
import {
  CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT,
  CANDIDATE_SIMILARITY_THRESHOLD_SETTING,
} from '../memory/signals/candidate-similarity.config';
import {
  CANDIDATE_SCORING_BETA,
  CANDIDATE_SCORING_BETA_DEFAULT,
  CANDIDATE_SCORING_DIVERSITY_CAP,
  CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT,
  CANDIDATE_SCORING_LAMBDA,
  CANDIDATE_SCORING_LAMBDA_DEFAULT,
  CANDIDATE_SCORING_W_DIVERSITY,
  CANDIDATE_SCORING_W_DIVERSITY_DEFAULT,
  CANDIDATE_SCORING_W_RECENCY,
  CANDIDATE_SCORING_W_RECENCY_DEFAULT,
  CANDIDATE_SCORING_W_RECURRENCE,
  CANDIDATE_SCORING_W_RECURRENCE_DEFAULT,
  CANDIDATE_SCORING_W_SOURCE_QUALITY,
  CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT,
} from './candidate-scoring-settings.constants';

export const CANDIDATE_SIMILARITY_SCORING_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [CANDIDATE_SIMILARITY_THRESHOLD_SETTING]: {
    value: CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT,
    description: `Minimum cosine-similarity score (0–1, default ${CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT}) used by EmbeddingSimilarityService to consider two learning candidates near-duplicates. Candidates whose hybrid RRF score exceeds this threshold may be collapsed during the deduplication sweep. Raise the value to be more selective (fewer collapses); lower it to collapse more aggressively.`,
  },
  [CANDIDATE_SCORING_W_RECURRENCE]: {
    value: CANDIDATE_SCORING_W_RECURRENCE_DEFAULT,
    description: `Log-recurrence weight (default ${CANDIDATE_SCORING_W_RECURRENCE_DEFAULT}) in the CandidateScoringService logistic formula. Higher values reward candidates that appear across multiple workflow runs. Phase 3 will tune via empirical promotion-success data.`,
  },
  [CANDIDATE_SCORING_W_SOURCE_QUALITY]: {
    value: CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT,
    description: `Source-quality confidence weight (default ${CANDIDATE_SCORING_W_SOURCE_QUALITY_DEFAULT}) in the CandidateScoringService logistic formula. Controls how much the per-type source prior (agent_capture=0.9, struggle=0.8, runtime_learning=0.5, low-signal=0.2) shifts the composite score.`,
  },
  [CANDIDATE_SCORING_W_RECENCY]: {
    value: CANDIDATE_SCORING_W_RECENCY_DEFAULT,
    description: `Recency-decay weight (default ${CANDIDATE_SCORING_W_RECENCY_DEFAULT}) in the CandidateScoringService logistic formula. Controls how strongly recent candidates are preferred over stale ones relative to source quality.`,
  },
  [CANDIDATE_SCORING_W_DIVERSITY]: {
    value: CANDIDATE_SCORING_W_DIVERSITY_DEFAULT,
    description: `Stage-diversity weight (default ${CANDIDATE_SCORING_W_DIVERSITY_DEFAULT}) in the CandidateScoringService logistic formula. Rewards candidates whose evidence spans multiple distinct workflow stages.`,
  },
  [CANDIDATE_SCORING_BETA]: {
    value: CANDIDATE_SCORING_BETA_DEFAULT,
    description: `Logistic bias term β (default ${CANDIDATE_SCORING_BETA_DEFAULT}) in the CandidateScoringService formula. Negative so a candidate whose signals are all at their neutral mid-point scores below 0.5, requiring a meaningful signal combination to exceed the promotion threshold.`,
  },
  [CANDIDATE_SCORING_LAMBDA]: {
    value: CANDIDATE_SCORING_LAMBDA_DEFAULT,
    description: `Decay constant λ for recency_decay = exp(-λ·Δdays) (default ${CANDIDATE_SCORING_LAMBDA_DEFAULT}). At this value a 7-day-old candidate retains ~70 % weight; a 30-day-old candidate retains ~22 % weight.`,
  },
  [CANDIDATE_SCORING_DIVERSITY_CAP]: {
    value: CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT,
    description: `Stage-diversity cap (default ${CANDIDATE_SCORING_DIVERSITY_CAP_DEFAULT}). The linear diversity score is min(stage_diversity_count, cap)/cap. Candidates spanning more than this many distinct stages receive no additional diversity bonus.`,
  },
};
