import { Injectable } from '@nestjs/common';
import { readString } from '@nexus/core';
import { EventLedgerService } from '../../observability/event-ledger.service';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import {
  AUTONOMY_EVENT_CATEGORIES,
  AUTONOMY_EVENT_NAMES,
  type AutonomyEventCategory,
  type AutonomyEvidenceReference,
  type AutonomyEvidenceReferenceKind,
  type AutonomySummaryItem,
} from '../../observability/autonomy-observability.types';
import {
  summarizeFailureClassification,
  summarizeRepairDelegation,
  summarizeRuntimeFeedback,
} from '../../observability/autonomy-summary.projection';
import { readSafeEvidenceId } from '../../observability/autonomy-summary.safety';
import type {
  RuntimeFeedbackEventName,
  RuntimeFeedbackPayloadInput,
} from '../../observability/autonomy-summary.projection.types';
import { StateManagerService } from '../state-manager.service';
import {
  REPAIR_DELEGATION_STATE_KEY,
  type RepairDelegationExecutionPath,
  type RepairDelegationStatus,
} from '../workflow-repair/repair-delegation.types';
import {
  REPAIR_POLICY_CLASSES,
  type RepairEligibility,
  type RepairPolicyClass,
} from '../workflow-repair/failure-classification.types';
import type { WorkflowRunAutonomyDiagnostics } from './workflow-run-autonomy-diagnostics.service.types';
import { projectLearningAutonomyLedgerEvent } from './workflow-run-learning-autonomy-diagnostics.projection';

const AUTONOMY_EVENT_QUERIES = [
  {
    domain: 'workflow',
    eventName: AUTONOMY_EVENT_NAMES.failureClassificationDecided,
  },
  {
    domain: 'workflow',
    eventName: AUTONOMY_EVENT_NAMES.repairDelegationDecided,
  },
  {
    domain: 'workflow',
    eventName: AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested,
  },
  {
    domain: 'workflow',
    eventName: AUTONOMY_EVENT_NAMES.repairDelegationSysadminRequested,
  },
  {
    domain: 'workflow',
    eventName: AUTONOMY_EVENT_NAMES.repairDelegationCompleted,
  },
  {
    domain: 'memory',
    eventName: AUTONOMY_EVENT_NAMES.runtimeFeedbackSignalIngested,
  },
  {
    domain: 'memory',
    eventName: AUTONOMY_EVENT_NAMES.runtimeFeedbackSignalSkipped,
  },
  {
    domain: 'memory',
    eventName: AUTONOMY_EVENT_NAMES.runtimeFeedbackCandidateCreated,
  },
  { domain: 'memory', eventName: AUTONOMY_EVENT_NAMES.learningRunStarted },
  { domain: 'memory', eventName: AUTONOMY_EVENT_NAMES.learningRunCompleted },
  {
    domain: 'memory',
    eventName: AUTONOMY_EVENT_NAMES.learningCandidateCreated,
  },
  { domain: 'memory', eventName: AUTONOMY_EVENT_NAMES.skillProposalCreated },
  { domain: 'memory', eventName: AUTONOMY_EVENT_NAMES.skillProposalApproved },
  { domain: 'memory', eventName: AUTONOMY_EVENT_NAMES.skillProposalRejected },
  {
    domain: 'memory',
    eventName: AUTONOMY_EVENT_NAMES.skillProposalApprovalFailed,
  },
] as const;

@Injectable()
export class WorkflowRunAutonomyDiagnosticsService {
  constructor(
    private readonly eventLedger: EventLedgerService,
    private readonly stateManager: StateManagerService,
  ) {}

  async getRunAutonomyDiagnostics(
    workflowRunId: string,
  ): Promise<WorkflowRunAutonomyDiagnostics> {
    const [eventResults, repairState] = await Promise.all([
      Promise.all(
        AUTONOMY_EVENT_QUERIES.map((query) =>
          this.eventLedger.query({
            ...query,
            workflowRunId,
            limit: 50,
            offset: 0,
          }),
        ),
      ),
      this.stateManager.getVariable(workflowRunId, REPAIR_DELEGATION_STATE_KEY),
    ]);
    const events = eventResults.flatMap((result) => result.events);

    const items = events.flatMap((event) =>
      this.projectLedgerEvent(workflowRunId, event),
    );
    const latestRepairState = this.projectLatestRepairState(
      workflowRunId,
      repairState,
    );

    if (latestRepairState) {
      items.push(latestRepairState);
    }

    const sortedItems = items.sort((a, b) =>
      (a.occurredAt ?? '').localeCompare(b.occurredAt ?? ''),
    );

    return {
      items: sortedItems,
      summary: summarizeDiagnostics(sortedItems),
    };
  }

  private projectLedgerEvent(
    workflowRunId: string,
    event: EventLedger,
  ): AutonomySummaryItem[] {
    if (
      event.event_name === AUTONOMY_EVENT_NAMES.failureClassificationDecided
    ) {
      const decision = readRecord(event.payload?.decision);
      if (!decision) {
        return [];
      }

      const item = summarizeFailureClassification({
        class: readRepairPolicyClass(decision.class),
        confidence: readNumber(decision.confidence, 0),
        eligibility: readRepairEligibility(decision.eligibility),
        reason:
          readString(decision.reason) ?? 'Failure classification decided.',
        evidenceReferences: readEvidenceReferences(decision.evidenceReferences),
      });

      return [{ ...item, occurredAt: event.occurred_at.toISOString() }];
    }

    if (event.event_name === AUTONOMY_EVENT_NAMES.repairDelegationDecided) {
      const payload = readRecord(event.payload);
      if (!payload) {
        return [];
      }

      const item = summarizeRepairDelegation({
        status: readRepairDelegationStatus(payload.status),
        policyAction: readString(payload.policyActionId) ?? 'unknown',
        executionPath: readRepairExecutionPath(payload.executionPath),
        attempt: readNumber(payload.attempt, 0),
        message: event.error_message,
        workflowRunId,
        failedJobId: event.job_id,
      });

      return [{ ...item, occurredAt: event.occurred_at.toISOString() }];
    }

    if (isRepairDelegationLifecycleEvent(event.event_name)) {
      const payload = readRecord(event.payload);
      if (!payload) {
        return [];
      }

      const item = summarizeRepairDelegation({
        status: readRepairLifecycleStatus(event, payload),
        policyAction: readString(payload.policyActionId) ?? 'unknown',
        executionPath: readRepairLifecycleExecutionPath(event, payload),
        attempt: readNumber(payload.attempt, 0),
        message: event.error_message ?? repairLifecycleDefaultMessage(event),
        workflowRunId,
        failedJobId: readString(payload.failedJobId) ?? event.job_id,
        doctorRepairAttemptId: readString(payload.doctorRepairAttemptId),
        repairWorkflowRunId: readString(payload.repairWorkflowRunId),
      });

      return [{ ...item, occurredAt: event.occurred_at.toISOString() }];
    }

    const runtimeFeedbackEventName = readRuntimeFeedbackEventName(
      event.event_name,
    );
    if (runtimeFeedbackEventName) {
      const item = summarizeRuntimeFeedback({
        eventName: runtimeFeedbackEventName,
        eventLedgerId: event.id,
        workflowRunId,
        jobId: event.job_id,
        payload: readRuntimeFeedbackPayload(event.payload),
      });

      return [{ ...item, occurredAt: event.occurred_at.toISOString() }];
    }

    return projectLearningAutonomyLedgerEvent(workflowRunId, event);
  }

  private projectLatestRepairState(
    workflowRunId: string,
    state: unknown,
  ): AutonomySummaryItem | null {
    const stateRecord = readRecord(state);
    if (!stateRecord) {
      return null;
    }

    const latest = readRecord(stateRecord.latest);
    if (!latest) {
      return null;
    }

    return {
      ...summarizeRepairDelegation({
        status: readRepairDelegationStatus(latest.status),
        policyAction: readString(latest.policyActionId) ?? 'unknown',
        executionPath: readRepairExecutionPath(latest.executionPath),
        attempt: readNumber(latest.attempt, 0),
        message: readString(latest.message),
        workflowRunId,
        failedJobId: readString(latest.failedJobId),
        doctorRepairAttemptId: readString(latest.doctorRepairAttemptId),
        repairWorkflowRunId: readString(latest.repairWorkflowRunId),
      }),
      occurredAt: readString(latest.recordedAt),
    };
  }
}

function summarizeDiagnostics(
  items: AutonomySummaryItem[],
): NonNullable<WorkflowRunAutonomyDiagnostics['summary']> {
  const byCategory = Object.fromEntries(
    AUTONOMY_EVENT_CATEGORIES.map((category) => [category, 0]),
  ) as Record<AutonomyEventCategory, number>;

  for (const item of items) {
    byCategory[item.category] += 1;
  }

  const latestItem = items[items.length - 1];
  if (!latestItem) {
    return { total: items.length, byCategory };
  }

  return {
    total: items.length,
    byCategory,
    latestStatus: latestItem.status,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function readRepairPolicyClass(value: unknown): RepairPolicyClass {
  return typeof value === 'string' &&
    REPAIR_POLICY_CLASSES.includes(value as RepairPolicyClass)
    ? (value as RepairPolicyClass)
    : 'ambiguous_failure';
}

function readRepairEligibility(value: unknown): RepairEligibility {
  return value === 'allow' || value === 'deny' || value === 'human_required'
    ? value
    : 'human_required';
}

function readRepairDelegationStatus(value: unknown): RepairDelegationStatus {
  if (
    value === 'denied' ||
    value === 'dispatched' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'retry_limit_exceeded'
  ) {
    return value;
  }
  return 'failed';
}

function readRepairLifecycleStatus(
  event: EventLedger,
  payload: Record<string, unknown>,
): RepairDelegationStatus {
  if (
    event.event_name === AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested ||
    event.event_name === AUTONOMY_EVENT_NAMES.repairDelegationSysadminRequested
  ) {
    return 'dispatched';
  }

  const payloadStatus = readRepairDelegationStatus(payload.status);
  if (payloadStatus !== 'failed' || payload.status === 'failed') {
    return payloadStatus;
  }

  switch (event.outcome) {
    case 'success':
      return 'succeeded';
    case 'denied':
      return 'denied';
    case 'in_progress':
      return 'dispatched';
    case 'failure':
      return 'failed';
    case 'skipped':
      return 'failed';
  }
}

function readRepairExecutionPath(
  value: unknown,
): RepairDelegationExecutionPath {
  return value === 'sysadmin_workflow' ? 'sysadmin_workflow' : 'doctor';
}

function readRepairLifecycleExecutionPath(
  event: EventLedger,
  payload: Record<string, unknown>,
): RepairDelegationExecutionPath {
  if (payload.executionPath === 'doctor') {
    return 'doctor';
  }
  if (payload.executionPath === 'sysadmin_workflow') {
    return 'sysadmin_workflow';
  }
  if (
    event.event_name === AUTONOMY_EVENT_NAMES.repairDelegationSysadminRequested
  ) {
    return 'sysadmin_workflow';
  }
  if (
    event.event_name === AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested
  ) {
    return 'doctor';
  }
  return 'doctor';
}

function isRepairDelegationLifecycleEvent(eventName: string): boolean {
  return (
    eventName === AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested ||
    eventName === AUTONOMY_EVENT_NAMES.repairDelegationSysadminRequested ||
    eventName === AUTONOMY_EVENT_NAMES.repairDelegationCompleted
  );
}

function repairLifecycleDefaultMessage(event: EventLedger): string {
  if (
    event.event_name === AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested
  ) {
    return 'Doctor repair requested.';
  }
  if (
    event.event_name === AUTONOMY_EVENT_NAMES.repairDelegationSysadminRequested
  ) {
    return 'Sysadmin repair requested.';
  }
  return 'Repair delegation completed.';
}

function readEvidenceReferences(value: unknown): AutonomyEvidenceReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const reference = readRecord(entry);
    const kind = readString(reference?.kind);
    const summary = readString(reference?.summary);
    if (!reference || !isEvidenceKind(kind) || !summary) {
      return [];
    }

    return [
      {
        kind,
        id: readSafeEvidenceId(reference.id),
        summary,
      },
    ];
  });
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

function readRuntimeFeedbackEventName(
  eventName: string,
): RuntimeFeedbackEventName | null {
  switch (eventName) {
    case AUTONOMY_EVENT_NAMES.runtimeFeedbackSignalIngested:
    case AUTONOMY_EVENT_NAMES.runtimeFeedbackSignalSkipped:
    case AUTONOMY_EVENT_NAMES.runtimeFeedbackCandidateCreated:
      return eventName;
    default:
      return null;
  }
}

function readRuntimeFeedbackPayload(
  value: unknown,
): RuntimeFeedbackPayloadInput {
  const payload = readRecord(value);
  if (!payload) {
    return {};
  }

  return {
    group_id: readString(payload.group_id),
    signal_type: readString(payload.signal_type),
    candidate_id: readString(payload.candidate_id),
    skipped_reason: readRuntimeFeedbackSkippedReason(payload.skipped_reason),
    occurrence_count: readOptionalNumber(payload.occurrence_count),
    dedupe_fingerprint_hash: readString(payload.dedupe_fingerprint_hash),
  };
}

function readRuntimeFeedbackSkippedReason(
  value: unknown,
): RuntimeFeedbackPayloadInput['skipped_reason'] {
  if (
    value === 'candidate_exists' ||
    value === 'cooldown_active' ||
    value === 'confidence_below_threshold' ||
    value === 'frequency_below_threshold'
  ) {
    return value;
  }
  return undefined;
}
