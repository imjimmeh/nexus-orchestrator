export const KANBAN_RETROSPECTIVE_RUN_STATUSES = [
  "running",
  "completed",
  "skipped",
  "failed",
] as const;

export const KANBAN_RETROSPECTIVE_SKIP_REASONS = [
  "no_delta",
  "cooldown_active",
  "duplicate_trigger",
  "missing_project",
  "missing_orchestration",
  "insufficient_evidence",
] as const;

export const KANBAN_RETROSPECTIVE_TRIGGER_TYPES = [
  "completion_event",
  "manual_replay",
  "failure_threshold",
] as const;

export const LEARNING_CANDIDATE_PROPOSED_EVENT =
  "learning.candidate.proposed.v1";

export const RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT =
  "kanban.retrospective_cycle_decision_recorded.v1";

// New event type for milestone 1 - uses camelCase naming with simplified structures
export interface RetrospectiveCycleDecisionRecordedEventV1 {
  eventType: "kanban.retrospective_cycle_decision_recorded";
  projectId: string;
  decision: "blocked" | "complete" | "repeat";
  reason: string;
  boardStateSummary: {
    todo: number;
    inProgress: number;
    done: number;
    blocked: number;
  };
  workItemCounts: {
    total: number;
    completed: number;
    added: number;
  };
  goalCoverage?: number;
  hasBoardMutation: boolean;
  timestamp: string;
  cycleId?: string;
}

export interface BoardStateSummary {
  workItems: {
    total: number;
    countsByStatus: Record<string, number>;
  };
  goals: {
    total: number;
    countsByStatus: Record<string, number>;
  };
}

export interface WorkItemCounts {
  total: number;
  byStatus: Record<string, number>;
  activeCount: number;
  doneCount: number;
}

export interface GoalCoverage {
  total: number;
  active: number;
  completed: number;
  coveragePercentage: number;
}

export interface RetrospectiveCycleDecisionRecordedEvent {
  event_name: string;
  scope_id: string;
  decision_type: "repeat" | "pause" | "complete" | "blocked";
  reason: string;
  is_substantive: boolean;
  board_state_summary: {
    workItems: {
      total: number;
      countsByStatus: Record<string, number>;
    };
    goals: {
      total: number;
      countsByStatus: Record<string, number>;
    };
  };
  work_item_counts: WorkItemCounts;
  goal_coverage: GoalCoverage;
  cycle_decision_recorded_at: string;
  provenance: {
    project_id: string;
    workflow_run_id: string | null;
    job_id: string | null;
    idempotency_key: string | null;
    decision_source: "orchestration_cycle" | "manual" | "system";
  };
}

export type KanbanRetrospectiveRunStatus =
  (typeof KANBAN_RETROSPECTIVE_RUN_STATUSES)[number];

export type KanbanRetrospectiveSkipReason =
  (typeof KANBAN_RETROSPECTIVE_SKIP_REASONS)[number];

export type KanbanRetrospectiveTriggerType =
  (typeof KANBAN_RETROSPECTIVE_TRIGGER_TYPES)[number];

export interface CreateKanbanRetrospectiveRunRecord {
  idempotency_key: string;
  project_id: string;
  orchestration_id: string | null;
  trigger_type: KanbanRetrospectiveTriggerType;
  trigger_revision_marker: string | null;
  replay_of_run_id?: string | null;
  started_at: Date;
  diagnostics_json?: Record<string, unknown> | null;
}

export interface CompleteKanbanRetrospectiveRunRecord {
  candidate_count: number;
  learning_candidate_ids: string[];
  delta_snapshot_json: Record<string, unknown>;
  diagnostics_json?: Record<string, unknown> | null;
  completed_at: Date;
}

export interface SkipKanbanRetrospectiveRunRecord {
  skip_reason: KanbanRetrospectiveSkipReason;
  diagnostics_json?: Record<string, unknown> | null;
  completed_at: Date;
}

export interface FailKanbanRetrospectiveRunRecord {
  failure_reason: string;
  diagnostics_json?: Record<string, unknown> | null;
  completed_at: Date;
}

export interface ListKanbanRetrospectiveRunsParams {
  projectId?: string;
  status?: KanbanRetrospectiveRunStatus;
  limit?: number;
  offset?: number;
}

export interface KanbanRetrospectiveCompletionTrigger {
  project_id: string;
  orchestration_id?: string | null;
  trigger_revision_marker: string;
  cycle_decision?: string | null;
  trigger_details?: Record<string, unknown>;
  manual_override?: boolean;
}

export type KanbanRetrospectiveRunResult =
  | {
      status: "completed";
      runId: string;
      candidateCount: number;
    }
  | {
      status: "skipped";
      reason: KanbanRetrospectiveSkipReason;
      runId: string;
    }
  | {
      status: "failed";
      runId: string;
      failureReason: string;
    };

export interface KanbanRetrospectiveDeltaSnapshot {
  project: {
    id: string;
    name: string;
  };
  orchestration: {
    projectId: string;
    mode: string;
    status: string;
    linkedRunId: string | null;
    updatedAt: string;
  };
  workItems: {
    total: number;
    countsByStatus: Record<string, number>;
  };
  decisions: {
    total: number;
    latestCycleDecision: {
      decision: string;
      reasoning: string | null;
      timestamp: string | null;
      idempotencyKey: string | null;
    } | null;
    markers: {
      hasDecisionLog: boolean;
      hasCycleDecision: boolean;
      hasCycleDecisionIdempotencyKey: boolean;
      hasCycleDecisionRecordedAt: boolean;
    };
  };
  actionRequests: {
    total: number;
    countsByStatus: Record<string, number>;
    countsByAction: Record<string, number>;
  };
}

export type KanbanRetrospectiveEvidence =
  | {
      state: "missing_project" | "missing_orchestration";
      projectId: string;
    }
  | {
      state: "insufficient_evidence";
      projectId: string;
      diagnostics: {
        actionRequestCount: number;
        decisionCount: number;
        workItemCount: number;
        cycleDecisionEventCount?: number;
      };
    }
  | {
      state: "ready";
      projectId: string;
      deltaSnapshot: KanbanRetrospectiveDeltaSnapshot;
      cycleDecisionEvents: CycleDecisionEventEvidence[];
    };

/**
 * Evidence entry derived from a recorded cycle decision event.
 * Used for per-cycle decision evidence during retrospective analysis.
 */
export interface CycleDecisionEventEvidence {
  /** Type of decision made (blocked, complete, repeat) */
  decisionType: string;
  /** Human-readable explanation for the decision */
  reason: string;
  /** ISO 8601 timestamp when the decision was recorded */
  recordedAt: string;
  /** Whether this decision is considered substantive for learning purposes */
  isSubstantive: boolean;
  /** Unique idempotency key to prevent duplicate processing */
  idempotencyKey: string | null;
  /** Provenance tracking information */
  provenance: {
    workflowRunId: string | null;
    decisionSource: string | null;
  };
}

/**
 * Board state snapshot captured at the time of a cycle decision.
 * Contains work item and goal distribution metrics.
 */
export interface BoardStateSnapshot {
  /** Total number of work items on the board */
  totalItems: number;
  /** Work item counts grouped by their current status */
  countsByStatus: Record<string, number>;
  /** Number of work items currently blocked */
  blockedItems: number;
  /** Board completion rate as a percentage (0-100) */
  completionRate: number;
  /** Goal coverage metrics at decision time */
  goalCoverage: {
    /** Total number of goals defined */
    totalGoals: number;
    /** Number of goals that have work items assigned */
    coveredGoals: number;
    /** Array of goal IDs with work items assigned */
    goalIds: string[];
  };
}

/**
 * Complete cycle decision evidence for storage and aggregation.
 * This is the stored form used by the event handler.
 */
export interface CycleDecisionEvidence {
  /** The project scope this decision applies to */
  projectId: string;
  /** Type of decision made (blocked, complete, repeat, abandon) */
  decisionType: string;
  /** Human-readable explanation for the decision */
  reason: string;
  /** Snapshot of board state at decision time */
  boardState: BoardStateSnapshot;
  /** Whether this decision is considered substantive */
  isSubstantive: boolean;
  /** Unique idempotency key to prevent duplicate processing */
  idempotencyKey: string | null;
  /** Provenance and source information */
  provenance: {
    workflowRunId: string | null;
    jobId: string | null;
    decisionSource: "orchestration_cycle" | "manual" | "system" | null;
  };
  /** ISO 8601 timestamp when the decision was recorded */
  recordedAt: string;
}
