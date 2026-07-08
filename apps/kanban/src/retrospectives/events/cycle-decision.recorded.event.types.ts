import {
  BoardStateSummary,
  CycleDecisionProvenance,
  DecisionType,
  GoalCoverage,
  WorkItemCounts,
} from "../types/cycle-decision.types";

/**
 * Base event interface for all kanban domain events.
 * Provides common fields required for event emission.
 */
export interface KanbanDomainEvent {
  /** Unique name identifying the event type */
  eventName: string;
  /** The project scope this event applies to */
  scopeId: string;
  /** ISO 8601 timestamp when the event occurred */
  timestamp: string;
  /** Unique identifier for deduplication */
  eventId?: string;
}

/**
 * Payload structure for the cycle decision recorded event.
 * Emitted when an orchestration cycle decision is completed and persisted.
 */
export interface CycleDecisionRecordedEventPayload {
  /** The canonical event name */
  event_name: string;
  /** The project scope this decision applies to */
  scope_id: string;
  /** Type of decision made (blocked, complete, repeat) */
  decision_type: DecisionType;
  /** Human-readable explanation for the decision */
  reason: string;
  /** Whether this decision should trigger learning candidate generation */
  is_substantive: boolean;
  /** Snapshot of board state at decision time */
  board_state_summary: BoardStateSummary;
  /** Work item count breakdown */
  work_item_counts: WorkItemCounts;
  /** Goal coverage metrics */
  goal_coverage: GoalCoverage;
  /** Timestamp when the decision was recorded */
  cycle_decision_recorded_at: string;
  /** Provenance tracking information */
  provenance: CycleDecisionProvenance;
}

/**
 * Complete cycle decision recorded event.
 * Extends the base domain event with cycle decision specific payload.
 */
export interface CycleDecisionRecordedEvent
  extends KanbanDomainEvent, CycleDecisionRecordedEventPayload {}
