import type { WorkflowRunStatus } from "@nexus/core";
import type { OrphanReconciliationEntry } from "./orphan-work-item-reconciliation.types";

export type DispatchReadyWorkItemsInput = {
  project_id: string;
  workflowId: string;
  requestedBy?: string;
  limit?: number;
  maxConcurrentPerAgent?: number;
  maxActivePerProject?: number;
  reconcileRunStatus?: boolean;
};

export type DispatchResult = {
  dispatched: Array<{
    workItemId: string;
    runId: string;
    linkedRunId: string;
    currentExecutionId: string | null;
    status: string;
    idempotent: boolean;
    mutationConfirmed: true;
  }>;
  skipped: Array<{
    workItemId: string;
    reason:
      | "dependencies_not_ready"
      | "agent_capacity_reached"
      | "already_active"
      | "core_status_unavailable"
      | "not_dispatchable_status"
      | "container_not_dispatchable"
      | "work_item_not_found"
      | "work_item_cross_project"
      | "work_item_already_dispatched"
      | "target_branch_already_dispatched"
      | "concurrency_exceeded"
      | "dispatch_slot_limit_reached"
      | "project_wip_limit_reached"
      | "dispatch_failed"
      | "target_files_contention_detected"
      | "refinement_required";
    status?: string;
    detail?: string;
  }>;
  reconciled: Array<{
    workItemId: string;
    runId: string;
    status: WorkflowRunStatus;
  }>;
  orphanReconciled: OrphanReconciliationEntry[];
};

export type DispatchRunReconciliationSummary = Pick<
  DispatchResult,
  "reconciled" | "skipped" | "orphanReconciled"
>;

export type DispatchSelectedWorkItemsInput = {
  projectId: string;
  workItemIds: string[];
  workflowId: string;
  requestedBy?: string;
  maxConcurrentPerAgent?: number;
  maxActivePerProject?: number;
  slots?: number;
};
