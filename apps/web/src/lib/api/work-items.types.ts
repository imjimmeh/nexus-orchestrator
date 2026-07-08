/**
 * Work-item domain types — work-item entity aliases (owned by
 * `@nexus/kanban-contracts`), work-item lifecycle, merge / merge-conflict
 * shapes, lifecycle gate markers, and work-item-cost summaries.
 *
 * Moved out of `./types.ts` so the rest of the web API client can consume a
 * stable surface while the legacy `./types.ts` is incrementally depopulated
 * by child-7.
 */

import type {
  CreateWorkItemRequest as KanbanCreateWorkItemRequest,
  UpdateWorkItemRequest as KanbanUpdateWorkItemRequest,
  WorkItem as KanbanWorkItem,
  WorkItemExecutionConfig as KanbanWorkItemExecutionConfig,
  WorkItemFailedDeliverable as KanbanWorkItemFailedDeliverable,
  WorkItemRejectionFeedback as KanbanWorkItemRejectionFeedback,
  WorkItemStatus as KanbanWorkItemStatus,
  WorkItemSubtask as KanbanWorkItemSubtask,
  WorkItemSubtaskStatus as KanbanWorkItemSubtaskStatus,
} from "@nexus/kanban-contracts";

export type WorkItem = KanbanWorkItem;
export type WorkItemStatus = KanbanWorkItemStatus;
export type WorkItemFailedDeliverable = KanbanWorkItemFailedDeliverable;
export type WorkItemRejectionFeedback = KanbanWorkItemRejectionFeedback;
export type WorkItemSubtaskStatus = KanbanWorkItemSubtaskStatus;
export type WorkItemSubtask = KanbanWorkItemSubtask;
export type WorkItemExecutionConfig = KanbanWorkItemExecutionConfig;
export type CreateWorkItemRequest = KanbanCreateWorkItemRequest;
export type UpdateWorkItemRequest = KanbanUpdateWorkItemRequest;

export interface WorkItemCostSummaryItem {
  id: string;
  project_id: string;
  title: string;
  status: string;
  costCents: number;
  tokenSpend: number;
  predictedRemainingCostCents: number | null;
  projectedTotalCostCents: number | null;
}

// ── Merge / merge-conflict shapes ──

export type MergeOutcome = "succeeded" | "conflict" | "failed";

export interface MergeResult {
  outcome: MergeOutcome;
  sourceBranch: string;
  destinationBranch: string;
  conflictedFiles: string[];
  message: string;
}

export interface MergeWorkItemRequest {
  destinationBranch?: string;
  delegateConflictsToAgent?: boolean;
}

export interface MergeWorkItemResponse {
  workItem: WorkItem;
  merge: MergeResult;
  triggeredRunIds: string[];
}

// ── Lifecycle gate markers ──

export interface LifecycleGateFailure {
  workflowName: string;
  status: string;
  error: string | null;
  runId: string | null;
}

export interface LifecycleGateMarker {
  targetStatus: WorkItemStatus;
  hook: "before";
  status: "held";
  heldAt: string;
  failures: LifecycleGateFailure[];
}

export type WorkItemLiveState =
  | "idle"
  | "queued"
  | "running"
  | "awaiting-input"
  | "error"
  | "blocked"
  | "completed";
