import type { IMemorySegment, ImprovementEvidenceClass } from '@nexus/core';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { ImprovementProposal } from '../../improvement/database/entities/improvement-proposal.entity';
import type { ImprovementEvidencePayload } from '../../improvement/database/entities/improvement-proposal.entity.types';
import type {
  MemorySegmentMetadata,
  MemoryType,
} from '../memory-backend.types';
import type {
  BuildMetadataExtras,
  LearningPromotionPolicyDecision,
  SegmentDestination,
} from './learning-promotion.types';
import type { GovernanceDecision } from './promotion-governance-policy.types';
import { extractLessonAnchor } from '../signals/lesson-anchor.helper';

const AGENT_PREFERENCE_TARGET = 'agent_preference';
const AGENT_SCOPE_TYPE = 'agent';
const WORKFLOW_ROUTING_TARGET = 'workflow';
const WORKFLOW_SCOPE_TYPE = 'workflow';
const PREFERENCE_MEMORY_TYPE: MemoryType = 'preference';
const FACT_MEMORY_TYPE: MemoryType = 'fact';
const DEFAULT_SCOPE_ID = 'global';
const PROPOSAL_STATUS_PENDING = 'pending';
const PROPOSAL_TITLE_MAX_LENGTH = 200;
const SKILL_SLUG_MAX_LENGTH = 80;
const PROPOSAL_FALLBACK_SLUG = 'analyst-proposed-skill';
const IMPROVEMENT_KIND_SKILL_CREATE = 'skill_create' as const;
/** `candidate_type` the `StruggleDetectorService` stamps on failure-derived candidates. */
const STRUGGLE_CANDIDATE_TYPE = 'struggle';
/** Tag every struggle-derived candidate carries (see `StruggleDetectorService`). */
const STRUGGLE_TAG = 'struggle_backed';

/**
 * Build the write destination an auto-promotion resolves to from a candidate's
 * `routing_target` and the governance verdict. `agent_preference` lands on an
 * `agent`-scoped `preference` segment; `workflow` lands on a `workflow`-scoped
 * `fact` segment keyed by the workflow definition name (Epic C); every other
 * auto-promotable route (i.e. `project`) keeps today's project-scoped `fact`
 * shape. The governance state + probation window are carried through so the
 * caller can stamp them.
 */
export function resolveSegmentDestination(
  candidate: LearningCandidate,
  governance: GovernanceDecision,
): SegmentDestination {
  if (candidate.routing_target === AGENT_PREFERENCE_TARGET) {
    return {
      entityType: AGENT_SCOPE_TYPE,
      entityId: resolveAgentEntityId(candidate),
      memoryType: PREFERENCE_MEMORY_TYPE,
      governanceState: governance.governanceState,
      probationUntil: governance.probationUntil ?? null,
    };
  }

  if (candidate.routing_target === WORKFLOW_ROUTING_TARGET) {
    return {
      entityType: WORKFLOW_SCOPE_TYPE,
      entityId: resolveWorkflowEntityId(candidate),
      memoryType: FACT_MEMORY_TYPE,
      governanceState: governance.governanceState,
      probationUntil: governance.probationUntil ?? null,
    };
  }

  return {
    entityType: candidate.scope_type,
    entityId: candidate.scopeId ?? DEFAULT_SCOPE_ID,
    memoryType: FACT_MEMORY_TYPE,
    governanceState: governance.governanceState,
    probationUntil: governance.probationUntil ?? null,
  };
}

function resolveAgentEntityId(candidate: LearningCandidate): string {
  if (typeof candidate.scopeId === 'string' && candidate.scopeId.trim()) {
    return candidate.scopeId;
  }
  return (
    readProvenanceString(candidate, 'agentProfileName') ?? DEFAULT_SCOPE_ID
  );
}

function resolveWorkflowEntityId(candidate: LearningCandidate): string {
  if (typeof candidate.scopeId === 'string' && candidate.scopeId.trim()) {
    return candidate.scopeId;
  }
  return readProvenanceString(candidate, 'workflowName') ?? DEFAULT_SCOPE_ID;
}

/** True when a route maps to the skill proposal pipeline rather than a segment. */
export function isSkillRoute(routingTarget: string | null): boolean {
  return routingTarget === 'skill_new' || routingTarget === 'skill_patch';
}

/**
 * Build the pending `skill_create` improvement-proposal draft for a
 * skill-routed candidate. Mirrors the Task-7 retrospective-router proposal
 * shape so the downstream `create_skill` applier owns both producers
 * uniformly. Bypasses `ImprovementProposalService.submitProposal` (and its
 * `ImprovementGovernancePolicy`) deliberately — `PromotionGovernancePolicyService`
 * has already gated this route via `dispatchByRoute`, so a second governance
 * pass here would be double governance.
 */
export function buildSkillCreateProposalDraft(
  candidate: LearningCandidate,
): Partial<ImprovementProposal> {
  const lesson = readLesson(candidate);
  return {
    kind: IMPROVEMENT_KIND_SKILL_CREATE,
    status: PROPOSAL_STATUS_PENDING,
    payload: {
      target_skill_name: deriveSkillSlug(candidate.title || lesson),
      proposal_title: truncate(
        candidate.title || lesson,
        PROPOSAL_TITLE_MAX_LENGTH,
      ),
      proposal_summary: lesson || candidate.summary,
      patch_markdown: lesson || candidate.summary,
      assignment_targets: [],
    },
    evidence: buildSkillProposalEvidence(candidate),
    confidence: candidate.confidence,
    provenance: {
      learning_candidate_id: candidate.id,
      generated_from_run_id:
        readProvenanceString(candidate, 'workflowRunId') ?? null,
    },
  };
}

/**
 * Derive the `ImprovementEvidencePayload` for a skill-routed candidate.
 * `evidenceClass` is `struggle_backed` when the candidate itself was born
 * from a real failed→recovered struggle span (`candidate_type === 'struggle'`,
 * stamped by `StruggleDetectorService`, or the `struggle_backed` tag it
 * carries); every other candidate is `inference`. The originating
 * `workflowRunId` (when present in provenance) flows through as `runIds`.
 */
function buildSkillProposalEvidence(
  candidate: LearningCandidate,
): ImprovementEvidencePayload {
  const runId = readProvenanceString(candidate, 'workflowRunId');
  return {
    evidenceClass: deriveSkillProposalEvidenceClass(candidate),
    ...(runId ? { runIds: [runId] } : {}),
  };
}

function deriveSkillProposalEvidenceClass(
  candidate: LearningCandidate,
): ImprovementEvidenceClass {
  const isStruggleBacked =
    candidate.candidate_type === STRUGGLE_CANDIDATE_TYPE ||
    readStringArray(candidate.signals_json.tags).includes(STRUGGLE_TAG);
  return isStruggleBacked ? 'struggle_backed' : 'inference';
}

/** Derive a kebab-case skill slug from a source string. */
function deriveSkillSlug(source: string): string {
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SKILL_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : PROPOSAL_FALLBACK_SLUG;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
}

export function isPromotedCandidate(
  candidate: LearningCandidate,
): candidate is LearningCandidate & { promoted_memory_segment_id: string } {
  return (
    candidate.status === 'promoted' &&
    typeof candidate.promoted_memory_segment_id === 'string' &&
    candidate.promoted_memory_segment_id.trim().length > 0
  );
}

export function readPromotionPolicy(
  memorySegment: IMemorySegment,
): LearningPromotionPolicyDecision | null {
  const policy = memorySegment.metadata_json?.promotion_policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return null;
  }

  const record = policy as Record<string, unknown>;
  if (
    typeof record.approved !== 'boolean' ||
    typeof record.code !== 'string' ||
    typeof record.reason !== 'string' ||
    typeof record.policyName !== 'string' ||
    typeof record.policyVersion !== 'string' ||
    typeof record.minimumConfidence !== 'number' ||
    typeof record.confidence !== 'number'
  ) {
    return null;
  }

  return record as unknown as LearningPromotionPolicyDecision;
}

export function toAlreadyPromotedDecision(
  candidate: LearningCandidate,
): LearningPromotionPolicyDecision {
  return {
    approved: true,
    code: 'already_promoted',
    reason: 'Learning candidate has already been promoted.',
    policyName: 'auto-learning-promotion',
    policyVersion: '1',
    minimumConfidence: 0,
    confidence: candidate.confidence,
  };
}

export function buildMetadata(
  candidate: LearningCandidate,
  decision: LearningPromotionPolicyDecision,
  extras: BuildMetadataExtras = {},
): MemorySegmentMetadata {
  const requestedBy = normalizeRequestedBy(extras.requestedBy);
  const metadata: MemorySegmentMetadata = {
    source: 'learning_candidate',
    learning_candidate_id: candidate.id,
    scope_type: candidate.scope_type,
    scope_id: candidate.scopeId,
    workflow_run_id: readProvenanceString(candidate, 'workflowRunId'),
    job_id: readProvenanceString(candidate, 'jobId'),
    agent_profile_name: readProvenanceString(candidate, 'agentProfileName'),
    ...(requestedBy ? { requested_by: requestedBy } : {}),
    confidence: candidate.confidence,
    tags: readStringArray(candidate.signals_json.tags),
    evidence: readEvidence(candidate.signals_json.evidence),
    promotion_policy: decision,
    ...(extras.routingTarget ? { routing_target: extras.routingTarget } : {}),
    ...(extras.probationUntil
      ? { probation_until: extras.probationUntil.toISOString() }
      : {}),
  };
  return { ...metadata, ...buildDriftReference(metadata) };
}

/**
 * Attach the additive top-level `filePath` drift reference (EPIC-212
 * Phase-3 Task 4) when a promoted lesson is code-anchored.
 *
 * The reference is derived from the Task-1 {@link extractLessonAnchor}
 * source-of-truth (it scans the just-built `evidence[]` / direct keys
 * for a repo path) and written in the EXACT shape the
 * {@link import('../memory-drift-reference.parser').MemoryDriftReferenceParser}
 * classifies as `kind:'file'` (a top-level `filePath` string). This is
 * the single key BOTH the drift detector's parser and the anchor helper
 * read, so the existing `MemoryDriftDetectionService` starts catching
 * promoted lessons whose referenced file later disappears — without any
 * new drift-checker logic.
 *
 * A non-code lesson (no derivable path) yields an empty object, so the
 * promotion metadata is byte-identical to the pre-Task-4 shape. Schema
 * (`schemaRef`) and API (`apiEndpoint`) drift kinds are a carry-forward:
 * the anchor helper only reliably derives a file path today. Fail-soft —
 * `extractLessonAnchor` never throws and the parser self-guards against a
 * non-relative / malformed path.
 */
function buildDriftReference(
  metadata: MemorySegmentMetadata,
): { filePath: string } | Record<string, never> {
  const anchor = extractLessonAnchor(metadata);
  if (anchor.path) {
    return { filePath: anchor.path };
  }
  return {};
}

export function readLesson(candidate: LearningCandidate): string {
  return (
    readNonBlankString(candidate.signals_json.lesson) ??
    readNonBlankString(candidate.summary) ??
    ''
  );
}

export function readProvenanceString(
  candidate: LearningCandidate,
  key: string,
): string | undefined {
  const provenance = candidate.signals_json.provenance;
  if (
    !provenance ||
    typeof provenance !== 'object' ||
    Array.isArray(provenance)
  ) {
    return undefined;
  }

  const value = (provenance as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function readEvidence(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeRequestedBy(
  value: string | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export function toEventPolicy(decision: LearningPromotionPolicyDecision) {
  return {
    approved: decision.approved,
    code: decision.code,
    policyName: decision.policyName,
    policyVersion: decision.policyVersion,
    minimumConfidence: decision.minimumConfidence,
    confidence: decision.confidence,
  };
}
