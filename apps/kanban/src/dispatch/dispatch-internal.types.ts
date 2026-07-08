import type { BaseRequestContextService, WorkflowRunStatus } from "@nexus/core";
import type { WorkItemStatus } from "@nexus/kanban-contracts";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import type { KanbanWorkItemDependencyEntity } from "../database/entities/kanban-work-item-dependency.entity";
import type { KanbanWorkItemEntity } from "../database/entities/kanban-work-item.entity";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import type { WorkItemRunLeaseService } from "../work-item/work-item-run-lease";

export type CoreDispatchClient = Pick<
  CoreWorkflowClientService,
  "requestWorkflowRun" | "getWorkflowRunStatus" | "emitDomainEventOrThrow"
>;

export type WorkItemRecord = Pick<
  KanbanWorkItemEntity,
  | "id"
  | "project_id"
  | "title"
  | "status"
  | "priority"
  | "type"
  | "parent_work_item_id"
  | "assigned_agent_id"
  | "linked_run_id"
  | "execution_config"
  | "metadata"
  | "created_at"
  | "updated_at"
> &
  Partial<KanbanWorkItemEntity>;

export type DependencyRecord = Pick<
  KanbanWorkItemDependencyEntity,
  "work_item_id" | "depends_on_work_item_id"
>;

/**
 * Shared dependency shape for the dispatch funnel
 * (`DispatchService.dispatchReadyWorkItems` /
 * `dispatchSelectedWorkItems`). Bundled into a struct so the selected
 * batch path can be unit-tested in isolation. The `runLeaseService`
 * port is the same `WorkItemRunLeaseService` exported by
 * `WorkItemModule`; the selected-batch `linkAcceptedRun` acquires the
 * same `(project_id, work_item_id)` lease (action: `dispatch_selected`)
 * as `DispatchService.linkAcceptedRun` so concurrent writers on the same
 * tuple share the race-safety barrier described in
 * ADR-20260623.
 */
export type DispatchServiceDeps = {
  coreClient: CoreDispatchClient;
  requestContext: BaseRequestContextService;
  workItems: KanbanWorkItemRepository;
  runLeaseService: WorkItemRunLeaseService;
  workItemService?: {
    updateStatus: (
      projectId: string,
      workItemId: string,
      status: WorkItemStatus,
    ) => Promise<unknown>;
  };
};

export const TERMINAL_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
