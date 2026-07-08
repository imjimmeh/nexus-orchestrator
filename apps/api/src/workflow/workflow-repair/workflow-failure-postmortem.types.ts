/**
 * Type contracts and helpers for the workflow-failure postmortem
 * writeback (work item 5743ac93-456d-41b3-ae5b-0ca2554318da).
 *
 * The `WorkflowFailurePostmortemListener` (milestone 2) is the
 * primary producer of these types — it constructs a
 * {@link WorkflowPostmortemPayload} from a `FailureClassificationDecision`
 * (see `./failure-classification.types.ts`) and the evidence digest,
 * renders it into human-readable text via
 * {@link renderPostmortemText}, and persists the result as a
 * `memory_segment` row keyed on `metadata_json.workflow_run_id`.
 *
 * This milestone (1) defines the contract only — the listener
 * itself is intentionally deferred to milestone 2. The types here
 * are the surface the listener (and the follow-up `LearningService`
 * integration in milestone 3) wire against.
 *
 * The `Source: workflow_failure_postmortem` token in
 * {@link renderPostmortemText} is a deliberate findability hook:
 * the existing `query_memory` tool can locate a postmortem by
 * content-keyword search even if the `metadata_json.source`
 * filter is misconfigured, which keeps the surface operator-safe.
 */
import {
  REPAIR_POLICY_CLASSES,
  REPAIR_POLICY_ELIGIBILITIES,
  type RepairPolicyClass,
} from './failure-classification.types';
import {
  WORKFLOW_POSTMORTEM_OUTCOMES,
  WORKFLOW_POSTMORTEM_RECORDED_EVENT,
} from './workflow-failure-postmortem.constants';

export type WorkflowPostmortemOutcome =
  (typeof WORKFLOW_POSTMORTEM_OUTCOMES)[number];

/**
 * Structural shape of the postmortem the listener writes to the
 * memory subsystem on `WORKFLOW_RUN_FAILED_EVENT`.
 *
 * The fields mirror the spec document: every field is required
 * and non-nullable so the {@link isWorkflowPostmortemPayload}
 * guard can reject partial / malformed shapes at the API boundary
 * (the listener will only ever construct well-formed payloads,
 * but the guard is useful for cross-process payloads — e.g.
 * redrive-from-event-ledger flows or operator-driven backfills).
 *
 * `scope_id` is the resolved entity scope the listener extracted
 * from `state_variables` / `triggerData` before constructing the
 * payload. Operators querying `query_memory` filter by this
 * field to scope postmortems to a single entity. (The work item
 * spec document uses a domain-specific name here; we use the
 * neutral `scope_id` name to comply with the API/core boundary
 * lint policy that forbids project-domain identifiers in this
 * directory.)
 */
export interface WorkflowPostmortemPayload {
  workflow_run_id: string;
  /** Resolved `scope_id` (entity scope, e.g. resource / initiative). */
  scope_id: string;
  failure_class: RepairPolicyClass;
  /** Confidence score 0..1, sourced from `FailureClassificationDecision.confidence`. */
  confidence: number;
  repair_decision: {
    eligibility: (typeof REPAIR_POLICY_ELIGIBILITIES)[number];
    allowedRepairActionIds: string[];
    reason: string;
  };
  /**
   * Human-readable digest of the evidence (the listener calls into
   * `WorkflowFailureClassificationService.buildEvidenceSummary` and
   * serializes it). Stored as `metadata_json.evidence_summary` AND
   * rendered into the `content` text by {@link renderPostmortemText}.
   */
  evidence_summary: string;
  /** ISO-8601 timestamp of the failure (anchors the occurrence window). */
  occurred_at: string;
}

/**
 * Render a {@link WorkflowPostmortemPayload} into the human-readable
 * text stored in `memory_segments.content`.
 *
 * Pure function — the listener calls this with a payload it
 * already validated, then passes the result to
 * `MemoryManagerService.createMemorySegment` as the `content`
 * argument. The output is intentionally line-oriented so the
 * existing `query_memory` tool's content-keyword search can find
 * individual fields (e.g. an operator searching for the literal
 * `Source: workflow_failure_postmortem`, or for a specific
 * `Failure class:` value).
 *
 * The leading `Source: workflow_failure_postmortem` line is
 * required (it is the findability hook documented at the top of
 * this file). The `Evidence:` block is indented by 2 spaces; if
 * `evidence_summary` contains newlines, each subsequent line is
 * indented by an additional 2 spaces so the block reads as a
 * single paragraph in monospaced terminals.
 *
 * `allowedRepairActionIds` is rendered as a comma-joined list
 * (empty → `none`) so the line stays single-line and grep-friendly
 * for the existing content search. `confidence` is rendered with
 * 2 decimal places — the classification service already returns a
 * 0..1 float, so the format is stable.
 */
export function renderPostmortemText(
  payload: WorkflowPostmortemPayload,
): string {
  const allowedActionIds =
    payload.repair_decision.allowedRepairActionIds.length === 0
      ? 'none'
      : payload.repair_decision.allowedRepairActionIds.join(',');
  const confidence = payload.confidence.toFixed(2);
  const eligibility = payload.repair_decision.eligibility;
  const reason = payload.repair_decision.reason;

  const evidenceLines = payload.evidence_summary.split('\n');
  const evidenceBlock = evidenceLines
    .map((line, index) => (index === 0 ? `  ${line}` : `    ${line}`))
    .join('\n');

  return [
    `Source: workflow_failure_postmortem`,
    `Workflow run: ${payload.workflow_run_id}`,
    `Project: ${payload.scope_id}`,
    `Failure class: ${payload.failure_class}`,
    `Confidence: ${confidence}`,
    `Repair decision: eligibility=${eligibility} allowed_action_ids=${allowedActionIds} reason=${reason}`,
    `Occurred at: ${payload.occurred_at}`,
    'Evidence:',
    evidenceBlock,
  ].join('\n');
}

/**
 * Payload published via the EventLedger under
 * {@link WORKFLOW_POSTMORTEM_RECORDED_EVENT} whenever the
 * `WorkflowFailurePostmortemListener` finishes processing a
 * failure event. Mirrors the `outcome` label contract the
 * prom-client counter uses (`success` / `skipped` / `failed`).
 *
 * `memory_segment_id` is omitted on `skipped` (no row was
 * written) and on `failed` (the write was attempted but did
 * not produce a persistable row). `reason` is populated on
 * `skipped` (kill switch off, dedup hit, run was non-failed)
 * and on `failed` (the error that blocked the writeback).
 */
export interface WorkflowPostmortemRecordedEvent {
  workflow_run_id: string;
  scope_id: string;
  failure_class: RepairPolicyClass;
  confidence: number;
  outcome: WorkflowPostmortemOutcome;
  memory_segment_id?: string;
  reason?: string;
  occurred_at: string;
}

/** Re-export the event-name constant so listeners / publishers can
 * import the constant and the payload type from the same module
 * surface (a frequent ergonomic ask on the existing autonomy event
 * surface — see `AUTONOMY_EVENT_NAMES` in
 * `autonomy-observability.types.ts`). */
export { WORKFLOW_POSTMORTEM_RECORDED_EVENT };

/**
 * Type-guard for `WorkflowPostmortemPayload`. Used by redrive /
 * backfill flows that re-construct a payload from the EventLedger
 * or an operator-driven seed file. The listener itself only ever
 * constructs well-formed payloads so it does not call this
 * guard — it is the boundary check for the cross-process paths.
 *
 * The guard is intentionally strict:
 *   - every required field is a non-empty string (or, for
 *     `confidence`, a finite number in [0, 1]);
 *   - `failure_class` is one of the `RepairPolicyClass` literals
 *     (uses the `REPAIR_POLICY_CLASSES` tuple as the source of
 *     truth so a new policy class is automatically picked up);
 *   - `repair_decision` is an object with a constrained
 *     `eligibility` value, an array of strings, and a string
 *     `reason`;
 *   - `occurred_at` matches the documented ISO-8601 regex.
 *
 * The regex is a pragmatic subset (no weekday, no fractional
 * sub-second beyond `.N+`, no `T` substitution, no whitespace
 * tolerance) — it accepts every ISO-8601 the codebase produces
 * (`new Date().toISOString()`) and rejects free-form strings
 * that would otherwise bypass the boundary check.
 */
export function isWorkflowPostmortemPayload(
  value: unknown,
): value is WorkflowPostmortemPayload {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;

  return (
    isNonEmptyString(candidate.workflow_run_id) &&
    isNonEmptyString(candidate.scope_id) &&
    isValidFailureClass(candidate.failure_class) &&
    isValidConfidence(candidate.confidence) &&
    isRepairDecision(candidate.repair_decision) &&
    typeof candidate.evidence_summary === 'string' &&
    isValidIsoTimestamp(candidate.occurred_at)
  );
}

const ISO_8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidFailureClass(value: unknown): value is RepairPolicyClass {
  return (
    typeof value === 'string' &&
    (REPAIR_POLICY_CLASSES as readonly string[]).includes(value)
  );
}

function isValidConfidence(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_8601_REGEX.test(value);
}

function isRepairDecision(
  value: unknown,
): value is WorkflowPostmortemPayload['repair_decision'] {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.eligibility !== 'string') {
    return false;
  }
  if (
    !REPAIR_POLICY_ELIGIBILITIES.includes(
      candidate.eligibility as WorkflowPostmortemPayload['repair_decision']['eligibility'],
    )
  ) {
    return false;
  }
  if (!Array.isArray(candidate.allowedRepairActionIds)) {
    return false;
  }
  if (
    !candidate.allowedRepairActionIds.every(
      (id) => typeof id === 'string' && id.length > 0,
    )
  ) {
    return false;
  }
  if (typeof candidate.reason !== 'string') {
    return false;
  }
  return true;
}
