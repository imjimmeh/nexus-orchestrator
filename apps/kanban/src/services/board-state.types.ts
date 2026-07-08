/**
 * Always-populated counts of work items grouped by lifecycle bucket.
 *
 * `activeCount` excludes items in any status listed by
 * `BoardStateService.TERMINAL_WORK_ITEM_STATUSES` ("done" or "completed").
 * `doneCount` aggregates every terminal status (not only "done") so that
 * downstream UIs that display "done" via `BoardStateSummary.completedTasks`
 * still see all finished items through `work_item_counts.doneCount`.
 */
export interface BoardStateSummaryWorkItemCounts {
  total: number;
  byStatus: Record<string, number>;
  activeCount: number;
  doneCount: number;
}

/**
 * Goal taxonomy derived from non-archived project goals.
 *
 * `completed` counts goals whose `status` equals
 * `BoardStateService.COMPLETED_GOAL_STATUS` ("done").
 * `coveragePercentage` is `completed / total * 100`. When `total === 0`
 * the service falls back to `0` rather than producing `NaN`; callers can
 * therefore rely on `Number.isFinite(coveragePercentage) === true`.
 */
export interface BoardStateSummaryGoalCoverage {
  total: number;
  active: number;
  completed: number;
  coveragePercentage: number;
}

/**
 * Aggregated board state for a single project.
 *
 * Contract: when produced by `BoardStateService.getBoardStateSummary`, every
 * field — including `column_counts`, `total_items`, `work_item_counts`, and
 * `goal_coverage` — is always populated. The four deeper fields remain
 * marked optional only for backward compatibility with any external
 * callers that hand-construct a `BoardStateSummary` (e.g. older snapshot
 * readers, test fixtures). Consumers should treat them as required.
 */
export interface BoardStateSummary {
  projectId: string;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  lastActivityAt: Date | null;
  column_counts?: Record<string, number>;
  total_items?: number;
  work_item_counts?: BoardStateSummaryWorkItemCounts;
  goal_coverage?: BoardStateSummaryGoalCoverage;
}

export interface BoardMutation {
  hasMutations: boolean;
  addedTasks: number;
  removedTasks: number;
  completedTasks: number;
  cycleNumber: number;
}

export interface BoardStateSnapshotResult {
  id: string;
  timestamp: Date;
  projectId: string;
  workItemCount: number;
  columnDistribution: Record<string, number>;
  snapshotData: Record<string, unknown>;
}

/**
 * Result type for getLatestSnapshot method
 */
export interface BoardStateSnapshotData {
  id: string;
  projectId: string;
  label?: string;
  snapshotData: Record<string, unknown>;
  timestamp: Date;
  workItemCount: number;
  columnDistribution: Record<string, number>;
}

/**
 * Result type for detectBoardMutation method
 */
export interface BoardMutationResult {
  hasMutation: boolean;
  previousSnapshot: BoardStateSnapshotData | null;
  currentSnapshot: BoardStateSnapshotData | null;
}
