import type {
  AutonomyEvidenceReference,
  AutonomyEvidenceReferenceKind,
  AutonomyNextStep,
  AutonomySummaryItem,
} from './autonomy-observability.types';
import type {
  LearningCandidateLifecycleSummaryInput,
  LearningLifecycleSummaryInput,
} from './autonomy-summary.projection.types';
import {
  readSafeEvidenceId,
  safePayloadEvidenceId,
  sanitizeSummary,
} from './autonomy-summary.safety';

export function summarizeLearningLifecycle(
  params: LearningLifecycleSummaryInput,
): AutonomySummaryItem {
  return {
    category: 'learning',
    title:
      params.eventName === 'memory.learning.run.started'
        ? 'Learning run started'
        : 'Learning run completed',
    status:
      params.eventName === 'memory.learning.run.started'
        ? 'in_progress'
        : 'succeeded',
    summary: learningLifecycleSummary(params),
    evidence: learningLifecycleEvidence(params),
    nextSteps: [],
  };
}

export function summarizeLearningCandidateLifecycle(
  params: LearningCandidateLifecycleSummaryInput,
): AutonomySummaryItem {
  return {
    category: 'learning',
    title: 'Learning candidate created',
    status: 'needs_review',
    summary: learningCandidateSummary(params.payload),
    evidence: learningCandidateEvidence(params),
    nextSteps: learningCandidateNextSteps(),
  };
}

function learningLifecycleSummary(
  params: LearningLifecycleSummaryInput,
): string {
  const trigger = readString(params.payload.trigger) ?? 'unknown';
  if (params.eventName === 'memory.learning.run.started') {
    return sanitizeSummary(`Learning run started. Trigger: ${trigger}.`);
  }

  const parts = [
    `Learning run completed. Trigger: ${trigger}`,
    `Scanned scopes: ${readNumber(params.payload.scannedScopes, 0)}`,
    `Ranked candidates: ${readNumber(params.payload.rankedCandidates, 0)}`,
    `Promoted candidates: ${readNumber(params.payload.promotedCandidates, 0)}`,
    `Skill proposals: ${readNumber(params.payload.createdSkillProposals, 0)}`,
  ];
  return sanitizeSummary(`${parts.join('. ')}.`);
}

function learningLifecycleEvidence(
  params: LearningLifecycleSummaryInput,
): AutonomyEvidenceReference[] {
  return [
    ...evidenceReference(
      'workflow_run',
      params.workflowRunId,
      'Workflow run associated with learning lifecycle.',
    ),
    ...evidenceReference(
      'event_ledger',
      params.eventLedgerId,
      'Learning lifecycle event ledger record.',
    ),
  ];
}

function learningCandidateSummary(payload: Record<string, unknown>): string {
  const scopeType = readString(payload.scope_type) ?? 'unknown_scope';
  const parts = [`Learning candidate created for ${scopeType}`];
  const confidence = readOptionalNumber(payload.confidence);
  const evidenceCount = readOptionalNumber(payload.evidence_count);
  const tagCount = readOptionalNumber(payload.tag_count);

  if (confidence !== undefined) parts.push(`Confidence: ${confidence}`);
  if (evidenceCount !== undefined) parts.push(`Evidence: ${evidenceCount}`);
  if (tagCount !== undefined) parts.push(`Tags: ${tagCount}`);

  return sanitizeSummary(`${parts.join('. ')}.`);
}

function learningCandidateEvidence(
  params: LearningCandidateLifecycleSummaryInput,
): AutonomyEvidenceReference[] {
  return [
    ...evidenceReference(
      'workflow_run',
      params.workflowRunId,
      'Workflow run associated with learning candidate.',
    ),
    ...evidenceReference(
      'event_ledger',
      params.eventLedgerId,
      'Learning candidate event ledger record.',
    ),
    ...evidenceReference(
      'workflow_job',
      params.jobId,
      'Job associated with learning candidate.',
    ),
    ...evidenceReference(
      'learning_candidate',
      safePayloadEvidenceId(readString(params.payload.candidate_id)),
      'Learning candidate awaiting review.',
    ),
  ];
}

function learningCandidateNextSteps(): AutonomyNextStep[] {
  return [{ label: 'Review learning candidate', severity: 'warning' }];
}

function evidenceReference(
  kind: AutonomyEvidenceReferenceKind,
  id: string | undefined,
  summary: string,
): AutonomyEvidenceReference[] {
  if (!id) return [];
  const safeId = readSafeEvidenceId(id);
  return [{ kind, ...(safeId ? { id: safeId } : {}), summary }];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
