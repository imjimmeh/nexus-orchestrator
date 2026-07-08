import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import { readString } from '@nexus/core';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import type { AutonomySummaryItem } from '../../observability/autonomy-observability.types';
import {
  summarizeLearningCandidateLifecycle,
  summarizeLearningLifecycle,
} from '../../observability/autonomy-learning-summary.projection';
import { summarizeSkillProposalDiagnostics } from '../../observability/autonomy-summary.projection';
import type {
  LearningLifecycleEventName,
  ProposalSourceEvidenceInput,
  SkillProposalDiagnosticsInput,
  SkillProposalStatus,
  SourceEvidenceInput,
} from '../../observability/autonomy-summary.projection.types';

export function projectLearningAutonomyLedgerEvent(
  workflowRunId: string,
  event: EventLedger,
): AutonomySummaryItem[] {
  const learningLifecycleEventName = readLearningLifecycleEventName(
    event.event_name,
  );
  if (learningLifecycleEventName) {
    return withOccurredAt(
      summarizeLearningLifecycle({
        eventName: learningLifecycleEventName,
        eventLedgerId: event.id,
        workflowRunId,
        payload: readRecord(event.payload) ?? {},
      }),
      event,
    );
  }

  if (event.event_name === AUTONOMY_EVENT_NAMES.learningCandidateCreated) {
    return withOccurredAt(
      summarizeLearningCandidateLifecycle({
        eventName: event.event_name,
        eventLedgerId: event.id,
        workflowRunId,
        jobId: event.job_id,
        payload: readRecord(event.payload) ?? {},
      }),
      event,
    );
  }

  const skillProposal = readSkillProposalDiagnostics(event);
  return skillProposal
    ? withOccurredAt(summarizeSkillProposalDiagnostics(skillProposal), event)
    : [];
}

function withOccurredAt(
  item: AutonomySummaryItem,
  event: EventLedger,
): AutonomySummaryItem[] {
  return [{ ...item, occurredAt: event.occurred_at.toISOString() }];
}

function readLearningLifecycleEventName(
  eventName: string,
): LearningLifecycleEventName | null {
  switch (eventName) {
    case AUTONOMY_EVENT_NAMES.learningRunStarted:
    case AUTONOMY_EVENT_NAMES.learningRunCompleted:
      return eventName;
    default:
      return null;
  }
}

function readSkillProposalDiagnostics(
  event: EventLedger,
): SkillProposalDiagnosticsInput | null {
  const status = readSkillProposalEventStatus(event.event_name);
  if (!status) return null;

  const payload = readRecord(event.payload) ?? {};
  const diagnostics = readRecord(payload.diagnostics);

  return {
    id: readString(payload.proposalId) ?? readString(payload.id),
    status,
    targetSkill:
      readString(payload.targetSkill) ?? readString(payload.target_skill_name),
    title: readString(payload.title) ?? readString(payload.proposal_title),
    rationale: readString(payload.rationale),
    summary:
      readString(payload.summary) ?? readString(payload.proposal_summary),
    rejectionReason:
      readString(payload.rejectionReason) ??
      readString(payload.rejection_reason),
    diagnostics: readSkillProposalSourceEvidence(diagnostics),
  };
}

function readSkillProposalSourceEvidence(
  diagnostics: Record<string, unknown> | null,
): SkillProposalDiagnosticsInput['diagnostics'] | undefined {
  if (!diagnostics) return undefined;

  const sourceEvidence = readSourceEvidence(diagnostics.source_evidence);
  return sourceEvidence ? { source_evidence: sourceEvidence } : undefined;
}

function readSourceEvidence(
  value: unknown,
): SourceEvidenceInput[] | ProposalSourceEvidenceInput | undefined {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const record = readRecord(entry);
      if (!record) return [];
      return [
        {
          kind: readString(record.kind),
          id: readString(record.id),
          summary: readString(record.summary),
        },
      ];
    });
  }

  const record = readRecord(value);
  if (!record) return undefined;

  return {
    learning_candidate_id: readString(record.learning_candidate_id) ?? null,
    source_evidence: readNestedProposalSourceEvidence(record.source_evidence),
  };
}

function readNestedProposalSourceEvidence(
  value: unknown,
): ProposalSourceEvidenceInput['source_evidence'] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const record = readRecord(entry);
    if (!record) return [];
    return [
      {
        sourceType: readString(record.sourceType),
        sessionTreeId: readString(record.sessionTreeId),
        workflowRunId: readString(record.workflowRunId) ?? null,
        chatSessionId: readString(record.chatSessionId) ?? null,
        eventCount: readOptionalNumber(record.eventCount),
        truncated: record.truncated === true,
      },
    ];
  });
}

function readSkillProposalEventStatus(
  eventName: string,
): SkillProposalStatus | null {
  switch (eventName) {
    case AUTONOMY_EVENT_NAMES.skillProposalCreated:
      return 'pending';
    case AUTONOMY_EVENT_NAMES.skillProposalApproved:
      return 'approved';
    case AUTONOMY_EVENT_NAMES.skillProposalRejected:
      return 'rejected';
    case AUTONOMY_EVENT_NAMES.skillProposalApprovalFailed:
      return 'failed';
    default:
      return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
