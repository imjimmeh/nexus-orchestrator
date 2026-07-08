import {
  BoardStateSummary,
  CycleDecisionMetadata,
  CycleDecisionProvenance,
  DecisionType,
  GoalCoverage,
  WorkItemCounts,
} from "../types/cycle-decision.types";
import type {
  CycleDecisionRecordedEventPayload,
  CycleDecisionRecordedEvent,
} from "./cycle-decision.recorded.event.types";

export type {
  KanbanDomainEvent,
  CycleDecisionRecordedEventPayload,
  CycleDecisionRecordedEvent,
} from "./cycle-decision.recorded.event.types";

/**
 * Event name constant for the cycle decision recorded event.
 * Used as the canonical event identifier.
 */
export const CYCLE_DECISION_RECORDED_EVENT_NAME =
  "kanban.retrospective_cycle_decision_recorded.v1" as const;

/**
 * Factory function to create a CycleDecisionRecordedEvent from metadata.
 * Ensures consistent event structure and proper typing.
 */
export function createCycleDecisionRecordedEvent(params: {
  projectId: string;
  metadata: CycleDecisionMetadata;
  workflowRunId: string;
  jobId: string;
  idempotencyKey?: string;
  eventId?: string;
}): CycleDecisionRecordedEvent {
  const timestamp = new Date().toISOString();

  return {
    eventName: CYCLE_DECISION_RECORDED_EVENT_NAME,
    scopeId: params.projectId,
    timestamp,
    eventId: params.eventId,
    event_name: CYCLE_DECISION_RECORDED_EVENT_NAME,
    scope_id: params.projectId,
    decision_type: params.metadata.decisionType,
    reason: params.metadata.reason,
    is_substantive: params.metadata.isSubstantive,
    board_state_summary: params.metadata.boardStateSummary,
    work_item_counts: params.metadata.workItemCounts,
    goal_coverage: params.metadata.goalCoverage,
    cycle_decision_recorded_at: params.metadata.recordedAt,
    provenance: {
      projectId: params.projectId,
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      idempotencyKey: params.idempotencyKey ?? null,
      decisionSource: params.metadata.provenance.decisionSource,
    },
  };
}

/**
 * Class-based event representation for cycle decision recorded events.
 * Provides convenience methods for event creation and validation.
 */
export class CycleDecisionRecordedEventClass implements CycleDecisionRecordedEvent {
  public readonly eventName: string;
  public readonly scopeId: string;
  public readonly timestamp: string;
  public readonly eventId: string | undefined;
  public readonly event_name: string;
  public readonly scope_id: string;
  public readonly decision_type: DecisionType;
  public readonly reason: string;
  public readonly is_substantive: boolean;
  public readonly board_state_summary: BoardStateSummary;
  public readonly work_item_counts: WorkItemCounts;
  public readonly goal_coverage: GoalCoverage;
  public readonly cycle_decision_recorded_at: string;
  public readonly provenance: CycleDecisionProvenance;

  constructor(params: {
    projectId: string;
    metadata: CycleDecisionMetadata;
    workflowRunId: string;
    jobId: string;
    idempotencyKey?: string;
    eventId?: string;
  }) {
    const timestamp = new Date().toISOString();

    this.eventName = CYCLE_DECISION_RECORDED_EVENT_NAME;
    this.scopeId = params.projectId;
    this.timestamp = timestamp;
    this.eventId = params.eventId;
    this.event_name = CYCLE_DECISION_RECORDED_EVENT_NAME;
    this.scope_id = params.projectId;
    this.decision_type = params.metadata.decisionType;
    this.reason = params.metadata.reason;
    this.is_substantive = params.metadata.isSubstantive;
    this.board_state_summary = params.metadata.boardStateSummary;
    this.work_item_counts = params.metadata.workItemCounts;
    this.goal_coverage = params.metadata.goalCoverage;
    this.cycle_decision_recorded_at = params.metadata.recordedAt;
    this.provenance = {
      projectId: params.projectId,
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      idempotencyKey: params.idempotencyKey ?? null,
      decisionSource: params.metadata.provenance.decisionSource,
    };
  }

  /**
   * Convert the event to a plain object suitable for serialization.
   */
  toPayload(): CycleDecisionRecordedEventPayload {
    return {
      event_name: this.event_name,
      scope_id: this.scope_id,
      decision_type: this.decision_type,
      reason: this.reason,
      is_substantive: this.is_substantive,
      board_state_summary: this.board_state_summary,
      work_item_counts: this.work_item_counts,
      goal_coverage: this.goal_coverage,
      cycle_decision_recorded_at: this.cycle_decision_recorded_at,
      provenance: this.provenance,
    };
  }

  /**
   * Convert the event to the full domain event format.
   */
  toDomainEvent(): CycleDecisionRecordedEvent {
    return {
      eventName: this.eventName,
      scopeId: this.scopeId,
      timestamp: this.timestamp,
      eventId: this.eventId,
      ...this.toPayload(),
    };
  }
}
