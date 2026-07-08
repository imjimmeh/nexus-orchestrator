import { Logger } from '@nestjs/common';
import type {
  IMemorySegment,
  InternalToolExecutionContext,
  QueryMemoryResponseProvenance,
} from '@nexus/core';
import { apiQueryMemoryResponseSchema } from '../schemas/memory';
import type { QueryMemorySegmentProjection } from './query-memory.types';

export type {
  QueryMemoryFeedbackAck,
  QueryMemoryLearningProjection,
  QueryMemorySegmentProjection,
} from './query-memory.types';

export function toQueryMemorySegmentProjection(
  segment: IMemorySegment,
  includeProvenance: boolean,
): QueryMemorySegmentProjection {
  const metadata = segment.metadata_json ?? null;
  const confidence = readConfidenceFromMetadata(metadata);
  const source = readSourceFromSegment(segment, metadata);
  const provenance = includeProvenance
    ? synthesizeProvenance(segment, metadata)
    : null;

  return {
    id: segment.id,
    entity_type: segment.entity_type,
    entity_id: segment.entity_id,
    memory_type: segment.memory_type,
    content: segment.content,
    version: segment.version,
    source,
    confidence,
    provenance,
    last_accessed_at: toIsoStringOrNull(segment.last_accessed_at),
    created_at: toIsoStringOrNull(segment.created_at),
    metadata_json: metadata,
    // Milestone 3: rolling-window usefulness ratio. The pure
    // projection helper returns `null` by default; the handler
    // overlays the batch-computed ratio via
    // `projectSegmentsWithUsefulness` /
    // `attachUsefulnessToLearning` after the projection is built.
    usefulness: null,
    // Legacy alias — kept for backward compatibility with the existing
    // handler spec. The API-side `apiQueryMemoryResponseSchema` accepts
    // the `metadata` alias on the projection; the canonical wire-format
    // contract still uses `metadata_json`.
    metadata,
  };
}

function readConfidenceFromMetadata(
  metadata: Record<string, unknown> | null,
): number | null {
  if (!metadata) {
    return null;
  }
  const raw = metadata.confidence;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function readSourceFromSegment(
  segment: IMemorySegment,
  metadata: Record<string, unknown> | null,
): string | null {
  if (typeof segment.source === 'string' && segment.source.trim().length > 0) {
    return segment.source;
  }
  if (
    metadata &&
    typeof metadata.source === 'string' &&
    metadata.source.trim().length > 0
  ) {
    return metadata.source;
  }
  return null;
}

/**
 * Synthesize the per-segment `provenance` block from the row's
 * `metadata_json`. Pass-through if the underlying DTO row already carries
 * a top-level `provenance` column (forward-compat with future schema
 * additions); otherwise lift the documented provenance keys from
 * `metadata_json` for `learning_candidate` and `fact` source segments.
 *
 * Returns `null` when no provenance information is recoverable so the
 * `provenance` field stays a clean nullable in the response.
 */
function synthesizeProvenance(
  segment: IMemorySegment,
  metadata: Record<string, unknown> | null,
): QueryMemoryResponseProvenance | null {
  const dtoProvenance = (segment as { provenance?: unknown }).provenance;
  if (dtoProvenance !== undefined) {
    if (dtoProvenance === null) {
      return null;
    }
    if (typeof dtoProvenance === 'object' && !Array.isArray(dtoProvenance)) {
      return dtoProvenance as QueryMemoryResponseProvenance;
    }
  }

  const source = readSourceFromSegment(segment, metadata);
  if (source !== 'learning_candidate' && source !== 'fact') {
    return null;
  }

  if (!metadata) {
    return null;
  }

  const provenance: Record<string, unknown> = {};

  const liftString = (key: string): void => {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      provenance[key] = value.trim();
    }
  };

  liftString('source_decision_id');
  liftString('workflow_run_id');
  liftString('job_id');
  // `agent_profile_name` is the key written by `LearningPromotionService.buildMetadata`;
  // surface it under the canonical `agent_profile` name documented in the schema.
  const agentProfileRaw = metadata.agent_profile ?? metadata.agent_profile_name;
  if (
    typeof agentProfileRaw === 'string' &&
    agentProfileRaw.trim().length > 0
  ) {
    provenance.agent_profile = agentProfileRaw.trim();
  }
  liftString('requested_by');
  liftString('scope_type');
  liftString('scope_id');
  liftString('learning_candidate_id');

  return Object.keys(provenance).length === 0 ? null : provenance;
}

export function toIsoStringOrNull(
  value: Date | string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.toISOString();
}

/**
 * Validate the projected response against the shared Zod schema.
 *
 * Per the work item, validation must run on every call so that
 * wire-format drift surfaces in production logs. On failure we
 * `logger.warn` and continue returning the (already-built)
 * response so a malformed projection never breaks a read path.
 */
export function validateQueryMemoryResponse(
  response: Record<string, unknown>,
  logger: Logger,
): void {
  try {
    apiQueryMemoryResponseSchema.parse(response);
  } catch (error) {
    logger.warn(
      `queryMemory response failed schema validation: ${(error as Error).message}`,
    );
  }
}

/**
 * Resolve the agent profile name from the tool execution context
 * (work item 66ea23d1-59f2-451b-a090-a292fad8f21b, milestone 3).
 *
 * `MemorySegmentFeedbackService.recordFeedback` requires a non-empty
 * `agentProfileId`. When the context omits `agentProfileName` (e.g.
 * a hand-constructed unit-test context that exercises the pure-read
 * path), we fall back to the literal `'unknown-agent'` sentinel so
 * the row still persists with a recognisable audit value rather
 * than throwing and breaking the read path. The audit row's
 * `agent_profile_id` column is a `varchar(160)`, so the sentinel
 * fits without further validation.
 */
export function readAgentProfileId(
  context: InternalToolExecutionContext,
): string {
  const candidate =
    typeof context.agentProfileName === 'string'
      ? context.agentProfileName.trim()
      : '';
  if (candidate.length > 0) {
    return candidate;
  }
  return 'unknown-agent';
}

/**
 * Resolve the workflow run id from the tool execution context.
 *
 * `MemorySegmentFeedbackService.recordFeedback` requires a non-empty
 * `workflowRunId` (the column is NOT NULL `uuid`). When the context
 * omits `workflowRunId`, we fall back to a fixed UUID-shaped sentinel
 * (`00000000-0000-4000-8000-000000000000`) so the row still persists
 * with a recognisable audit value rather than throwing and breaking
 * the read path. The sentinel matches the project's `00000000-…`
 * pattern for placeholder UUIDs (see `nextSegmentFixtureId` in the
 * handler spec). A future refactor that wants to surface the missing-
 * context case to operators can swap the sentinel for an `emit`
 * of a diagnostic event without changing the public contract.
 */
export function readWorkflowRunId(
  context: InternalToolExecutionContext,
): string {
  const candidate =
    typeof context.workflowRunId === 'string'
      ? context.workflowRunId.trim()
      : '';
  if (candidate.length > 0) {
    return candidate;
  }
  return '00000000-0000-4000-8000-000000000000';
}
