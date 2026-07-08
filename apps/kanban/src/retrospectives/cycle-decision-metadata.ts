/**
 * Cycle Decision Metadata Extractor.
 *
 * This module provides a utility function for extracting structured metadata
 * from cycle decisions for the learning candidate pipeline.
 *
 * The metadata includes:
 * - Board state summary (work item counts by status)
 * - Goal coverage metrics
 * - Cycle metadata (workflow context and timing)
 * - Board mutation detection
 *
 * @module retrospectives/cycle-decision-metadata
 */

import { BoardStateSummary as ServiceBoardStateSummary } from "../services/board-state.types";
import type {
  BoardStateSummary,
  WorkItemCounts,
  GoalCoverage,
  CycleDecisionMetadata,
  CycleMetadata,
  ExtractCycleDecisionMetadataParams,
  CycleDecisionMetadataResult,
} from "./types/cycle-decision.types";
import { DecisionType } from "./types/cycle-decision.types";

/**
 * Blocked status patterns to detect blocked work items.
 */
const BLOCKED_STATUS_PATTERNS = ["blocked", "waiting", "on-hold"];

/**
 * Checks if a status indicates a blocked work item.
 */
function isBlockedStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return BLOCKED_STATUS_PATTERNS.some((pattern) =>
    normalized.includes(pattern),
  );
}

/**
 * Extracts work item counts from a BoardStateSummary.
 *
 * @param boardState - The board state summary from BoardStateService
 * @returns WorkItemCounts structure
 */
export function extractWorkItemCounts(
  boardState: ServiceBoardStateSummary,
): WorkItemCounts {
  const countsByStatus = boardState.work_item_counts?.byStatus ?? {};
  const total = boardState.work_item_counts?.total ?? 0;
  const doneCount = boardState.work_item_counts?.doneCount ?? 0;
  const activeCount = boardState.work_item_counts?.activeCount ?? 0;

  return {
    total,
    byStatus: Object.freeze({ ...countsByStatus }),
    activeCount,
    doneCount,
  };
}

/**
 * Extracts goal coverage from a BoardStateSummary.
 *
 * @param boardState - The board state summary from BoardStateService
 * @returns GoalCoverage structure
 */
export function extractGoalCoverage(
  boardState: ServiceBoardStateSummary,
): GoalCoverage {
  if (boardState.goal_coverage) {
    return {
      total: boardState.goal_coverage.total,
      active: boardState.goal_coverage.active,
      completed: boardState.goal_coverage.completed,
      coveragePercentage: boardState.goal_coverage.coveragePercentage,
    };
  }

  // Return placeholder calculation if goal coverage not available
  return {
    total: 0,
    active: 0,
    completed: 0,
    coveragePercentage: 0,
  };
}

/**
 * Extracts board state summary from a BoardStateSummary.
 *
 * @param boardState - The board state summary from BoardStateService
 * @returns BoardStateSummary for the event
 */
export function extractBoardStateSummary(
  boardState: ServiceBoardStateSummary,
): BoardStateSummary {
  const workItems = {
    total: boardState.work_item_counts?.total ?? 0,
    countsByStatus: Object.freeze({
      ...(boardState.work_item_counts?.byStatus ?? {}),
    }),
  };

  const goals = {
    total: boardState.goal_coverage?.total ?? 0,
    countsByStatus: Object.freeze({}),
  };

  return {
    workItems,
    goals,
  };
}

/**
 * Determines if the cycle decision involved a board mutation.
 *
 * A board mutation is detected when:
 * - The decision is "repeat" (cycle should continue with changes)
 * - There were structural changes to the board (added/removed tasks)
 * - Work items were blocked during the cycle
 *
 * @param decision - The cycle decision type
 * @param boardState - Optional board state for mutation detection
 * @returns Whether a board mutation occurred
 */
export function determineHasBoardMutation(
  decision: DecisionType,
  boardState?: ServiceBoardStateSummary,
): boolean {
  // Only "repeat" decisions indicate a board mutation
  if (decision !== DecisionType.REPEAT) {
    return false;
  }

  // Check board state for blocked tasks
  if (boardState?.blockedTasks && boardState.blockedTasks > 0) {
    return true;
  }

  // Check work item counts for blocked items
  const blockedCount = Object.entries(
    boardState?.work_item_counts?.byStatus ?? {},
  )
    .filter(([status]) => isBlockedStatus(status))
    .reduce((sum, [, count]) => sum + count, 0);

  if (blockedCount > 0) {
    return true;
  }

  // Default: repeat without clear mutation signals is still a mutation
  // (the cycle chose to continue rather than complete)
  return true;
}

/**
 * Determines if a cycle decision is considered non-trivial.
 *
 * A non-trivial decision should emit an event to the learning pipeline.
 *
 * Non-trivial decisions are:
 * - 'blocked' (explicit stop signal)
 * - 'complete' (successful outcome)
 * - 'repeat' when has_board_mutation is true (documented board mutation)
 *
 * @param decision - The cycle decision type
 * @param hasBoardMutation - Whether the cycle involved a board mutation
 * @returns True if the decision should emit an event
 */
export function isNonTrivialCycleDecision(
  decision: DecisionType,
  hasBoardMutation: boolean,
): boolean {
  // Explicit outcomes are always non-trivial
  if (decision === DecisionType.BLOCKED || decision === DecisionType.COMPLETE) {
    return true;
  }

  // 'repeat' is only non-trivial if there was a board mutation
  return decision === DecisionType.REPEAT && hasBoardMutation;
}

/**
 * Extracts structured metadata from a cycle decision.
 *
 * This function creates the metadata structure needed for the
 * RetrospectiveCycleDecisionRecordedEvent, including:
 * - Board state summary (work item and goal distribution)
 * - Goal coverage metrics
 * - Cycle metadata (workflow context and timing)
 * - Board mutation detection
 *
 * @param params - The extraction parameters
 * @returns The extracted metadata and decision flags
 *
 * @example
 * ```typescript
 * const result = extractCycleDecisionMetadata({
 *   projectId: 'proj-123',
 *   decision: DecisionType.COMPLETE,
 *   reason: 'All critical work items completed',
 *   idempotencyKey: 'decision-2024-01-15-001',
 *   boardState: boardStateService.getBoardStateSummary('proj-123'),
 * });
 *
 * if (result.isNonTrivial) {
 *   // Emit the event
 * }
 * ```
 */
export function extractCycleDecisionMetadata(
  params: ExtractCycleDecisionMetadataParams,
): CycleDecisionMetadataResult {
  const {
    projectId,
    decision,
    reason,
    idempotencyKey,
    boardState,
    workItemCounts,
    goalCoverage,
    cycleMetadata,
    workflowRunId,
    jobId,
  } = params;

  // Determine if board mutation occurred
  const hasBoardMutation = determineHasBoardMutation(decision, boardState);

  // Determine if decision is non-trivial
  const isNonTrivial = isNonTrivialCycleDecision(decision, hasBoardMutation);

  // Extract board state summary
  const boardStateSummary: BoardStateSummary = boardState
    ? extractBoardStateSummary(boardState)
    : {
        workItems: { total: 0, countsByStatus: Object.freeze({}) },
        goals: { total: 0, countsByStatus: Object.freeze({}) },
      };

  // Extract work item counts
  const extractedWorkItemCounts: WorkItemCounts =
    workItemCounts ??
    (boardState
      ? extractWorkItemCounts(boardState)
      : {
          total: 0,
          byStatus: Object.freeze({}),
          activeCount: 0,
          doneCount: 0,
        });

  // Extract goal coverage
  const extractedGoalCoverage: GoalCoverage =
    goalCoverage ??
    (boardState
      ? extractGoalCoverage(boardState)
      : {
          total: 0,
          active: 0,
          completed: 0,
          coveragePercentage: 0,
        });

  // Build the metadata
  const metadata: CycleDecisionMetadata = {
    decisionType: decision,
    reason,
    isSubstantive: isNonTrivial,
    boardStateSummary,
    workItemCounts: extractedWorkItemCounts,
    goalCoverage: extractedGoalCoverage,
    recordedAt: new Date().toISOString(),
    provenance: {
      projectId,
      workflowRunId: workflowRunId ?? null,
      jobId: jobId ?? null,
      idempotencyKey,
      decisionSource: cycleMetadata?.decisionSource ?? "orchestration_cycle",
    },
  };

  return {
    metadata,
    isNonTrivial,
    hasBoardMutation,
  };
}

/**
 * Creates cycle metadata for a decision event.
 *
 * @param params - Parameters for cycle metadata
 * @returns CycleMetadata structure
 */
export function createCycleMetadata(params: {
  workflowRunId?: string | null;
  jobId?: string | null;
  decisionSource?: "orchestration_cycle" | "manual" | "system";
}): CycleMetadata {
  return {
    workflowRunId: params.workflowRunId ?? null,
    jobId: params.jobId ?? null,
    decisionSource: params.decisionSource ?? "orchestration_cycle",
  };
}

/**
 * Default empty board state for use when no board state is available.
 */
export const EMPTY_BOARD_STATE: ServiceBoardStateSummary = {
  projectId: "",
  totalTasks: 0,
  completedTasks: 0,
  blockedTasks: 0,
  inProgressTasks: 0,
  pendingTasks: 0,
  lastActivityAt: null,
};

// Re-export the types for backwards compatibility
export type {
  ExtractCycleDecisionMetadataParams,
  CycleDecisionMetadataResult,
} from "./types/cycle-decision.types";
