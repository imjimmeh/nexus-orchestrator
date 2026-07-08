import type {
  BoardStateSummary,
  CycleDecisionEvent,
  CycleDecisionType,
  CycleMetadata,
  GoalCoverage,
  WorkItemCounts,
} from "./cycle-decision.event.types";

// Event type constant - the canonical event type identifier
export const KANBAN_RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT_TYPE =
  "kanban.retrospective_cycle_decision_recorded" as const;

// Event version for forward compatibility
export const KANBAN_RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT_VERSION =
  "v1" as const;

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
export function isNonTrivialDecision(
  decision: CycleDecisionType,
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
 * Factory function to create a CycleDecisionEvent.
 * Ensures consistent event structure and proper typing.
 *
 * @param params - Event creation parameters
 * @returns A fully populated CycleDecisionEvent with timestamp
 */
export function createCycleDecisionEvent(params: {
  projectId: string;
  decision: CycleDecisionType;
  reasoning: string;
  idempotencyKey: string | null;
  boardStateSummary: BoardStateSummary;
  workItemCounts: WorkItemCounts;
  goalCoverage: GoalCoverage;
  boardMutationDetected: boolean;
  cycleMetadata: CycleMetadata;
}): CycleDecisionEvent {
  return {
    eventType: KANBAN_RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT_TYPE,
    eventVersion: KANBAN_RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT_VERSION,
    projectId: params.projectId,
    decision: params.decision,
    reasoning: params.reasoning,
    idempotencyKey: params.idempotencyKey,
    boardStateSummary: params.boardStateSummary,
    workItemCounts: params.workItemCounts,
    goalCoverage: params.goalCoverage,
    boardMutationDetected: params.boardMutationDetected,
    timestamp: new Date().toISOString(),
    cycleMetadata: params.cycleMetadata,
  };
}
