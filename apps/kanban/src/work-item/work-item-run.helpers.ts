import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isDispatchable, type WorkItemType } from "@nexus/kanban-contracts";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import {
  buildWorkflowRunRequest,
  isRecord,
  toWorkItemRecord,
  normalizeSubtaskInput,
} from "./work-item.service.helpers";
import type { WorkItemRunRequestResult } from "./work-item.types";
import type {
  RequestWorkItemRunDeps,
  WorkItemEntityRecord,
  WorkItemPatch,
  WorkItemRunParams,
  WorkItemSubtaskRecord,
} from "./work-item.service.types";
import { WorkItemRunLeaseService } from "./work-item-run-lease";

/**
 * Setting key for the per-work-item orchestration lease rollback flag.
 * The flag defaults to `true` (lease enabled) and can be flipped to
 * `false` via the standard kanban settings API to short-circuit the
 * lease acquire/release in `requestWorkItemRun` and fall back to the
 * pre-ADR conditional `linkRunIfUnlinked` UPDATE only. See
 * `ADR-20260623-work-item-run-link-lease.md` (Rollback) and the
 * runbook entry in `docs/operations/README.md#work-item-run-link-lease-contention`.
 */
export const WORK_ITEM_RUN_LEASE_ENABLED_SETTING_KEY =
  "work_item_run_lease_enabled";

export async function requireWorkItem(
  project_id: string,
  workItemId: string,
  workItems: KanbanWorkItemRepository,
): Promise<WorkItemEntityRecord> {
  const item = await workItems.findByProjectAndId(project_id, workItemId);
  if (item) {
    return item;
  }
  throw new NotFoundException(
    `Work item ${workItemId} not found for project ${project_id}`,
  );
}

/**
 * Container guard for the manual/API-triggered "dispatch" action: an
 * epic (a pure container) or an item that currently has children (a
 * container by structure) must never be dispatched. Mirrors the core
 * P0 invariant enforced in the automated dispatch loop (`isDispatchable`
 * in `@nexus/kanban-contracts`'s `work-item-type.rules.ts`, consulted by
 * `dispatch-container.helper.ts`).
 * Scoped to `requestWorkItemRun`'s "dispatch" action only — "review" and
 * "merge" operate on items already in flight and are unaffected.
 */
export async function assertDispatchable(
  item: WorkItemEntityRecord,
  workItemId: string,
  workItems: KanbanWorkItemRepository,
): Promise<void> {
  const childrenParentIds = await workItems.existsChildrenFor([item.id]);
  const hasChildren = childrenParentIds.has(item.id);
  if (isDispatchable(item.type as WorkItemType, hasChildren)) {
    return;
  }
  throw new BadRequestException(
    `Work item ${workItemId} cannot be dispatched: ${
      item.type === "epic" ? "epics" : "items with children"
    } are not dispatchable`,
  );
}

export async function getDependencyIds(
  workItemId: string,
  workItems: KanbanWorkItemRepository,
): Promise<string[]> {
  const dependencies = await workItems.findDependenciesByWorkItemIds([
    workItemId,
  ]);
  return dependencies.map((dependency) => dependency.depends_on_work_item_id);
}

export async function replaceSubtasksFromInput(
  project_id: string,
  workItemId: string,
  input: unknown[] | undefined,
  workItems: KanbanWorkItemRepository,
): Promise<WorkItemSubtaskRecord[]> {
  if (!input) return workItems.findSubtasksByWorkItemIds([workItemId]);
  return workItems.replaceSubtasks(
    project_id,
    workItemId,
    normalizeSubtaskInput(input).map((subtask, index) => ({
      subtask_id: subtask.subtaskId,
      title: subtask.title,
      status: subtask.status ?? "todo",
      order_index: subtask.orderIndex ?? index,
      depends_on_subtask_ids: subtask.dependsOnSubtaskIds ?? [],
      source_path: subtask.sourcePath ?? "",
      metadata: subtask.metadata ?? null,
    })),
  );
}

/**
 * Promoting an item to `epic` while it still carries a parent from before
 * the promotion must atomically detach it in the same save — an epic can
 * never have a parent (invariant #5, `work-item-invariants.ts`). Mutates
 * `patch.parentWorkItemId` to `null` in place so both the subsequent
 * `assertWorkItemInvariants` call and `applyPatchToWorkItem` see the
 * cleared parent. Only auto-detaches when the caller didn't already
 * explicitly set `parentWorkItemId` themselves — an explicit non-null
 * `parentWorkItemId` alongside `type: "epic"` still hits the "an epic
 * cannot have a parent" rejection in `assertWorkItemInvariants`. Extracted
 * out of `WorkItemService.updateWorkItem` to keep that method's cyclomatic
 * complexity under the repo lint ceiling.
 */
export function detachParentOnEpicPromotion(
  item: WorkItemEntityRecord,
  patch: WorkItemPatch,
  effectiveType: WorkItemType,
): void {
  if (
    effectiveType === "epic" &&
    item.parent_work_item_id != null &&
    patch.parentWorkItemId === undefined
  ) {
    patch.parentWorkItemId = null;
  }
}

export function applyPatchToWorkItem(
  item: WorkItemEntityRecord,
  patch: WorkItemPatch,
): WorkItemEntityRecord {
  const updated = { ...item };
  if (patch.title) updated.title = patch.title;
  if ("description" in patch) updated.description = patch.description ?? null;
  if (patch.priority) updated.priority = patch.priority;
  if (patch.type) updated.type = patch.type;
  if ("parentWorkItemId" in patch)
    updated.parent_work_item_id = patch.parentWorkItemId ?? null;
  if ("storyPoints" in patch) updated.story_points = patch.storyPoints ?? null;
  if ("executionConfig" in patch)
    updated.execution_config = patch.executionConfig ?? null;
  if ("metadata" in patch) updated.metadata = patch.metadata ?? null;
  return updated;
}

export function buildApproveItemMetadata(
  metadata: unknown,
): Record<string, unknown> {
  return {
    ...(isRecord(metadata) ? metadata : {}),
    qa_decision: "approve",
  };
}

export function buildRejectItemMetadata(
  metadata: unknown,
  feedback: string | undefined,
  decision: string,
): Record<string, unknown> {
  return {
    ...(isRecord(metadata) ? metadata : {}),
    ...(feedback ? { qa_rejection_feedback: feedback } : {}),
    qa_decision: decision,
  };
}

export async function buildWorkItemRunResult(
  project_id: string,
  workItemId: string,
  accepted: { run_id: string; workflow_id: string },
  workItems: KanbanWorkItemRepository,
): Promise<WorkItemRunRequestResult> {
  const updated = await requireWorkItem(project_id, workItemId, workItems);
  return {
    workItem: toWorkItemRecord(
      updated,
      await getDependencyIds(updated.id, workItems),
      await workItems.findSubtasksByWorkItemIds([updated.id]),
    ),
    run_id: accepted.run_id,
    workflow_id: accepted.workflow_id,
  };
}

/**
 * Run the per-work-item orchestration lease → mutate → link →
 * assert-invariant → release-lease sequence for `WorkItemService`.
 *
 * Owner id is derived deterministically from
 * (project_id, workItemId, action, requestId) before any read; the lease
 * row owner id is the 3-tuple (project, workItem, action) so concurrent
 * writers on the same tuple share it. A losing acquire short-circuits
 * before any DB read or `coreClient.requestWorkflowRun` call, closing
 * the F1/F2 windows enumerated in the work-item README and
 * ADR-20260623. The try/finally guarantees the lease is released even
 * on the F6 partial-write window where `linkRunIfUnlinked` returns
 * false.
 */
export async function requestWorkItemRun(
  deps: RequestWorkItemRunDeps,
  params: WorkItemRunParams,
): Promise<WorkItemRunRequestResult> {
  // Step 0: read the rollback feature flag once at the top. When
  // `work_item_run_lease_enabled` is `false`, the per-work-item lease
  // acquire/release is short-circuited and the path falls back to the
  // pre-ADR conditional `linkRunIfUnlinked` UPDATE only. The flag is
  // documented in `ADR-20260623-work-item-run-link-lease.md` (Rollback)
  // and the runbook at
  // `docs/operations/README.md#work-item-run-link-lease-contention`.
  // The setting is read with a `true` fallback so a misconfigured
  // database (missing row, corrupted value) defaults to the safe —
  // i.e. lease-protected — behaviour.
  const leaseEnabled = await deps.kanbanSettings.getBoolean(
    WORK_ITEM_RUN_LEASE_ENABLED_SETTING_KEY,
  );

  // Step 1: build the caller's owner id deterministically before any read.
  // The lease wrapper derives its own lease row owner id from the first
  // three, so concurrent writers on the same tuple share the lease id.
  const requestId = deps.requestContext.getRequestId() ?? randomUUID();
  const ownerId = `${WorkItemRunLeaseService.OWNER_ID_PREFIX}:${params.project_id}:${params.workItemId}:${params.action}:${requestId}`;

  // Step 2: acquire the per-work-item lease. Losing acquire short-circuits
  // before any DB read or coreClient.requestWorkflowRun (F1/F2 windows).
  // The acquire is skipped entirely when the rollback flag is off, so
  // flipping the flag returns the path to the pre-ADR behaviour
  // (conditional `linkRunIfUnlinked` UPDATE only) without a code
  // change.
  if (leaseEnabled) {
    const acquireResult = await deps.runLeaseService.acquireRunLease({
      projectId: params.project_id,
      workItemId: params.workItemId,
      action: params.action,
      ownerId,
    });
    if (!acquireResult.acquired) {
      throw new ConflictException(
        `Work item ${params.workItemId} is already being launched (held by another writer)`,
      );
    }
  }

  try {
    let item = await requireWorkItem(
      params.project_id,
      params.workItemId,
      deps.workItems,
    );

    if (params.action === "dispatch") {
      await assertDispatchable(item, params.workItemId, deps.workItems);
    }

    if (params.action === "review") {
      if (params.decision === "approve") {
        // Gate entry into ready-to-merge (pre-merge checks live here per spec D4).
        await deps.transitionStatus({
          project_id: params.project_id,
          workItemId: params.workItemId,
          status: "ready-to-merge",
          actor: "system",
        });
        // Re-fetch after the status change to get the latest persisted state.
        item = await requireWorkItem(
          params.project_id,
          params.workItemId,
          deps.workItems,
        );
        await deps.workItems.save({
          ...item,
          metadata: buildApproveItemMetadata(item.metadata),
        });
      } else {
        await deps.workItems.save({
          ...item,
          status: "in-progress",
          metadata: buildRejectItemMetadata(
            item.metadata,
            params.feedback,
            params.decision ?? "reject",
          ),
        });
      }
    }

    const accepted = await deps.coreClient.requestWorkflowRun(
      buildWorkflowRunRequest({
        ...params,
        correlationId: deps.requestContext.getRequestId(),
        causationId: deps.requestContext.getCausationId(),
        executionConfig: item.execution_config ?? undefined,
      }),
    );

    // Step 4: race-safe link. Conditional UPDATE only commits when both link
    // columns are null; a losing UPDATE matches zero rows and we surface a
    // deterministic ConflictException (F6 partial-write window). This
    // guard is the only race-safety barrier on the rollback path
    // (`work_item_run_lease_enabled = false`).
    const linked = await deps.workItems.linkRunIfUnlinked({
      project_id: params.project_id,
      workItemId: params.workItemId,
      runId: accepted.run_id,
    });
    if (!linked) {
      throw new ConflictException(
        `Work item ${params.workItemId} is already linked to a workflow run`,
      );
    }

    // Step 5: re-read with a pessimistic_write row lock and assert
    // linked_run_id === current_execution_id === accepted.run_id. If the
    // post-link row disagrees the lease-protected write path is leaking
    // state and we surface a deterministic conflict.
    const reloaded = await deps.workItems.findByProjectAndIdForUpdate(
      params.project_id,
      params.workItemId,
    );
    if (
      !reloaded ||
      reloaded.linked_run_id !== accepted.run_id ||
      reloaded.current_execution_id !== accepted.run_id
    ) {
      throw new ConflictException(
        `Work item ${params.workItemId} failed the post-link invariant: linked_run_id / current_execution_id does not match the accepted run`,
      );
    }

    return await buildWorkItemRunResult(
      params.project_id,
      params.workItemId,
      accepted,
      deps.workItems,
    );
  } finally {
    // Step 6: release-on-finally. releaseRunLease is a no-op when no lease
    // is held, so the ConflictException short-circuits above and the early
    // requireWorkItem miss both stay safe. The id we pass is the
    // deterministic 3-tuple owner id, not the per-request id. The
    // release is also skipped when the rollback flag is off (no lease
    // was acquired, so there is nothing to release).
    if (leaseEnabled) {
      await deps.runLeaseService.releaseRunLease(
        params.project_id,
        deps.runLeaseService.deriveOwnerId(
          params.project_id,
          params.workItemId,
          params.action,
        ),
      );
    }
  }
}
