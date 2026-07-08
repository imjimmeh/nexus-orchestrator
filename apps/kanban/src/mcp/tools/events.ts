/**
 * Domain event constants for Kanban MCP tools.
 * Centralizes event name constants used across tool implementations.
 */

/**
 * Event emitted when a cycle decision is recorded.
 * This is a general cycle decision event.
 */
export const CYCLE_DECISION_RECORDED_EVENT =
  "kanban.cycle_decision_recorded.v1";

/**
 * Event emitted when a retrospective cycle decision is recorded.
 * Used for substantive decisions (blocked, complete, or repeat with board mutation).
 * Feeds cycle evidence into the learning pipeline.
 */
export const RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT =
  "kanban.retrospective_cycle_decision_recorded.v1";
