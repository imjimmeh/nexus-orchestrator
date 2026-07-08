/**
 * Pure helpers for the retrospective findings completion path (EPIC-212
 * Phase-2 Task 6). No I/O, no NestJS — trivially unit-testable.
 *
 *   - `extractRawFindings` reads the analyst's `set_job_output` findings out of
 *     a completed run's `stateVariables`. `set_job_output` data lands at
 *     `jobs.<jobId>.output.<key>` (confirmed via `job-output-capability.provider`
 *     and `setStateVariableAtomic('…','jobs.<id>.output', …)`), so the findings
 *     live at `jobs.<analyzeJobId>.output.findings`.
 *   - `extractCorrelation` reads the original run id + scope the analyst run was
 *     launched with from `stateVariables.trigger`.
 *   - `parseValidFindings` validates each raw finding against the shared
 *     `@nexus/core` schema and drops anything invalid plus every `none` finding.
 *   - `filterFindingsByEvidence` drops fabricated `evidence_event_ids` (ids not
 *     present in the original run's ledger) and any finding left with zero real
 *     evidence ids.
 *
 * Scope-neutral: only the neutral `scopeId` / `scope_id` keys are read.
 */
import {
  retrospectiveFindingSchema,
  type RetrospectiveFinding,
} from '@nexus/core';
import type {
  EvidenceFilteredRetrospectiveFindings,
  ParsedRetrospectiveFindings,
  RejectedRetrospectiveFinding,
} from './retrospective-findings.types';

const NONE_KIND = 'none';
const FINDINGS_KEY = 'findings';

/** Result of resolving the analyst run's correlation keys. */
interface CorrelationResult {
  originalRunId: string | null;
  scopeId: string | null;
}

/**
 * Result of resolving the FU-16 dedup-widening identity threaded through the
 * analyst launch trigger by `RetrospectiveAnalysisService.analyze` (Task A2).
 */
interface IdentityResult {
  actingAgentProfileName: string | null;
  workflowName: string | null;
}

/**
 * Pull the raw, unvalidated findings array out of a completed analyst run's
 * state. Returns `[]` when no job carries a `findings` array.
 */
export function extractRawFindings(
  stateVariables: Record<string, unknown>,
): unknown[] {
  const jobs = readRecord(stateVariables.jobs);
  if (jobs === null) {
    return [];
  }
  for (const value of Object.values(jobs)) {
    const job = readRecord(value);
    const output = readRecord(job?.output);
    const findings = output?.[FINDINGS_KEY];
    if (Array.isArray(findings)) {
      return findings;
    }
  }
  return [];
}

/**
 * Resolve the original run id + scope the analyst run was launched with. The
 * analyst run's `trigger.workflow_run_id` is the ORIGINAL run under analysis
 * (the correlation key), not the analyst run's own id.
 */
export function extractCorrelation(
  stateVariables: Record<string, unknown>,
): CorrelationResult {
  const trigger = readRecord(stateVariables.trigger);
  return {
    originalRunId:
      readNonEmptyString(trigger?.workflow_run_id) ??
      readNonEmptyString(trigger?.chat_session_id),
    scopeId:
      readNonEmptyString(trigger?.scope_id) ??
      readNonEmptyString(trigger?.scopeId),
  };
}

/**
 * Resolve the FU-16 dedup-widening identity (acting agent-profile name +
 * workflow name) the analyst run was launched with (Task A2). Both are
 * resolved during dispatch and threaded onto the launch trigger purely so
 * the completion side can read them back here without a new DB lookup.
 */
export function extractIdentity(
  stateVariables: Record<string, unknown>,
): IdentityResult {
  const trigger = readRecord(stateVariables.trigger);
  return {
    actingAgentProfileName: readNonEmptyString(
      trigger?.acting_agent_profile_name,
    ),
    workflowName: readNonEmptyString(trigger?.workflow_name),
  };
}

/**
 * Validate each raw finding against the shared schema, dropping anything that
 * does not parse and every `none` finding (which carries no durable lesson).
 */
export function parseValidFindings(raw: unknown): RetrospectiveFinding[] {
  return parseFindingsWithOutcomes(raw).valid;
}

export function parseFindingsWithOutcomes(
  raw: unknown,
): ParsedRetrospectiveFindings {
  if (!Array.isArray(raw)) {
    return { valid: [], rejected: [] };
  }
  const valid: RetrospectiveFinding[] = [];
  const rejected: RejectedRetrospectiveFinding[] = [];
  raw.forEach((item, index) => {
    const parsed = retrospectiveFindingSchema.safeParse(normalizeFinding(item));
    if (!parsed.success) {
      rejected.push({
        index,
        reasonCode: 'schema_invalid',
        issues: parsed.error.issues.map((issue) => issue.message),
      });
      return;
    }
    if (parsed.data.kind === NONE_KIND) {
      rejected.push({
        index,
        reasonCode: 'kind_none',
        issues: ['Finding kind none carries no durable lesson.'],
      });
      return;
    }
    valid.push(parsed.data);
  });
  return { valid, rejected };
}

export function filterFindingsByEvidenceWithOutcomes(
  findings: RetrospectiveFinding[],
  validEventIds: ReadonlySet<string>,
): EvidenceFilteredRetrospectiveFindings {
  const valid: RetrospectiveFinding[] = [];
  const rejected: RejectedRetrospectiveFinding[] = [];
  findings.forEach((finding, index) => {
    const evidenceEventIds = finding.evidence_event_ids.filter((id) =>
      validEventIds.has(id),
    );
    if (evidenceEventIds.length === 0) {
      rejected.push({
        index,
        reasonCode: 'evidence_missing',
        issues: ['No cited evidence_event_ids were present in the run ledger.'],
      });
      return;
    }
    valid.push({
      ...finding,
      evidence_event_ids: evidenceEventIds,
    });
  });
  return { valid, rejected };
}

/**
 * Optional fields the analyst LLM (MiniMax-M3) is prone to filling with an
 * empty-string placeholder instead of omitting when it has nothing to say —
 * a known model quirk (see memory `project_refinement_impl_plan_nested_object_dropped`).
 * An empty string fails these fields' schema (`min(1)` string / non-string
 * `array`), which drops the ENTIRE finding — including a perfectly valid
 * `lesson` — over a field the analyst never needed to populate. Stripping an
 * empty-string placeholder back to `undefined` before validation lets the
 * finding through on its merits.
 */
const EMPTY_STRING_COERCIBLE_OPTIONAL_FIELDS = [
  'root_cause',
  'fix',
  'working_procedure',
  'scope_hint',
  'assignment_targets',
] as const;

function normalizeFinding(item: unknown): unknown {
  const record = readRecord(item);
  if (record === null) {
    return item;
  }
  const normalized: Record<string, unknown> = { ...record };
  if (typeof normalized.confidence_self === 'string') {
    const confidence = Number(normalized.confidence_self);
    if (Number.isFinite(confidence)) {
      normalized.confidence_self = confidence;
    }
  }
  const evidenceEventIds = normalized.evidence_event_ids;
  const evidenceRecord = readRecord(evidenceEventIds);
  if (evidenceRecord !== null && typeof evidenceRecord.item === 'string') {
    normalized.evidence_event_ids = [evidenceRecord.item];
  }
  for (const field of EMPTY_STRING_COERCIBLE_OPTIONAL_FIELDS) {
    if (normalized[field] === '') {
      normalized[field] = undefined;
    }
  }
  return normalized;
}

/**
 * Drop fabricated `evidence_event_ids` (ids absent from the original run's
 * ledger) and any finding left with zero real evidence ids. Every finding
 * passed here is already a non-`none` finding, so an empty evidence set means
 * the finding is unanchored and must be discarded.
 */
export function filterFindingsByEvidence(
  findings: RetrospectiveFinding[],
  validEventIds: ReadonlySet<string>,
): RetrospectiveFinding[] {
  return filterFindingsByEvidenceWithOutcomes(findings, validEventIds).valid;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
