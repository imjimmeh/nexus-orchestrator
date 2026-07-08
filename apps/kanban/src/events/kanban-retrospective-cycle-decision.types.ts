/**
 * Event Schema and Types for Kanban Retrospective Cycle Decision Events.
 *
 * This module defines the event interface for the 'kanban.retrospective_cycle_decision_recorded'
 * event that fires when a CEO cycle decision is recorded with non-trivial outcomes.
 *
 * The event carries structured decision metadata for the learning candidate pipeline,
 * enabling wire CEO cycle decisions into the learning candidate pipeline.
 *
 * @module kanban-retrospective-cycle-decision.types
 */

// Event type constant - the canonical event type identifier
export const KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE =
  "kanban.retrospective_cycle_decision_recorded" as const;

// Event version constant - follows semantic versioning for events
export const KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_VERSION = "v1" as const;

/**
 * Decision types for the cycle decision event.
 * Represents the possible outcomes of a CEO cycle review.
 */
export type CycleDecision = "blocked" | "complete" | "repeat" | "abandon";

/**
 * Goal coverage metrics at the time of the cycle decision.
 * Captures which goals have work items assigned and are being tracked.
 */
export interface GoalCoverage {
  /** Total number of goals defined for the cycle */
  total_goals: number;
  /** Number of goals that have at least one work item assigned/covered */
  covered_goals: number;
  /** Array of goal IDs that have work items assigned */
  goal_ids: string[];
}

/**
 * Snapshot of board state at the time of the cycle decision.
 * Captures work item distribution across statuses/columns and goal coverage.
 */
export interface BoardStateSnapshot {
  /** Total number of work items on the board */
  total_items: number;
  /** Work item counts grouped by their current status/column */
  items_by_status: Record<string, number>;
  /** Number of work items currently blocked */
  blocked_items: number;
  /** Board completion rate as a percentage (0-100) */
  completion_rate: number;
  /** Goal coverage metrics at decision time */
  goal_coverage: GoalCoverage;
}

/**
 * Cycle metadata capturing the state and progress of the completed cycle.
 */
export interface CycleMetadata {
  /** ISO 8601 timestamp marking the start of the cycle */
  cycle_start: string;
  /** ISO 8601 timestamp marking the end of the cycle (optional if ongoing) */
  cycle_end?: string;
  /** Number of work items processed during the cycle */
  items_processed: number;
  /** Number of work items that were blocked during the cycle */
  items_blocked: number;
  /** Number of work items completed during the cycle */
  items_completed: number;
  /** Whether this cycle involved any board mutations (structure changes) */
  has_board_mutation: boolean;
}

/**
 * Event emitted when a retrospective cycle decision is recorded.
 *
 * This event fires for non-trivial decisions:
 * - decision is 'blocked', 'complete', or 'abandon'
 * - decision is 'repeat' AND has_board_mutation is true
 *
 * The event carries evidence for the learning candidate pipeline,
 * enabling wire CEO cycle decisions into the learning pipeline.
 */
export interface KanbanRetrospectiveCycleDecisionRecordedEvent {
  /** Unique event type identifier */
  event_type: typeof KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE;
  /** Event schema version for forward compatibility */
  event_version: typeof KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_VERSION;
  /** ISO 8601 timestamp when the event was created */
  timestamp: string;
  /** The project scope this event applies to */
  project_id: string;
  /** Type of decision made (blocked, complete, repeat, abandon) */
  decision: CycleDecision;
  /** Human-readable explanation for the decision */
  reason: string;
  /** Unique idempotency key to prevent duplicate processing */
  idempotency_key: string;
  /** Snapshot of board state at decision time */
  board_state_snapshot: BoardStateSnapshot;
  /** Metadata about the cycle that just completed */
  cycle_metadata: CycleMetadata;
}

/**
 * Payload structure for creating a new retrospective cycle decision event.
 */
export interface CreateKanbanRetrospectiveCycleDecisionEventParams {
  /** The project scope this event applies to */
  project_id: string;
  /** Type of decision made (blocked, complete, repeat, abandon) */
  decision: CycleDecision;
  /** Human-readable explanation for the decision */
  reason: string;
  /** Unique idempotency key to prevent duplicate processing */
  idempotency_key: string;
  /** Snapshot of board state at decision time */
  board_state_snapshot: BoardStateSnapshot;
  /** Metadata about the cycle that just completed */
  cycle_metadata: CycleMetadata;
}

/**
 * Factory function to create a KanbanRetrospectiveCycleDecisionRecordedEvent.
 * Ensures consistent event structure and proper typing.
 *
 * @param params - Event creation parameters
 * @returns A fully populated KanbanRetrospectiveCycleDecisionRecordedEvent with timestamp
 */
export function createKanbanRetrospectiveCycleDecisionEvent(
  params: CreateKanbanRetrospectiveCycleDecisionEventParams,
): KanbanRetrospectiveCycleDecisionRecordedEvent {
  return {
    event_type: KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
    event_version: KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_VERSION,
    timestamp: new Date().toISOString(),
    project_id: params.project_id,
    decision: params.decision,
    reason: params.reason,
    idempotency_key: params.idempotency_key,
    board_state_snapshot: params.board_state_snapshot,
    cycle_metadata: params.cycle_metadata,
  };
}

/**
 * Determines if a cycle decision is considered non-trivial.
 * A non-trivial decision should emit an event to the learning pipeline.
 *
 * Non-trivial decisions are:
 * - 'blocked', 'complete', or 'abandon' (explicit outcomes)
 * - 'repeat' only when has_board_mutation is true (documented board mutation)
 *
 * @param decision - The cycle decision type
 * @param has_board_mutation - Whether the cycle involved a board mutation
 * @returns True if the decision should emit an event
 */
export function isNonTrivialDecision(
  decision: CycleDecision,
  has_board_mutation: boolean,
): boolean {
  // Explicit outcomes are always non-trivial
  if (
    decision === "blocked" ||
    decision === "complete" ||
    decision === "abandon"
  ) {
    return true;
  }
  // 'repeat' is only non-trivial if there was a board mutation
  return decision === "repeat" && has_board_mutation;
}
