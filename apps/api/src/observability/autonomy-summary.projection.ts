import type {
  AutonomyEvidenceReference,
  AutonomyEvidenceReferenceKind,
  AutonomyNextStep,
  AutonomySummaryItem,
} from './autonomy-observability.types';
import type {
  FailedDeliverableInput,
  FailureClassificationSummaryInput,
  NestedProposalSourceEvidenceInput,
  ProposalSourceEvidenceInput,
  QaDecisionSummaryInput,
  RepairDelegationSummaryInput,
  RuntimeFeedbackSummaryInput,
  SkillProposalDiagnosticsInput,
  SkillProposalStatus,
  SourceEvidenceInput,
} from './autonomy-summary.projection.types';
import {
  readSafeEvidenceId,
  safePayloadEvidenceId,
  sanitizeSummary,
} from './autonomy-summary.safety';

const RUNTIME_FEEDBACK_SIGNAL_TYPE_PATTERN =
  /^(tool_contract_repair|failure_classification|repair_outcome|workflow_anomaly|review_qa_finding|memory_miss)$/;

export function summarizeSkillProposalDiagnostics(
  proposal: SkillProposalDiagnosticsInput,
): AutonomySummaryItem {
  const subject = sanitizeSummary(
    proposal.targetSkill ?? proposal.title ?? 'skill proposal',
  );
  const evidence: AutonomyEvidenceReference[] = [
    {
      kind: 'skill_proposal',
      id: readSafeEvidenceId(proposal.id),
      summary: sanitizeSummary(`Skill proposal for ${subject}.`),
    },
    ...sanitizeSourceEvidence(proposal.diagnostics?.source_evidence),
  ];

  return {
    category: 'learning',
    title: `Skill proposal: ${subject}`,
    status: mapSkillProposalStatus(proposal.status),
    summary: sanitizeSummary(
      proposal.rationale ??
        proposal.summary ??
        proposal.rejectionReason ??
        'Skill proposal awaiting review.',
    ),
    evidence,
    nextSteps: skillProposalNextSteps(proposal.status),
  };
}

export function summarizeQaDecision(
  params: QaDecisionSummaryInput,
): AutonomySummaryItem {
  const evidence: AutonomyEvidenceReference[] = [];
  if (params.contextId) {
    evidence.push({
      kind: 'context_item',
      id: params.contextId,
      summary: `QA decision for context ${params.contextId}.`,
    });
  }
  if (params.workflowRunId) {
    evidence.push({
      kind: 'workflow_run',
      id: params.workflowRunId,
      summary: 'Workflow run reviewed by QA.',
    });
  }
  evidence.push(...failedDeliverableEvidence(params.failedDeliverables));

  return {
    category: 'review',
    title: `QA decision: ${params.decision}`,
    status: params.decision === 'accept' ? 'succeeded' : 'denied',
    summary: sanitizeSummary(
      params.feedback
        ? `Feedback: ${params.feedback}`
        : `QA decision ${params.decision}.`,
    ),
    evidence,
    nextSteps:
      params.decision === 'reject'
        ? [
            {
              label: 'Address failed deliverables before resubmitting',
              severity: 'warning',
            },
          ]
        : [],
  };
}

export function summarizeFailureClassification(
  decision: FailureClassificationSummaryInput,
): AutonomySummaryItem {
  return {
    category: 'failure_classification',
    title: `Failure classification: ${decision.class}`,
    status: mapFailureClassificationStatus(decision.eligibility),
    summary: sanitizeSummary(
      `Class: ${decision.class}. Confidence: ${decision.confidence}. Reason: ${decision.reason}`,
    ),
    evidence: sanitizeEvidenceReferences(decision.evidenceReferences ?? []),
    nextSteps: failureClassificationNextSteps(decision.eligibility),
  };
}

export function summarizeRepairDelegation(
  params: RepairDelegationSummaryInput,
): AutonomySummaryItem {
  const policyAction = sanitizeSummary(params.policyAction);
  const summaryParts = [
    `Policy action: ${policyAction}`,
    `Execution path: ${params.executionPath}`,
    `Attempt: ${params.attempt}`,
  ];
  if (params.message) {
    summaryParts.push(`Message: ${params.message}`);
  }

  return {
    category: 'repair',
    title: `Repair delegation: ${policyAction}`,
    status: mapRepairDelegationStatus(params.status),
    summary:
      policyAction === '[REDACTED]'
        ? '[REDACTED]'
        : sanitizeSummary(summaryParts.join('. ')),
    evidence: repairDelegationEvidence(params),
    nextSteps: repairDelegationNextSteps(params.status),
  };
}

export function summarizeRuntimeFeedback(
  params: RuntimeFeedbackSummaryInput,
): AutonomySummaryItem {
  const signalType = runtimeFeedbackSignalType(
    params.payload.signal_type ?? 'unknown_signal',
  );

  return {
    category: 'learning',
    title: `Runtime feedback: ${signalType}`,
    status: mapRuntimeFeedbackStatus(params),
    summary: runtimeFeedbackSummary(params, signalType),
    evidence: runtimeFeedbackEvidence(params),
    nextSteps: runtimeFeedbackNextSteps(params),
  };
}

function runtimeFeedbackSignalType(value: string): string {
  if (sanitizeSummary(value) === '[REDACTED]') return '[REDACTED]';
  return RUNTIME_FEEDBACK_SIGNAL_TYPE_PATTERN.test(value)
    ? value
    : 'unknown_signal';
}

function sanitizeEvidenceReferences(
  evidence: AutonomyEvidenceReference[],
): AutonomyEvidenceReference[] {
  return evidence.map((reference) => ({
    kind: reference.kind,
    id: reference.id,
    summary: sanitizeSummary(reference.summary),
  }));
}

function sanitizeSourceEvidence(
  evidence: SourceEvidenceInput[] | ProposalSourceEvidenceInput | undefined,
): AutonomyEvidenceReference[] {
  if (!evidence) return [];
  if (!Array.isArray(evidence)) return sanitizeNestedProposalEvidence(evidence);

  return evidence.flatMap((reference) => {
    if (!isEvidenceKind(reference.kind)) {
      return [];
    }
    return [
      {
        kind: reference.kind,
        id: readSafeEvidenceId(reference.id),
        summary: sanitizeSummary(reference.summary ?? 'Source evidence.'),
      },
    ];
  });
}

function sanitizeNestedProposalEvidence(
  evidence: ProposalSourceEvidenceInput,
): AutonomyEvidenceReference[] {
  const references: AutonomyEvidenceReference[] = [];
  if (evidence.learning_candidate_id) {
    references.push({
      kind: 'learning_candidate',
      id: readSafeEvidenceId(evidence.learning_candidate_id),
      summary: 'Learning candidate for proposal source evidence.',
    });
  }

  for (const source of evidence.source_evidence ?? []) {
    if (source.sessionTreeId) {
      references.push({
        kind: 'session_tree',
        id: readSafeEvidenceId(source.sessionTreeId),
        summary: sanitizeSummary(sourceEvidenceSummary(source)),
      });
    }
    if (source.workflowRunId) {
      references.push({
        kind: 'workflow_run',
        id: readSafeEvidenceId(source.workflowRunId),
        summary: sanitizeSummary(sourceEvidenceSummary(source)),
      });
    }
  }

  return references;
}

function sourceEvidenceSummary(
  source: NestedProposalSourceEvidenceInput,
): string {
  const sourceType = source.sourceType ?? 'source';
  const eventCount =
    typeof source.eventCount === 'number'
      ? ` with ${source.eventCount} events`
      : '';
  const truncated = source.truncated ? ' (truncated)' : '';
  return `${sourceType} source evidence${eventCount}${truncated}.`;
}

function failedDeliverableEvidence(
  deliverables: FailedDeliverableInput[] = [],
): AutonomyEvidenceReference[] {
  return deliverables.map((deliverable, index) => ({
    kind: 'event_ledger',
    id:
      deliverable.deliverable_id ??
      deliverable.name ??
      `failed-deliverable-${index + 1}`,
    summary: failedDeliverableSummary(deliverable),
  }));
}

function failedDeliverableSummary(deliverable: FailedDeliverableInput): string {
  if (deliverable.summary) {
    return sanitizeSummary(deliverable.summary);
  }

  if (
    deliverable.deliverable_id &&
    deliverable.failure_type &&
    deliverable.details
  ) {
    const affectedFiles = (deliverable.affected_files ?? []).slice(0, 2);
    const filesSummary = affectedFiles.length
      ? ` Affected files: ${affectedFiles.join(', ')}.`
      : '';
    return sanitizeSummary(
      `Deliverable ${deliverable.deliverable_id} failed with ${deliverable.failure_type}. Details: ${stripTrailingPeriod(deliverable.details)}.${filesSummary}`,
    );
  }

  return 'Failed deliverable.';
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/\.+$/, '');
}

function repairDelegationEvidence(
  params: RepairDelegationSummaryInput,
): AutonomyEvidenceReference[] {
  const references: Array<
    [AutonomyEvidenceReferenceKind, string | undefined, string]
  > = [
    ['workflow_run', params.workflowRunId, 'Original workflow run.'],
    ['job_output', params.failedJobId, 'Failed job output.'],
    [
      'doctor_repair_history',
      params.doctorRepairAttemptId,
      'Doctor repair attempt history.',
    ],
    ['workflow_run', params.repairWorkflowRunId, 'Repair workflow run.'],
  ];

  return references.flatMap(([kind, id, summary]) =>
    evidenceReference(kind, id, summary),
  );
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

function isEvidenceKind(
  kind: string | undefined,
): kind is AutonomyEvidenceReferenceKind {
  return (
    kind === 'event_ledger' ||
    kind === 'workflow_event' ||
    kind === 'learning_candidate' ||
    kind === 'skill_proposal' ||
    kind === 'session_tree' ||
    kind === 'workflow_run' ||
    kind === 'workflow_job' ||
    kind === 'job_output' ||
    kind === 'runtime_diagnostic' ||
    kind === 'doctor_repair_history' ||
    kind === 'context_item'
  );
}

function mapRuntimeFeedbackStatus(
  params: RuntimeFeedbackSummaryInput,
): AutonomySummaryItem['status'] {
  if (params.eventName === 'runtime.feedback.signal_skipped') {
    return 'denied';
  }
  return params.eventName === 'runtime.feedback.candidate_created' ||
    params.payload.candidate_id
    ? 'needs_review'
    : 'succeeded';
}

function runtimeFeedbackSummary(
  params: RuntimeFeedbackSummaryInput,
  signalType: string,
): string {
  switch (params.eventName) {
    case 'runtime.feedback.candidate_created':
      if (sanitizeSummary(signalType) === '[REDACTED]') return '[REDACTED]';
      return sanitizeSummary(
        `Runtime feedback candidate created for ${signalType}.`,
      );
    case 'runtime.feedback.signal_skipped': {
      const reason = params.payload.skipped_reason ?? 'unknown';
      return sanitizeSummary(
        `Runtime feedback signal skipped. Reason: ${reason}.`,
      );
    }
    case 'runtime.feedback.signal_ingested': {
      if (sanitizeSummary(signalType) === '[REDACTED]') return '[REDACTED]';
      const occurrences =
        typeof params.payload.occurrence_count === 'number'
          ? ` Occurrences: ${params.payload.occurrence_count}.`
          : '';
      return sanitizeSummary(
        `Runtime feedback signal ingested for ${signalType}.${occurrences}`,
      );
    }
  }
}

function runtimeFeedbackEvidence(
  params: RuntimeFeedbackSummaryInput,
): AutonomyEvidenceReference[] {
  return [
    ...evidenceReference(
      'workflow_run',
      params.workflowRunId,
      'Workflow run associated with runtime feedback.',
    ),
    ...evidenceReference(
      'event_ledger',
      params.eventLedgerId,
      'Runtime feedback event ledger record.',
    ),
    ...evidenceReference(
      'workflow_job',
      params.jobId,
      'Job associated with runtime feedback.',
    ),
    ...evidenceReference(
      'learning_candidate',
      safePayloadEvidenceId(params.payload.candidate_id),
      'Runtime feedback learning candidate.',
    ),
    ...evidenceReference(
      'runtime_diagnostic',
      safePayloadEvidenceId(params.payload.group_id),
      'Runtime feedback signal group.',
    ),
  ];
}

function runtimeFeedbackNextSteps(
  params: RuntimeFeedbackSummaryInput,
): AutonomyNextStep[] {
  if (params.eventName === 'runtime.feedback.signal_skipped') {
    return [
      {
        label: 'Review skipped runtime feedback policy thresholds',
        severity: 'info',
      },
    ];
  }
  return params.eventName === 'runtime.feedback.candidate_created' ||
    params.payload.candidate_id
    ? [
        {
          label: 'Review runtime feedback learning candidate',
          severity: 'warning',
        },
      ]
    : [];
}

function mapSkillProposalStatus(
  status: SkillProposalStatus,
): AutonomySummaryItem['status'] {
  if (status === 'pending') return 'needs_review';
  if (status === 'approved') return 'succeeded';
  return status === 'rejected' ? 'denied' : 'failed';
}

function skillProposalNextSteps(
  status: SkillProposalStatus,
): AutonomyNextStep[] {
  switch (status) {
    case 'pending':
      return [
        { label: 'Preview patch', severity: 'info' },
        { label: 'Approve or reject with a reason', severity: 'warning' },
      ];
    case 'failed':
      return [
        {
          label: 'Review validation warnings before retrying approval',
          severity: 'error',
        },
      ];
    case 'rejected':
      return [
        {
          label: 'Use rejection reason to tune proposal generation',
          severity: 'info',
        },
      ];
    case 'approved':
      return [];
  }
}

function mapFailureClassificationStatus(
  eligibility: FailureClassificationSummaryInput['eligibility'],
): AutonomySummaryItem['status'] {
  if (eligibility === 'allow') return 'succeeded';
  return eligibility === 'deny' ? 'denied' : 'needs_review';
}

function failureClassificationNextSteps(
  eligibility: FailureClassificationSummaryInput['eligibility'],
): AutonomyNextStep[] {
  switch (eligibility) {
    case 'allow':
      return [
        {
          label: 'Review allowed repair actions before dispatch',
          severity: 'info',
        },
      ];
    case 'deny':
      return [{ label: 'Escalate to a human operator', severity: 'error' }];
    case 'human_required':
      return [
        {
          label: 'Review evidence and choose a manual repair path',
          severity: 'warning',
        },
      ];
  }
}

function mapRepairDelegationStatus(
  status: RepairDelegationSummaryInput['status'],
): AutonomySummaryItem['status'] {
  if (status === 'dispatched') return 'in_progress';
  if (status === 'succeeded' || status === 'failed') return status;
  return 'denied';
}

function repairDelegationNextSteps(
  status: RepairDelegationSummaryInput['status'],
): AutonomyNextStep[] {
  switch (status) {
    case 'failed':
      return [
        {
          label: 'Inspect repair output and retry manually if safe',
          severity: 'error',
        },
      ];
    case 'retry_limit_exceeded':
      return [
        {
          label: 'Escalate after retry budget is exhausted',
          severity: 'error',
        },
      ];
    case 'dispatched':
    case 'succeeded':
    case 'denied':
      return [];
  }
}
