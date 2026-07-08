import { randomUUID } from "node:crypto";
import type { CoreWorkflowEventEnvelopeV1Shape } from "@nexus/core";
import {
  isRealWorkItemId,
  resolveProjectIdFromContext,
  resolveWorkItemIdFromContext,
  toTerminalWorkflowStatus,
} from "./core-lifecycle-stream.helpers";
import type { LinkWorkItemRunFromLifecycleEventDeps } from "./core-lifecycle-stream-work-item-link.types";

/**
 * Project a non-terminal core workflow run event onto its work item by
 * setting `linked_run_id` and `current_execution_id`.
 *
 * The link is wrapped in the same per-work-item orchestration lease as
 * `WorkItemService.requestWorkItemRun` (action: `lifecycle_link`).
 * The lease closes the F2/F4 boundary described in the work-item README:
 * a concurrent dispatch funnel call holds the lease, the projection
 * observer surfaces a deterministic `acquired: false` and emits a
 * structured WARN log, and the next polled event (or the conditional
 * `linkRunIfUnlinked` UPDATE) re-attempts the link. The release is in
 * a `finally` so a thrown `linkRunIfUnlinked` does not strand the lease.
 *
 * If the lease is already held, we deliberately do *not* dead-letter:
 * the caller advances its cursor and the next event will retry the
 * link. The row-level conditional UPDATE in `linkRunIfUnlinked` still
 * guards correctness when the holder commits in between.
 */
export async function linkWorkItemRunFromLifecycleEvent(
  deps: LinkWorkItemRunFromLifecycleEventDeps,
  envelope: CoreWorkflowEventEnvelopeV1Shape,
): Promise<void> {
  if (!envelope.event_type.startsWith("core.workflow.run.")) {
    return;
  }

  if (toTerminalWorkflowStatus(envelope.payload.status)) {
    return;
  }

  const context = envelope.payload.context;
  const projectId = resolveProjectIdFromContext(context);
  const workItemId = resolveWorkItemIdFromContext(context);
  if (!projectId || !isRealWorkItemId(workItemId)) {
    return;
  }

  const ownerId = deps.workItemRunLeaseService.deriveOwnerId(
    projectId,
    workItemId,
    "lifecycle_link",
  );
  const correlationId =
    envelope.correlation_id && envelope.correlation_id.length > 0
      ? envelope.correlation_id
      : randomUUID();
  let acquired = false;
  try {
    const lease = await deps.workItemRunLeaseService.acquireRunLease({
      projectId,
      workItemId,
      action: "lifecycle_link",
      ownerId: `${ownerId}:${correlationId}`,
    });
    acquired = lease.acquired;
    if (!lease.acquired) {
      deps.logger.warn(
        `Skipping lifecycle-projection link for work item ${workItemId}: per-work-item run lease is held by another writer (heldByOwnerId=${lease.conflicts[0]?.heldByOwnerId ?? "unknown"}, run=${envelope.payload.run_id})`,
      );
      return;
    }

    const linked = await deps.workItems.linkRunIfUnlinked({
      project_id: projectId,
      workItemId,
      runId: envelope.payload.run_id,
    });

    if (linked) {
      deps.logger.log(
        `Linked work item ${workItemId} to workflow run ${envelope.payload.run_id}`,
      );
    }
  } finally {
    if (acquired) {
      try {
        await deps.workItemRunLeaseService.releaseRunLease(projectId, ownerId);
      } catch (error) {
        deps.logger.warn(
          `Failed to release lifecycle_link lease for work item ${workItemId} (run=${envelope.payload.run_id}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}