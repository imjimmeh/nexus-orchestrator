import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import type { KanbanWorkItemSubtaskEntity } from "../database/entities/kanban-work-item-subtask.entity";
import type { KanbanWorkItemEntity } from "../database/entities/kanban-work-item.entity";
import type { BaseRequestContextService } from "@nexus/core";
import type { WorkItemType } from "@nexus/kanban-contracts";
import type { KanbanSettingsService } from "../settings/kanban-settings.service";
import type { WorkItemRunLeaseService } from "./work-item-run-lease";
import type { WorkItemRecord, WorkItemStatus } from "./work-item.types";

export interface WorkflowRunListItem {
  id: string;
  workflow_id: string;
  status: string;
  current_step_id?: string | null;
  state_variables: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type CoreWorkflowRequester = Pick<
  CoreWorkflowClientService,
  | "requestWorkflowRun"
  | "executeLifecycleWorkflows"
  | "commitPaths"
  | "listWorkflowRuns"
  | "deleteRepoFile"
  | "writeRepoFile"
>;

export type WorkItemEntityRecord = Pick<
  KanbanWorkItemEntity,
  | "id"
  | "project_id"
  | "title"
  | "status"
  | "linked_run_id"
  | "description"
  | "priority"
  | "type"
  | "parent_work_item_id"
  | "story_points"
  | "assigned_agent_id"
  | "token_spend"
  | "cost_cents"
  | "current_execution_id"
  | "waiting_for_input"
  | "last_execution_status"
  | "execution_config"
  | "metadata"
  | "created_at"
  | "updated_at"
>;

export type WorkItemSubtaskRecord = Pick<
  KanbanWorkItemSubtaskEntity,
  | "id"
  | "subtask_id"
  | "work_item_id"
  | "title"
  | "status"
  | "order_index"
  | "depends_on_subtask_ids"
  | "source_path"
  | "metadata"
  | "updated_at"
>;

export type NormalizedSubtaskInput = {
  subtaskId: string;
  title: string;
  status?: string;
  orderIndex?: number;
  dependsOnSubtaskIds?: string[];
  sourcePath?: string;
  metadata?: Record<string, unknown> | null;
};

export type WorkItemPatch = {
  title?: string;
  description?: string | null;
  priority?: string;
  type?: WorkItemType;
  parentWorkItemId?: string | null;
  storyPoints?: number | null;
  dependencyIds?: string[];
  executionConfig?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  subtasks?: NormalizedSubtaskInput[];
};

export type HumanFeedbackResolutionInput = {
  response: string;
  resolvedBy?: string;
};

export type WorkItemRunParams = {
  project_id: string;
  workItemId: string;
  workflowId: string;
  launchSource: string;
  requestedBy?: string;
  idempotencyKey: string;
  action: "dispatch" | "review" | "merge";
  decision?: "approve" | "reject";
  feedback?: string;
};

/**
 * Dependencies for `requestWorkItemRun`. Bundled into a struct so the
 * body of `requestWorkItemRun` can live in `work-item-run.helpers.ts`
 * and stay unit-testable without spinning up a Nest module.
 *
 * `kanbanSettings` is required so the helper can read the
 * `work_item_run_lease_enabled` rollback flag (the one-line feature
 * flag documented in ADR-20260623-work-item-run-link-lease.md and
 * `apps/kanban/README.md#race-safe-work-item-run-linking`). When the
 * flag is `false`, the helper short-circuits the lease acquire/release
 * and falls back to the pre-ADR conditional `linkRunIfUnlinked` UPDATE
 * only.
 */
export interface RequestWorkItemRunDeps {
  readonly workItems: KanbanWorkItemRepository;
  readonly coreClient: CoreWorkflowRequester;
  readonly requestContext: BaseRequestContextService;
  readonly runLeaseService: WorkItemRunLeaseService;
  readonly kanbanSettings: KanbanSettingsService;
  readonly transitionStatus: (params: {
    project_id: string;
    workItemId: string;
    status: WorkItemStatus;
    actor: string;
  }) => Promise<WorkItemRecord>;
}
