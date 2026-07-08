/**
 * Domain events for the Kanban application.
 * Centralizes event name constants for all Kanban domain events.
 */

/**
 * Event emitted when a substantive cycle decision is recorded.
 * A decision is considered substantive if:
 * - decision is 'blocked' or 'complete'
 * - decision is 'repeat' AND boardMutation === true (board state changed)
 *
 * Trivial repeats (repeat with no board mutation) should NOT emit this event.
 */
export const RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT =
  "kanban.retrospective_cycle_decision_recorded.v1";

/**
 * Event emitted when a cycle decision is recorded.
 * Unlike the retrospective event, this fires for all decisions including trivial repeats.
 */
export const CYCLE_DECISION_RECORDED_EVENT =
  "kanban.cycle_decision_recorded.v1";

/**
 * Event emitted when a learning candidate is proposed from retrospective data.
 */
export const LEARNING_CANDIDATE_PROPOSED_EVENT =
  "learning.candidate.proposed.v1";
