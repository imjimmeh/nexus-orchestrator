import type {
  RetrospectiveCycleDecisionBoardStateSummary,
  RetrospectiveCycleDecisionGoalCoverage,
  RetrospectiveCycleDecisionRecordedEvent,
  RetrospectiveCycleDecisionType,
} from "./retrospective-cycle-decision.event.types";

// Event type constant - the canonical event type identifier
export const RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE =
  "kanban.retrospective_cycle_decision_recorded" as const;

// Event version for forward compatibility
export const RETROSPECTIVE_CYCLE_DECISION_EVENT_VERSION = "v1" as const;

/**
 * Determines if a cycle decision is considered non-trivial.
 * A non-trivial decision should emit an event to the learning pipeline.
 *
 * Non-trivial decisions are:
 * - 'blocked' or 'complete' (explicit outcomes)
 * - 'repeat' only when hasBoardMutation is true (documented board mutation)
 *
 * @param decision - The cycle decision type
 * @param hasBoardMutation - Whether the cycle involved a board mutation
 * @returns True if the decision should emit an event
 */
export function isRetrospectiveCycleDecisionNonTrivial(
  decision: RetrospectiveCycleDecisionType,
  hasBoardMutation: boolean,
): boolean {
  // Explicit outcomes are always non-trivial
  if (decision === "blocked" || decision === "complete") {
    return true;
  }
  // 'repeat' is only non-trivial if there was a board mutation
  return decision === "repeat" && hasBoardMutation;
}

/**
 * Factory function to create a RetrospectiveCycleDecisionRecordedEvent.
 * Ensures consistent event structure and proper typing.
 *
 * @param params - Event creation parameters
 * @returns A fully populated RetrospectiveCycleDecisionRecordedEvent with timestamp
 */
export function createRetrospectiveCycleDecisionEvent(params: {
  projectId: string;
  decision: RetrospectiveCycleDecisionType;
  reason: string;
  idempotencyKey: string;
  boardStateSummary: RetrospectiveCycleDecisionBoardStateSummary;
  goalCoverage: RetrospectiveCycleDecisionGoalCoverage;
  hasBoardMutation: boolean;
}): RetrospectiveCycleDecisionRecordedEvent {
  return {
    eventType: RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
    eventVersion: RETROSPECTIVE_CYCLE_DECISION_EVENT_VERSION,
    projectId: params.projectId,
    decision: params.decision,
    reason: params.reason,
    idempotencyKey: params.idempotencyKey,
    boardStateSummary: params.boardStateSummary,
    goalCoverage: params.goalCoverage,
    hasBoardMutation: params.hasBoardMutation,
    timestamp: new Date().toISOString(),
  };
}
