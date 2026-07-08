/**
 * Event type definition for kanban retrospective cycle decision events.
 * Emitted when a CEO cycle decision is recorded with non-trivial outcomes.
 *
 * This event fires when:
 * - decision is 'blocked' or 'complete'
 * - decision is 'repeat' AND board_mutation_detected is true
 *
 * The event carries structured decision metadata for the learning candidate pipeline.
 */

// Event type constant
export const KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE =
  "kanban.retrospective_cycle_decision_recorded" as const;

/**
 * Decision types for the cycle decision event.
 */
export type RetrospectiveCycleDecisionType = "blocked" | "complete" | "repeat";

/**
 * Snapshot of board state at the time of the cycle decision.
 */
export interface BoardStateSummary {
  /** Work item distribution across columns */
  column_counts: Record<string, number>;
  /** Total number of work items on the board */
  total_items: number;
}

/**
 * Work item counts by status category.
 */
export interface WorkItemCounts {
  /** Number of blocked work items */
  blocked: number;
  /** Number of work items in progress */
  in_progress: number;
  /** Number of completed work items */
  done: number;
  /** Number of work items in backlog */
  backlog: number;
}

/**
 * Goal coverage metrics at the time of the cycle decision.
 */
export interface GoalCoverage {
  /** Number of goals that have at least one work item assigned */
  goals_with_items: number;
  /** Total number of goals defined */
  total_goals: number;
  /** Ratio of goals with items to total goals (0-1) */
  coverage_ratio: number;
}

/**
 * Event emitted when a retrospective cycle decision is recorded.
 *
 * This event carries evidence that includes the decision, reason, and
 * board state snapshot for processing by the learning candidate pipeline.
 */
export interface RetrospectiveCycleDecisionEvent {
  /** Unique event type identifier */
  event_type: typeof KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE;
  /** The project scope this event applies to */
  project_id: string;
  /** Type of decision made (blocked, complete, repeat) */
  decision: RetrospectiveCycleDecisionType;
  /** Human-readable explanation for the decision */
  reason: string;
  /** Snapshot of board state at decision time */
  board_state_summary: BoardStateSummary;
  /** Work item counts by status category */
  work_item_counts: WorkItemCounts;
  /** Goal coverage metrics */
  goal_coverage: GoalCoverage;
  /** Unique idempotency key to prevent duplicate processing */
  idempotency_key: string;
  /** ISO 8601 timestamp when the event was created */
  timestamp: string;
  /** Whether this decision involved a board mutation (for 'repeat' decisions) */
  board_mutation_detected: boolean;
}

/**
 * Payload structure for creating a new retrospective cycle decision event.
 */
export interface CreateRetrospectiveCycleDecisionEventParams {
  /** The project scope this event applies to */
  project_id: string;
  /** Type of decision made (blocked, complete, repeat) */
  decision: RetrospectiveCycleDecisionType;
  /** Human-readable explanation for the decision */
  reason: string;
  /** Snapshot of board state at decision time */
  board_state_summary: BoardStateSummary;
  /** Work item counts by status category */
  work_item_counts: WorkItemCounts;
  /** Goal coverage metrics */
  goal_coverage: GoalCoverage;
  /** Unique idempotency key to prevent duplicate processing */
  idempotency_key: string;
  /** Whether this decision involved a board mutation (for 'repeat' decisions) */
  board_mutation_detected: boolean;
}

/**
 * Factory function to create a RetrospectiveCycleDecisionEvent.
 * Ensures consistent event structure and proper typing.
 *
 * @param params - Event creation parameters
 * @returns A fully populated RetrospectiveCycleDecisionEvent with timestamp
 */
export function createCycleDecisionEvent(
  params: CreateRetrospectiveCycleDecisionEventParams,
): RetrospectiveCycleDecisionEvent {
  return {
    event_type: KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
    project_id: params.project_id,
    decision: params.decision,
    reason: params.reason,
    board_state_summary: params.board_state_summary,
    work_item_counts: params.work_item_counts,
    goal_coverage: params.goal_coverage,
    idempotency_key: params.idempotency_key,
    board_mutation_detected: params.board_mutation_detected,
    timestamp: new Date().toISOString(),
  };
}
