/**
 * API-side Zod schemas for the `query_memory` workflow tool.
 *
 * The canonical wire-format contract for the `query_memory` response
 * lives in `packages/core/src/schemas/memory/query-memory-response.schema.ts`.
 * This file extends that contract with the API-only legacy fields
 * (`metadata` alias) that `MemoryToolsHandler.queryMemory` continues
 * to project for backward compatibility with the existing handler
 * spec (`query-memory.handler.spec.ts`).
 *
 * Why extend rather than redefine:
 *   - Avoids duplicate field definitions — the shared segment
 *     schema is the single source of truth for the wire format.
 *   - Keeps the wire-format contract single-sourced: if a new field
 *     is added to the shared `queryMemoryResponseSegmentSchema`, the
 *     API wrapper picks it up automatically.
 *
 * The legacy `metadata` field is kept in the projection so older
 * callers (and the existing handler spec) continue to read the
 * stored metadata via the historical key. The shared
 * `queryMemoryResponseSchema` strips it during parse, so consumers
 * that read the validated response never see it. The wrapper defined
 * here preserves it for runtime validation in the handler's
 * pre-flight parse and for downstream consumers that inspect the
 * raw projection.
 */
import { z } from 'zod';
import {
  queryMemoryResponseLearningProjectionSchema,
  queryMemoryResponseProvenanceSchema,
  queryMemoryResponseSchema,
  queryMemoryResponseSegmentSchema,
} from '@nexus/core';

/**
 * API-side per-segment projection.
 *
 * Mirrors `queryMemoryResponseSegmentSchema` from `@nexus/core` plus
 * the legacy `metadata` alias that the handler projects. The shared
 * segment schema is used as the base so any fields added upstream
 * (entity metadata, provenance, confidence, usefulness, etc.)
 * automatically propagate to the API wrapper.
 */
export const apiQueryMemorySegmentSchema =
  queryMemoryResponseSegmentSchema.extend({
    /**
     * Legacy alias for `metadata_json`. Mirrors the field
     * `MemoryToolsHandler` projects alongside `metadata_json` so the
     * existing handler spec continues to pass without modification.
     * Stripped by the shared `queryMemoryResponseSchema` parse during
     * validation; retained here so the handler can validate the
     * pre-strip projection against a single schema.
     */
    metadata: z.record(z.string(), z.unknown()).nullable(),
  });

/**
 * API-side promoted-lessons block.
 *
 * Mirrors `queryMemoryResponseLearningProjectionSchema` from
 * `@nexus/core` but uses `apiQueryMemorySegmentSchema` so the
 * projected segments carry the legacy `metadata` alias as well.
 */
export const apiQueryMemoryLearningProjectionSchema = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
  segments: z.array(apiQueryMemorySegmentSchema),
});

/**
 * Acknowledgement block for the optional `feedback` write on
 * `query_memory` (work item 66ea23d1-59f2-451b-a090-a292fad8f21b,
 * milestone 3). `null` when the request did not include a
 * `feedback` block (the tool stayed a pure read).
 *
 * The `id` is the server-assigned primary key of the persisted
 * `memory_segment_feedback` row — the caller can correlate the
 * ack back to a specific vote. `segment_id` echoes the
 * agent-supplied target so the ack is self-contained; `useful`
 * echoes the agent-supplied vote for downstream dashboards
 * that consume the ack directly (rather than re-fetching the
 * feedback row).
 */
export const apiQueryMemoryFeedbackAckSchema = z.object({
  id: z.uuid(),
  segment_id: z.uuid(),
  useful: z.boolean(),
});

/**
 * Full `query_memory` response envelope, API-side projection.
 *
 * Mirrors `queryMemoryResponseSchema` from `@nexus/core` but uses
 * `apiQueryMemorySegmentSchema` for the per-segment shape so the
 * legacy `metadata` alias is preserved at the array level.
 * Backwards compatibility is preserved at the array level:
 * consumers can still iterate `segments` and read every
 * shared-schema field (including the milestone-3 `usefulness`
 * field); the only additions are the `metadata` alias and
 * the optional `feedback` ack at the envelope root.
 */
export const apiQueryMemoryResponseSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
  query: z.string().nullable(),
  memory_type: z.enum(['preference', 'fact', 'history']).nullable(),
  count: z.number().int().nonnegative(),
  segments: z.array(apiQueryMemorySegmentSchema),
  learning: apiQueryMemoryLearningProjectionSchema.nullable().optional(),
  /**
   * Optional acknowledgement of a `feedback` write performed
   * during this `query_memory` call. `null` when no vote was
   * cast (the tool stayed a pure read). See
   * `apiQueryMemoryFeedbackAckSchema` for the per-field
   * contract.
   */
  feedback: apiQueryMemoryFeedbackAckSchema.nullable().optional(),
});

// Re-export the shared wire-format contract and provenance schema so
// consumers of this file can import everything they need for the
// `query_memory` tool from one location.
export {
  queryMemoryResponseSchema,
  queryMemoryResponseSegmentSchema,
  queryMemoryResponseLearningProjectionSchema,
  queryMemoryResponseProvenanceSchema,
};
