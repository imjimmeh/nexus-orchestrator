import type {
  QueryMemoryResponseSegment,
  StrategicIntentBody,
} from '@nexus/core';

/**
 * Internal projection shape emitted by the `queryMemory` handler. Adds the
 * fields mandated by the work item `4f39ed19` (provenance / confidence /
 * entity metadata) on top of the legacy `metadata` field. The shape
 * intentionally mirrors the wire-format contract documented in
 * `packages/core/src/schemas/memory/query-memory-response.schema.ts` and
 * is validated at the handler boundary by the API-side Zod wrapper
 * `apiQueryMemoryResponseSchema` (see
 * `apps/api/src/workflow/workflow-internal-tools/schemas/memory.ts`).
 *
 * Note: the legacy `metadata` field is retained as an alias of
 * `metadata_json` for backward compatibility with the existing handler
 * spec. The canonical contract still surfaces it as `metadata_json`;
 * clients should not rely on the `metadata` alias for round-trip
 * fidelity or future-proofing.
 */
export type QueryMemorySegmentProjection = QueryMemoryResponseSegment & {
  /** Convenience alias of `metadata_json` for legacy compatibility. */
  metadata: Record<string, unknown> | null;
};

export type QueryMemoryLearningProjection = {
  query: string;
  count: number;
  segments: QueryMemorySegmentProjection[];
};

export type QueryMemoryFeedbackAck = {
  id: string;
  segment_id: string;
  useful: boolean;
};

/** Fields needed to build a `skill_create` improvement-proposal draft. */
export interface CreateSkillProposalDraftParams {
  target_skill_name: string;
  proposal_title: string;
  proposal_summary: string;
  patch_markdown: string;
  rationale?: string;
}

/**
 * Outcome of resolving a `remember` tool `scope` value to a concrete entity
 * id (Epic C). `ok: false` means the scope could not be resolved from run
 * context (e.g. `scope: 'agent'` with no `agentProfileName` on the context)
 * — callers must refuse the write rather than silently falling back to a
 * global memory.
 */
export type RememberScopeResolution =
  | { ok: true; scopeId: string | null }
  | { ok: false };

export interface RecordStrategicIntentParams {
  entity_type: string;
  entity_id: string;
  intent: StrategicIntentBody;
}

export interface ReadStrategicIntentParams {
  entity_type: string;
  entity_id: string;
}
