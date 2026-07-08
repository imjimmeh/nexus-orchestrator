import { randomUUID } from "node:crypto";
import type {
  BaseRequestContextService,
  RuntimeToolchainConfig,
} from "@nexus/core";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { resolveKanbanExternalMcpMounts } from "../mcp/kanban-mcp-run-mounts";
import { buildDispatchWorkItemTriggerInput } from "./dispatch-work-item-trigger";
import type {
  DependencyRecord,
  WorkItemRecord,
} from "./dispatch-internal.types";
import type { WorkflowRunAcceptedV1, WorkflowRunRequestV1 } from "@nexus/core";

/**
 * Appends the neutral `runtime_toolchains` launch input from a loaded
 * project's `runtime_toolchains` column onto a base launch-inputs record.
 * The field is omitted entirely (not set to `null`/`undefined`) when the
 * project carries no runtime toolchain config, so the API-side run-input
 * parser (Task 16/17) can treat "key absent" as "no run-input override"
 * consistently with the other precedence layers.
 */
export function buildLaunchInputsWithToolchains(params: {
  base: Record<string, unknown>;
  project?: { runtime_toolchains?: RuntimeToolchainConfig | null } | null;
}): Record<string, unknown> {
  return params.project?.runtime_toolchains
    ? { ...params.base, runtime_toolchains: params.project.runtime_toolchains }
    : { ...params.base };
}

/**
 * Resolves the correlation id used for dispatch-launched workflow runs.
 * Falls back to a freshly-generated UUID when the request context has no id.
 */
export function resolveCorrelationId(
  requestContext: BaseRequestContextService,
): string {
  return requestContext.getRequestId() ?? randomUUID();
}

/**
 * Builds the WorkflowRunRequestV1 emitted when dispatching a work item.
 *
 * `causationIdScope` is an opt-in modifier used by the selected-dispatch path
 * to preserve its historical `:selected:` causation-id prefix (the ready path
 * uses an unprefixed template). The idempotency-key format is identical for
 * both call sites.
 */
export function buildRunRequest(params: {
  requestContext: BaseRequestContextService;
  projectId: string;
  workflowId: string;
  item: WorkItemRecord;
  dependencyIds: string[];
  requestedBy?: string;
  causationIdScope?: "selected";
  /** Loaded project, consulted for its `runtime_toolchains` column (Task 16). */
  project?: { runtime_toolchains?: RuntimeToolchainConfig | null } | null;
}): WorkflowRunRequestV1 {
  const correlationId = resolveCorrelationId(params.requestContext);
  const causationIdPrefix = params.causationIdScope
    ? `kanban:dispatch:${params.causationIdScope}`
    : "kanban:dispatch";
  const causationId =
    params.requestContext.getCausationId() ??
    `${causationIdPrefix}:${params.projectId}:${params.item.id}`;

  const externalMcpMounts = resolveKanbanExternalMcpMounts();

  return {
    workflow_id: params.workflowId,
    input: buildLaunchInputsWithToolchains({
      base: buildDispatchWorkItemTriggerInput(
        params.projectId,
        params.item,
        params.dependencyIds,
      ),
      project: params.project,
    }),
    launch_source: "kanban_dispatch",
    context: {
      scopeId: null,
      contextId: params.projectId,
      contextType: "kanban.project",
      metadata: { work_item_id: params.item.id },
      scopeNodeId: null,
      scopePath: null,
    },
    metadata: {
      correlation_id: correlationId,
      causation_id: causationId,
      idempotency_key: `kanban:dispatch:${params.projectId}:${params.item.id}`,
      requested_by: params.requestedBy ?? null,
    },
    ...(externalMcpMounts ? { external_mcp_mounts: externalMcpMounts } : {}),
  };
}

/**
 * Persists the linked-run mutation for a dispatched work item and verifies the
 * database confirms the new linked_run_id / current_execution_id / status.
 *
 * Race-safe linking is done via a conditional UPDATE (`linkRunIfUnlinked`)
 * that claims the slot only when both link columns are currently null, then
 * the status projection is applied via a follow-up save. If the second save
 * fails the in-memory `item` snapshot is already mutated by the caller, so
 * the dispatched-run claim survives the failure (see
 * "keeps accepted runs claimed when local confirmation fails").
 *
 * The caller is responsible for any in-memory mutations of `item` it wants
 * to remain visible when persistence fails.
 */
export async function linkAcceptedRun(
  workItems: KanbanWorkItemRepository,
  item: WorkItemRecord,
  accepted: WorkflowRunAcceptedV1,
): Promise<WorkItemRecord> {
  const linked = await workItems.linkRunIfUnlinked({
    project_id: item.project_id,
    workItemId: item.id,
    runId: accepted.run_id,
  });
  if (!linked) {
    throw new Error(`Work item ${item.id} is already linked to a workflow run`);
  }

  const saved = (await workItems.save({
    ...item,
    status: "in-progress",
    linked_run_id: accepted.run_id,
    current_execution_id: accepted.run_id,
  })) as WorkItemRecord;

  if (
    saved.linked_run_id !== accepted.run_id ||
    saved.current_execution_id !== accepted.run_id ||
    saved.status !== "in-progress"
  ) {
    throw new Error(
      `Dispatch mutation was not confirmed for work item ${item.id}`,
    );
  }

  return saved;
}

/**
 * Re-export of the dependency record type so consumers of run-link helpers
 * can import a stable surface from this module.
 */
export type { DependencyRecord };
