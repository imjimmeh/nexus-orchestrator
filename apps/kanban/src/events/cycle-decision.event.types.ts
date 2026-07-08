import type {
  KANBAN_RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT_TYPE,
  KANBAN_RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT_VERSION,
} from "./cycle-decision.event";

export type CycleDecisionType = "blocked" | "complete" | "repeat";

export interface BoardStateSummary {
  totalWorkItems: number;
  itemsByStatus: Record<string, number>;
  doneCount: number;
  inProgressCount: number;
  blockedCount: number;
  backlogCount: number;
  completionRate: number;
}

export interface GoalCoverage {
  totalGoals: number;
  coveredGoals: number;
  goalIds: string[];
  coveragePercent: number;
}

export interface WorkItemCounts {
  blocked: number;
  inProgress: number;
  done: number;
  backlog: number;
  total: number;
}

export interface CycleMetadata {
  workflowRunId: string;
  jobId: string;
  decisionSource: string;
}

export interface CycleDecisionEvent {
  eventType: typeof KANBAN_RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT_TYPE;
  eventVersion: typeof KANBAN_RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT_VERSION;
  projectId: string;
  decision: CycleDecisionType;
  reasoning: string;
  idempotencyKey: string | null;
  boardStateSummary: BoardStateSummary;
  workItemCounts: WorkItemCounts;
  goalCoverage: GoalCoverage;
  boardMutationDetected: boolean;
  timestamp: string;
  cycleMetadata: CycleMetadata;
}
