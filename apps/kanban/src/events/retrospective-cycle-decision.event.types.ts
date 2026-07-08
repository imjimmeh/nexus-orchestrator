import type {
  RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
  RETROSPECTIVE_CYCLE_DECISION_EVENT_VERSION,
} from "./retrospective-cycle-decision.event";

export type RetrospectiveCycleDecisionType = "blocked" | "complete" | "repeat";

export interface RetrospectiveCycleDecisionBoardStateSummary {
  totalWorkItems: number;
  doneCount: number;
  inProgressCount: number;
  blockedCount: number;
  backlogCount: number;
}

export interface RetrospectiveCycleDecisionGoalCoverage {
  totalGoals: number;
  coveredGoals: number;
  coveragePercent: number;
}

export interface RetrospectiveCycleDecisionRecordedEvent {
  eventType: typeof RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE;
  eventVersion: typeof RETROSPECTIVE_CYCLE_DECISION_EVENT_VERSION;
  projectId: string;
  decision: RetrospectiveCycleDecisionType;
  reason: string;
  idempotencyKey: string;
  boardStateSummary: RetrospectiveCycleDecisionBoardStateSummary;
  goalCoverage: RetrospectiveCycleDecisionGoalCoverage;
  hasBoardMutation: boolean;
  timestamp: string;
}
