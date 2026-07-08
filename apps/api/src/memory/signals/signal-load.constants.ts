/**
 * Shared signal-load constants for the `MemorySignalsModule` pipeline.
 *
 * The three pass-style services
 * (`CandidateClustererService`, `CandidateScoringService`, and
 * `FeedbackWeightTunerService`) all bound the per-tick candidate load with
 * the same ceiling and reference the same `learning_candidates.status`
 * string values via inline constants. Centralising them here gives the
 * pipeline one source of truth for "what 'pending' means" and "how many
 * rows a single pass may load", so a future status migration or scale
 * tuning touches a single file instead of three.
 *
 * `MAX_ROUTING_LOAD` (the per-tick routing ceiling) is co-located with
 * the routing loop inside `CandidatePipelineService` — the only caller —
 * rather than centralised here. It bounds a different concern (per-tick
 * routing evaluation) than the per-pass candidate
 * scoring/clustering/tuning ceilings (`MAX_SIGNAL_LOAD`).
 */

// ── Candidate status string literals ─────────────────────────────────────────

/** `learning_candidates.status` value for rows awaiting the nightly sweep. */
export const PENDING_STATUS = 'pending';

/** `learning_candidates.status` value for rows advanced into a memory segment. */
export const PROMOTED_STATUS = 'promoted';

/** `learning_candidates.status` value for rows collapsed into a canonical row. */
export const MERGED_STATUS = 'merged';

// ── Shared per-pass load ceiling ─────────────────────────────────────────────

/**
 * Maximum number of `learning_candidates` rows any single
 * clustering/scoring/tuning pass may load.
 *
 * All three batch-style passes (`CandidateClustererService.cluster`,
 * `CandidateScoringService.scoreAll`, `FeedbackWeightTunerService.runTune`)
 * share this ceiling because they all operate on the same low-volume
 * nightly/weekly pipeline:
 *
 * - `CandidateScoringService` is **O(N)** — no pairwise work, so the
 *   limit is generous to absorb any backlog that built up while the
 *   service was paused.
 * - `CandidateClustererService` is **O(N²)** over the embedded subset
 *   (pairwise cosine), so the limit guards wall-clock drift in the
 *   nightly 01:00 UTC pass. Daily new-candidate volume is tens to low
 *   hundreds, well under the ceiling.
 * - `FeedbackWeightTunerService` is **O(N)** over *promoted* rows, so
 *   the same ceiling caps the weekly training corpus to a deterministic
 *   upper bound.
 *
 * A future scale-up path can either (a) split the clusterer into an
 * ANN-backed index when N exceeds the ceiling, or (b) promote this to
 * a `SystemSettingsService`-backed operator knob. Until either lands,
 * keep the three passes aligned.
 */
export const MAX_SIGNAL_LOAD = 10_000;
