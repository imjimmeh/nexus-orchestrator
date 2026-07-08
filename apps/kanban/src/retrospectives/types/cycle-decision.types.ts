import { BoardStateSummary as ServiceBoardStateSummary } from "../../services/board-state.types";

/**
 * Decision type enum for cycle decisions.
 * Represents the possible outcomes of an orchestration cycle.
 */
export enum DecisionType {
  /** Cycle was blocked, requiring human intervention */
  BLOCKED = "blocked",
  /** Cycle completed successfully */
  COMPLETE = "complete",
  /** Cycle should repeat with the same configuration */
  REPEAT = "repeat",
}

/**
 * Result from extracting cycle decision metadata.
 */
export interface CycleDecisionMetadataResult {
  /** The extracted cycle decision metadata */
  metadata: CycleDecisionMetadata;
  /** Whether this decision is non-trivial and should emit an event */
  isNonTrivial: boolean;
  /** Whether the decision involved a board mutation */
  hasBoardMutation: boolean;
}

/**
 * Input parameters for extracting cycle decision metadata.
 */
export interface ExtractCycleDecisionMetadataParams {
  /** The project scope this decision applies to */
  projectId: string;
  /** Type of decision made (blocked, complete, repeat) */
  decision: DecisionType;
  /** Human-readable explanation for the decision */
  reason: string;
  /** Unique idempotency key to prevent duplicate processing */
  idempotencyKey: string;
  /** Optional board state summary from the BoardStateService */
  boardState?: ServiceBoardStateSummary;
  /** Optional work item counts breakdown */
  workItemCounts?: WorkItemCounts;
  /** Optional goal coverage metrics */
  goalCoverage?: GoalCoverage;
  /** Optional cycle metadata (workflow context and timing) */
  cycleMetadata?: Partial<CycleMetadata>;
  /** Optional workflow context */
  workflowRunId?: string | null;
  /** Optional job context */
  jobId?: string | null;
}

/**
 * Summary of the board state at the time of the cycle decision.
 * Captures work item and goal distribution across columns/statuses.
 */
export interface BoardStateSummary {
  workItems: {
    /** Total number of work items on the board */
    total: number;
    /** Count of work items grouped by their current status */
    countsByStatus: Readonly<Record<string, number>>;
  };
  goals: {
    /** Total number of goals tracked for the project */
    total: number;
    /** Count of goals grouped by their current status */
    countsByStatus: Readonly<Record<string, number>>;
  };
}

/**
 * Count breakdown of work items on the board.
 */
export interface WorkItemCounts {
  /** Total number of work items */
  total: number;
  /** Work item counts grouped by status */
  byStatus: Readonly<Record<string, number>>;
  /** Number of work items that are not in a terminal state */
  activeCount: number;
  /** Number of work items that have been completed */
  doneCount: number;
}

/**
 * Coverage metrics for project goals.
 */
export interface GoalCoverage {
  /** Total number of goals */
  total: number;
  /** Number of active (in-progress) goals */
  active: number;
  /** Number of completed goals */
  completed: number;
  /** Percentage of goals that are completed (0-100) */
  coveragePercentage: number;
}

/**
 * Provenance tracking for cycle decisions.
 * Captures the source and context of the decision.
 */
export interface CycleDecisionProvenance {
  /** The project this decision applies to */
  projectId: string;
  /** The workflow run that produced this decision */
  workflowRunId: string | null;
  /** The specific job that made this decision */
  jobId: string | null;
  /** Idempotency key to prevent duplicate processing */
  idempotencyKey: string | null;
  /** Source of the decision */
  decisionSource: "orchestration_cycle" | "manual" | "system";
}

/**
 * Complete metadata for a cycle decision.
 * Combines all decision-related information into a single structure.
 */
export interface CycleDecisionMetadata {
  /** The type of decision made */
  decisionType: DecisionType;
  /** Human-readable reason for the decision */
  reason: string;
  /** Whether this decision is considered substantive for learning purposes */
  isSubstantive: boolean;
  /** Snapshot of the board state at decision time */
  boardStateSummary: BoardStateSummary;
  /** Count breakdown of work items */
  workItemCounts: WorkItemCounts;
  /** Goal coverage metrics */
  goalCoverage: GoalCoverage;
  /** Timestamp when the decision was recorded */
  recordedAt: string;
  /** Provenance and source information */
  provenance: CycleDecisionProvenance;
}

/**
 * Cycle metadata for the retrospective cycle decision event.
 * Contains workflow context and timing information.
 */
export interface CycleMetadata {
  /** The workflow run that produced this decision */
  workflowRunId: string | null;
  /** The specific job that made this decision */
  jobId: string | null;
  /** Source of the decision */
  decisionSource: "orchestration_cycle" | "manual" | "system";
}

/**
 * Event emitted when a substantive cycle decision is recorded.
 * This event feeds cycle evidence into the learning pipeline for
 * non-trivial decisions: blocked, complete, or repeat with board mutation.
 *
 * A decision is considered substantive if:
 * - decision is 'blocked' or 'complete'
 * - decision is 'repeat' AND boardMutation === true
 */
export interface RetrospectiveCycleDecisionRecordedEvent {
  /** Unique event name for identification */
  eventName: "kanban.retrospective_cycle_decision_recorded.v1";
  /** The project this decision applies to */
  projectId: string;
  /** Type of decision made (blocked, complete, repeat) */
  decision: DecisionType;
  /** Human-readable explanation for the decision */
  reasoning: string;
  /** Idempotency key to prevent duplicate processing */
  idempotencyKey: string | null;
  /** Snapshot of board state at decision time with work item counts and goal coverage */
  boardStateSummary: {
    workItems: {
      /** Total number of work items on the board */
      total: number;
      /** Count of work items grouped by their current status */
      countsByStatus: Readonly<Record<string, number>>;
    };
    goals: {
      /** Total number of goals tracked for the project */
      total: number;
      /** Count of goals grouped by their current status */
      countsByStatus: Readonly<Record<string, number>>;
    };
  };
  /** ISO 8601 timestamp when the event was created */
  timestamp: string;
  /** Workflow context and timing information */
  cycleMetadata: CycleMetadata;
}
