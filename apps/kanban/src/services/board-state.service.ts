import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { BoardStateRepository } from "../database/repositories/kanban-board-state-snapshot.repository";
import { KanbanProjectGoalRepository } from "../database/repositories/kanban-project-goal.repository";
import { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";

import {
  BoardStateSummary,
  BoardMutation,
  BoardStateSnapshotResult,
  BoardStateSnapshotData,
  BoardMutationResult,
} from "./board-state.types";

@Injectable()
export class BoardStateService {
  private readonly logger = new Logger(BoardStateService.name);

  /**
   * Work-item statuses that mark a task as finished and excluded from
   * the "active" bucket. Both "done" and "completed" are treated as
   * terminal; everything else (todo, backlog, in-progress, blocked,
   * refinement, etc.) counts toward active work.
   */
  private static readonly TERMINAL_WORK_ITEM_STATUSES = [
    "done",
    "completed",
  ] as const;

  /**
   * Goal status treated as "completed" for goal_coverage.coveragePercentage
   * and goal_coverage.completed. Other statuses (todo, in-progress,
   * refinement, etc.) roll up into the "active" bucket.
   */
  private static readonly COMPLETED_GOAL_STATUS = "done";

  constructor(
    private readonly boardStateRepository: BoardStateRepository,
    private readonly projects: KanbanProjectRepository,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly goals: KanbanProjectGoalRepository,
  ) {}

  /**
   * Aggregate a project's board state into a {@link BoardStateSummary}.
   *
   * Always populates the following fields:
   * - `projectId`, `totalTasks`, `completedTasks`, `blockedTasks`,
   *   `inProgressTasks`, `pendingTasks`, `lastActivityAt`
   * - `column_counts` — per-status histogram of work items.
   * - `total_items` — synonym for `totalTasks`.
   * - `work_item_counts` — typed wrapper around the histogram plus
   *   `total`, `activeCount` (non-terminal) and `doneCount` (terminal).
   * - `goal_coverage` — non-archived goal taxonomy (`total`, `active`,
   *   `completed`, `coveragePercentage`). When the project has zero
   *   goals, `coveragePercentage` falls back to `0` rather than `NaN`,
   *   so callers can rely on `Number.isFinite(coveragePercentage) === true`.
   *
   * The four deeper fields are declared optional on the type for
   * backward compatibility with hand-constructed summaries, but this
   * service always emits them.
   */
  async getBoardStateSummary(projectId: string): Promise<BoardStateSummary> {
    const projectItems = await this.workItems.findByproject_id(projectId);

    const byStatus: Record<string, number> = {};
    let lastActivityAt: Date | null = null;
    for (const item of projectItems) {
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
      const updatedAt = item.updated_at;
      if (updatedAt && (!lastActivityAt || updatedAt > lastActivityAt)) {
        lastActivityAt = updatedAt;
      }
    }

    const total = projectItems.length;
    const doneCount = BoardStateService.TERMINAL_WORK_ITEM_STATUSES.reduce(
      (sum, status) => sum + (byStatus[status] ?? 0),
      0,
    );
    const activeCount = Math.max(0, total - doneCount);
    const completedTasks = byStatus["done"] ?? 0;
    const blockedTasks = byStatus["blocked"] ?? 0;
    const inProgressTasks = byStatus["in-progress"] ?? 0;
    const pendingTasks = (byStatus["todo"] ?? 0) + (byStatus["backlog"] ?? 0);

    const projectGoals = await this.goals.findByproject_id(projectId, false);
    const completedGoalCount = projectGoals.filter(
      (g) => g.status === BoardStateService.COMPLETED_GOAL_STATUS,
    ).length;
    const activeGoalCount = projectGoals.length - completedGoalCount;
    const goalCoverageTotal = projectGoals.length;
    const goalCoveragePercentage =
      goalCoverageTotal === 0
        ? 0
        : (completedGoalCount / goalCoverageTotal) * 100;

    return {
      projectId,
      totalTasks: total,
      completedTasks,
      blockedTasks,
      inProgressTasks,
      pendingTasks,
      lastActivityAt,
      column_counts: byStatus,
      total_items: total,
      work_item_counts: {
        total,
        byStatus,
        activeCount,
        doneCount,
      },
      goal_coverage: {
        total: goalCoverageTotal,
        active: activeGoalCount,
        completed: completedGoalCount,
        coveragePercentage: goalCoveragePercentage,
      },
    };
  }

  async detectBoardMutation(
    projectId: string,
    idempotencyKey?: string,
  ): Promise<BoardMutation> {
    // Get the idempotency key prefix for comparison
    const idempotencyKeyPrefix = idempotencyKey
      ? this.getIdempotencyKeyPrefix(idempotencyKey)
      : "default";

    // Get the latest snapshot with matching idempotency prefix
    const latestSnapshot =
      await this.boardStateRepository.findLatestByProjectIdAndIdempotencyKeyPrefix(
        projectId,
        idempotencyKeyPrefix,
      );

    // If no previous snapshot exists, no mutation can be detected
    if (!latestSnapshot) {
      return {
        hasMutations: false,
        addedTasks: 0,
        removedTasks: 0,
        completedTasks: 0,
        cycleNumber: 1,
      };
    }

    // Get current board state
    const currentState = await this.getCurrentBoardState(projectId);

    // Compare work item counts
    const previousWorkItemCount = latestSnapshot.work_item_count;
    const currentWorkItemCount = currentState.workItemCount;
    const addedTasks = Math.max(
      0,
      currentWorkItemCount - previousWorkItemCount,
    );
    const removedTasks = Math.max(
      0,
      previousWorkItemCount - currentWorkItemCount,
    );

    // Compare column distributions
    const previousDistribution = latestSnapshot.column_distribution ?? {};
    const currentDistribution = currentState.columnDistribution;
    const distributionChanged = this.compareDistributions(
      previousDistribution,
      currentDistribution,
    );

    // Compare serialized data
    const previousData = latestSnapshot.snapshot_data ?? {};
    const currentData = currentState.snapshotData;
    const serializedChanged = !this.deepEqual(previousData, currentData);

    // Calculate completed tasks difference (items in 'done' or 'completed' columns)
    const previousCompleted =
      (previousDistribution["done"] ?? 0) +
      (previousDistribution["completed"] ?? 0);
    const currentCompleted =
      (currentDistribution["done"] ?? 0) +
      (currentDistribution["completed"] ?? 0);
    const completedTasksDelta = currentCompleted - previousCompleted;

    // Extract cycle number from snapshot or default to 1
    const cycleNumber = this.extractCycleNumber(latestSnapshot.snapshot_data);

    const hasMutations =
      addedTasks > 0 ||
      removedTasks > 0 ||
      distributionChanged ||
      serializedChanged;

    return {
      hasMutations,
      addedTasks,
      removedTasks,
      completedTasks: completedTasksDelta,
      cycleNumber,
    };
  }

  async createBoardStateSnapshot(
    projectId: string,
    idempotencyKey: string,
    label?: string,
  ): Promise<BoardStateSnapshotResult> {
    // Verify project exists
    const project = await this.projects.findById(projectId);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    // Query all work items for the project
    const workItems = await this.workItems.findByproject_id(projectId);

    // Calculate column distribution (work items by status)
    const columnDistribution: Record<string, number> = {};
    for (const item of workItems) {
      const status = item.status;
      columnDistribution[status] = (columnDistribution[status] ?? 0) + 1;
    }

    // Serialize board state to snapshot_data
    const snapshotData: Record<string, unknown> = {
      workItems: workItems.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        type: item.type,
        assignedAgentId: item.assigned_agent_id,
        waitingForInput: item.waiting_for_input,
        createdAt: item.created_at.toISOString(),
        updatedAt: item.updated_at.toISOString(),
        metadata: item.metadata,
      })),
      timestamp: new Date().toISOString(),
      label: label,
      summary: {
        totalWorkItems: workItems.length,
        columnDistribution,
      },
    };

    // Save snapshot to database
    const savedSnapshot = await this.boardStateRepository.save({
      project_id: projectId,
      idempotency_key: idempotencyKey,
      snapshot_data: snapshotData,
      work_item_count: workItems.length,
      column_distribution: columnDistribution,
    });

    this.logger.debug(
      `Created board state snapshot for project ${projectId} with ${workItems.length} work items`,
    );

    return {
      id: savedSnapshot.id,
      timestamp: savedSnapshot.created_at,
      projectId: savedSnapshot.project_id,
      workItemCount: savedSnapshot.work_item_count,
      columnDistribution: savedSnapshot.column_distribution,
      snapshotData: savedSnapshot.snapshot_data,
    };
  }

  /**
   * Get the most recent board state snapshot for a project.
   * @param projectId - The project identifier
   * @returns The latest snapshot data or null if no snapshot exists
   */
  async getLatestSnapshot(
    projectId: string,
  ): Promise<BoardStateSnapshotData | null> {
    const snapshot =
      await this.boardStateRepository.findLatestByProjectId(projectId);
    if (!snapshot) {
      return null;
    }

    return {
      id: snapshot.id,
      projectId: snapshot.project_id,
      snapshotData: snapshot.snapshot_data,
      timestamp: snapshot.created_at,
      workItemCount: snapshot.work_item_count,
      columnDistribution: snapshot.column_distribution,
    };
  }

  /**
   * Detect if the board state has mutated compared to the most recent stored snapshot.
   * Creates a new snapshot and compares it with the previous one.
   * @param projectId - The project identifier
   * @returns Mutation status with previous and current snapshots
   */
  async detectBoardMutationCore(
    projectId: string,
  ): Promise<BoardMutationResult> {
    // Get the latest stored snapshot
    const previousSnapshotData = await this.getLatestSnapshot(projectId);

    // Create a new snapshot with auto-generated idempotency key
    const newSnapshot = await this.createBoardStateSnapshot(
      projectId,
      `snapshot:${projectId}:${Date.now()}`,
    );

    const currentSnapshotData: BoardStateSnapshotData = {
      id: newSnapshot.id,
      projectId: newSnapshot.projectId,
      snapshotData: newSnapshot.snapshotData,
      timestamp: newSnapshot.timestamp,
      workItemCount: newSnapshot.workItemCount,
      columnDistribution: newSnapshot.columnDistribution,
    };

    // Compare snapshots using deep equality
    const hasMutation = previousSnapshotData
      ? !this.deepEqual(
          previousSnapshotData.snapshotData,
          currentSnapshotData.snapshotData,
        )
      : true;

    return {
      hasMutation,
      previousSnapshot: previousSnapshotData,
      currentSnapshot: currentSnapshotData,
    };
  }

  private async getCurrentBoardState(projectId: string): Promise<{
    workItemCount: number;
    columnDistribution: Record<string, number>;
    snapshotData: Record<string, unknown>;
  }> {
    // Query all work items for the project
    const workItems = await this.workItems.findByproject_id(projectId);

    // Calculate column distribution (work items by status)
    const columnDistribution: Record<string, number> = {};
    for (const item of workItems) {
      const status = item.status;
      columnDistribution[status] = (columnDistribution[status] ?? 0) + 1;
    }

    // Serialize current board state
    const snapshotData: Record<string, unknown> = {
      workItems: workItems.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        type: item.type,
        assignedAgentId: item.assigned_agent_id,
        waitingForInput: item.waiting_for_input,
        createdAt: item.created_at.toISOString(),
        updatedAt: item.updated_at.toISOString(),
        metadata: item.metadata,
      })),
      timestamp: new Date().toISOString(),
      summary: {
        totalWorkItems: workItems.length,
        columnDistribution,
      },
    };

    return {
      workItemCount: workItems.length,
      columnDistribution,
      snapshotData,
    };
  }

  private getIdempotencyKeyPrefix(idempotencyKey: string): string {
    // Extract prefix from idempotency key (e.g., "orchestration:cycle:123:checkpoint"
    // -> "orchestration:cycle")
    const parts = idempotencyKey.split(":");
    if (parts.length >= 3) {
      // Return prefix like "orchestration:cycle:123" for matching
      return parts.slice(0, 3).join(":");
    }
    return idempotencyKey;
  }

  private compareDistributions(
    previous: Record<string, number>,
    current: Record<string, number>,
  ): boolean {
    const allKeys = new Set([
      ...Object.keys(previous),
      ...Object.keys(current),
    ]);
    for (const key of allKeys) {
      if ((previous[key] ?? 0) !== (current[key] ?? 0)) {
        return true;
      }
    }
    return false;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (typeof a !== "object") return a === b;

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;

    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (!this.deepEqual(aObj[key], bObj[key])) {
        return false;
      }
    }

    return true;
  }

  private extractCycleNumber(snapshotData: Record<string, unknown>): number {
    if (
      snapshotData &&
      typeof snapshotData === "object" &&
      "cycleNumber" in snapshotData
    ) {
      const cycleNumber = snapshotData.cycleNumber;
      if (typeof cycleNumber === "number") {
        return cycleNumber;
      }
    }
    return 1;
  }
}
