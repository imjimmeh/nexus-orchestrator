/**
 * Zod schemas for the `query_memory` internal tool response.
 *
 * The `query_memory` workflow tool projects rows from the
 * `memory_segments` table (see `IMemorySegment` in
 * `packages/core/src/interfaces/workflow-legacy.types.ts` and
 * `apps/api/src/memory/database/entities/memory-segment.entity.ts`)
 * and returns them with the additional provenance / confidence /
 * entity-metadata fields that the 2026-06-16 memory-system probe
 * flagged as missing at the API boundary.
 *
 * The response contract has two projections:
 *   1. `queryMemoryResponseSegmentSchema` — a single projected
 *      segment with provenance, confidence, entity metadata, and
 *      `metadata_json` preserved.
 *   2. `queryMemoryResponseLearningProjectionSchema` — the promoted-
 *      lessons block (`learning`) returned when `include_learning`
 *      is set on the request. Reuses the same segment shape so
 *      agents receive a consistent view across both blocks.
 *
 * `provenance` is not a column on `memory_segments`; the handler
 * synthesizes it from `metadata_json` (e.g. for
 * `source = 'learning_candidate'` segments the handler extracts
 * `workflow_run_id`, `job_id`, `agent_profile_name`, and
 * `learning_candidate_id` from the stored provenance block and
 * surfaces them as a top-level `provenance` object). The schema
 * is permissive — the documented fields are optional so segments
 * without provenance metadata validate cleanly, and additional
 * keys are allowed to round-trip without stripping.
 */
import { z } from "zod";
import { MEMORY_TYPES } from "./memory-queries.schema";

/**
 * Per-segment provenance block.
 *
 * Populated by the handler for `learning_candidate` source
 * segments promoted through `LearningPromotionService` (see the
 * `buildMetadata` helper in
 * `apps/api/src/memory/learning/learning-promotion.service.ts`),
 * which stores `workflow_run_id`, `job_id`, `agent_profile_name`,
 * `requested_by`, `scope_type`, `scope_id`, and `learning_candidate_id`
 * under `metadata_json`. Other sources typically have no provenance
 * metadata to surface, so the field is `nullable`.
 *
 * The schema uses `.loose()` (passthrough) so the handler can carry
 * additional provenance keys verbatim without stripping or
 * rejecting them; documented fields remain typed for
 * first-class consumers.
 */
export const queryMemoryResponseProvenanceSchema = z
  .object({
    /**
     * Stable identifier of the policy/decision that produced the
     * segment. Synthesized from `provenance.sourceDecisionId` on the
     * originating learning candidate, falling back to
     * `policy:<name>:<code>` when not recorded. Nullable because
     * non-`learning_candidate` segments do not carry a decision id.
     */
    source_decision_id: z.string().trim().min(1).nullable().optional(),
    /**
     * Workflow run that produced the originating learning candidate
     * (or that wrote the segment, for non-promoted rows where the
     * handler can derive a run id). Mirrors the `workflow_run_id`
     * field stored under `metadata_json.provenance` for promoted
     * learning candidates.
     */
    workflow_run_id: z.string().trim().min(1).nullable().optional(),
    /**
     * Job that produced the originating learning candidate, when
     * recorded. Mirrors the `job_id` field stored under
     * `metadata_json.provenance`.
     */
    job_id: z.string().trim().min(1).nullable().optional(),
    /**
     * Agent profile name that produced the originating learning
     * candidate, when recorded. Mirrors the `agent_profile_name`
     * field stored under `metadata_json.provenance`. Surfaced under
     * the canonical `agent_profile` name so consumers do not have
     * to special-case `agent_profile_name`.
     */
    agent_profile: z.string().trim().min(1).nullable().optional(),
    /**
     * Operator / sweep identifier recorded via
     * `LearningPromotionService.promoteCandidate({ requestedBy })`.
     */
    requested_by: z.string().trim().min(1).nullable().optional(),
    /**
     * Learning scope type associated with the originating candidate
     * (e.g. `workflow_run`, `global`).
     */
    scope_type: z.string().trim().min(1).nullable().optional(),
    /**
     * Learning scope id associated with the originating candidate.
     */
    scope_id: z.string().trim().min(1).nullable().optional(),
    /**
     * Learning candidate id that produced the segment, present only
     * for `source = 'learning_candidate'` segments. Lets agents
     * correlate a promoted lesson back to the originating candidate
     * without having to round-trip through `record_learning`.
     */
    learning_candidate_id: z.string().trim().min(1).nullable().optional(),
    /**
     * ISO-8601 timestamp at which the originating learning candidate
     * was promoted to a memory segment. Synthesized by the handler
     * from `LearningCandidate.promoted_at` for
     * `source = 'learning_candidate'` segments; `null` for segments
     * that have no recorded promotion time.
     */
    promoted_at: z.iso.datetime().nullable().optional(),
  })
  .loose();

/**
 * A single projected memory segment as returned by `query_memory`.
 *
 * All fields map 1:1 onto the underlying `memory_segments` row,
 * with the exception of:
 *   - `provenance` — synthesized from `metadata_json` (see above).
 *   - `memory_type` — narrows the column to the `MEMORY_TYPES`
 *     enum (`preference` | `fact` | `history`).
 *
 * Date fields are validated as ISO-8601 strings to match the
 * wire format used by the existing controller surface (the
 * handler converts `Date` to ISO strings before responding).
 */
export const queryMemoryResponseSegmentSchema = z.object({
  /** UUID primary key of the row. */
  id: z.uuid(),
  /** Entity type the segment is attached to (e.g. `User`, `Project`). */
  entity_type: z.string(),
  /** Entity id the segment is attached to. */
  entity_id: z.string(),
  /** Segment memory type. Narrowed to `MEMORY_TYPES`. */
  memory_type: z.enum(MEMORY_TYPES),
  /** Free-text content of the segment. */
  content: z.string(),
  /** Optimistic-concurrency version counter. */
  version: z.number().int().nonnegative(),
  /**
   * Coarse classification of where the segment came from
   * (`learning_candidate`, `conversation`, `user_input`, etc.).
   * Nullable because not every segment has a recorded source.
   * Matches the DB column constraint (`varchar(64)`).
   */
  source: z.string().max(64).nullable(),
  /**
   * Promotion confidence for `learning_candidate` segments, copied
   * from `metadata_json.confidence` by the handler. `null` for
   * non-promoted segments. Range matches the
   * `RuntimeRecordLearningBody.confidence` contract (`0..1`).
   */
  confidence: z.number().min(0).max(1).nullable(),
  /**
   * Synthesized provenance block (see
   * `queryMemoryResponseProvenanceSchema`). `null` for segments
   * that have no recorded provenance metadata.
   */
  provenance: queryMemoryResponseProvenanceSchema.nullable(),
  /**
   * Wall-clock timestamp of the most recent read of the segment.
   * Nullable: a null value means "never touched".
   */
  last_accessed_at: z.iso.datetime().nullable(),
  /** ISO-8601 string for when the segment was first written. */
  created_at: z.iso.datetime().nullable(),
  /**
   * Full stored `metadata_json` payload, preserved verbatim so
   * callers can read additional fields the handler does not
   * surface as first-class columns (e.g. `tags`, `evidence`,
   * `promotion_policy`, `learning_candidate_id`).
   */
  metadata_json: z.record(z.string(), z.unknown()).nullable(),
  /**
   * Rolling-window usefulness ratio computed by
   * `MemorySegmentFeedbackService.computeUsefulnessForSegments`
   * (work item 66ea23d1-59f2-451b-a090-a292fad8f21b, milestone 3).
   *
   * Equals `count(useful_votes) / count(total_votes)` over the
   * `memory_feedback_window_days` SystemSetting window. `null`
   * when the segment has received zero feedback in the window —
   * the backfill-safe shape that lets downstream consumers
   * distinguish "agent has not voted on this segment yet" from
   * "every vote so far was not-useful" (`0`).
   *
   * Range is `[0, 1]`. Always present (nullable, not optional)
   * so the wire-format contract is stable for callers that
   * inspect the field unconditionally.
   */
  usefulness: z.number().min(0).max(1).nullable(),
});

/**
 * Wrapper for the promoted-lessons block returned when
 * `include_learning` is true on the request. Mirrors the shape
 * the handler builds in `loadPromotedLearningProjection`.
 */
export const queryMemoryResponseLearningProjectionSchema = z.object({
  /** Echo of the request query (empty string if no query was set). */
  query: z.string(),
  /** Number of promoted lessons included. */
  count: z.number().int().nonnegative(),
  /** Projected promoted-lesson segments. */
  segments: z.array(queryMemoryResponseSegmentSchema),
});

/**
 * Full `query_memory` response envelope.
 *
 * `learning` is optional — only present when the caller passes
 * `include_learning: true`. Mirrors the handler's runtime
 * projection: `entity_type`, `entity_id`, `query`, `memory_type`,
 * `count`, `segments`, and (optionally) `learning`.
 */
export const queryMemoryResponseSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
  query: z.string().nullable(),
  memory_type: z.enum(MEMORY_TYPES).nullable(),
  count: z.number().int().nonnegative(),
  segments: z.array(queryMemoryResponseSegmentSchema),
  learning: queryMemoryResponseLearningProjectionSchema.nullable().optional(),
});

export type QueryMemoryResponseProvenance = z.infer<
  typeof queryMemoryResponseProvenanceSchema
>;
export type QueryMemoryResponseSegment = z.infer<
  typeof queryMemoryResponseSegmentSchema
>;
export type QueryMemoryResponseLearningProjection = z.infer<
  typeof queryMemoryResponseLearningProjectionSchema
>;
export type QueryMemoryResponse = z.infer<typeof queryMemoryResponseSchema>;
