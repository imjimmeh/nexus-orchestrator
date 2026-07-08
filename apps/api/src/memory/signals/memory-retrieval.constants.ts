/**
 * Constants for `MemoryRetrievalService` (EPIC-212 Phase 1, Task 9).
 *
 * Retrieval-specific knobs live here so they can be extended via
 * operator-facing `SystemSettings` in a follow-up without touching
 * the service file.
 */

// ── System-setting key ────────────────────────────────────────────────────────

/**
 * System-setting key that controls the memory injection strategy.
 * Accepted values: `'hybrid'` (default) | `'recency'`.
 *
 *   hybrid  — embed the current task context, run vector KNN + lexical RRF
 *             over the scope's memory segments, then re-rank by the composite
 *             formula before injection.  Falls back to recency when no
 *             embedding model is configured.
 *   recency — always return the N most recently created segments.
 */
export const MEMORY_RETRIEVAL_MODE_SETTING = 'memory_retrieval_mode';

/** Default retrieval mode shipped with the system. */
export const MEMORY_RETRIEVAL_MODE_DEFAULT = 'hybrid' as const;

// ── Retrieval tuning knobs ────────────────────────────────────────────────────

/**
 * Number of nearest-neighbour candidates requested from
 * `EmbeddingSimilarityService.findNearest` before composite re-ranking.
 * Setting this to a multiple of the expected injected set gives the
 * re-ranker enough candidates to surface the best ones even when the
 * raw similarity ranking diverges from the composite ranking.
 */
export const MEMORY_RETRIEVAL_HYBRID_CANDIDATE_K = 20;

/**
 * Exponential recency-decay constant (λ) applied to the segment age
 * in days: `recency_decay = exp(-λ × Δdays)`.
 *
 * At λ = 0.05:
 *   - 7-day-old segment retains ≈ 70 % weight
 *   - 30-day-old segment retains ≈ 22 % weight
 *
 * Matches the λ used by `CandidateScoringService` so both pipelines
 * treat staleness consistently.
 */
export const MEMORY_RETRIEVAL_RECENCY_LAMBDA = 0.05;

/**
 * Multiplicative boost applied to the composite score of pinned segments.
 * A boost of 2 means a pinned segment with half the raw relevance of an
 * unpinned segment still outranks it, reflecting operator intent to keep
 * critical facts in context.
 */
export const MEMORY_RETRIEVAL_PINNED_BOOST = 2.0;

/**
 * Neutral usefulness weight applied when no explicit agent feedback has
 * been recorded for a segment yet.  0.5 is the mid-point of [0, 1] so
 * unrated segments compete fairly with each other while rated segments
 * get a proportional advantage / penalty.
 */
export const MEMORY_RETRIEVAL_USEFULNESS_NEUTRAL = 0.5;

/** Character-to-token ratio used for rough in-process token estimation. */
export const MEMORY_RETRIEVAL_CHARS_PER_TOKEN = 4;

/** Milliseconds in one day — used for recency-decay Δdays computation. */
export const MEMORY_RETRIEVAL_MS_PER_DAY = 24 * 60 * 60 * 1_000;

// ── Provider-level defaults ───────────────────────────────────────────────────

/**
 * Upper bound on the token budget passed to `MemoryRetrievalService` by
 * `RecentTaskSummaryProvider`.  The final memory-budget enforcement happens
 * at the block level in `ChatSessionContextService`; this constant prevents
 * the provider from building an unbounded block.
 *
 * 4 096 tokens ≈ 16 KB of UTF-8 text, a conservative but sufficient slice
 * of the session's memory budget for injected long-term memories.
 */
export const MEMORY_PROVIDER_TOKEN_BUDGET = 4_096;
