import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  SUPPORTED_WORK_ITEM_STATUSES,
  buildTransitionPayload,
  clearGateMetadata,
  mergeGateHeldMetadata,
  runTransitionGate,
  toWorkItemRecord,
} from "./work-item.service.helpers";
import { resolveRepositoryIntegrationSettings } from "@nexus/kanban-contracts";
import { getDependencyIds, requireWorkItem } from "./work-item-run.helpers";
import { ignoreFailVisibleLifecycleEventDeliveryError } from "./kanban-lifecycle-event-publisher";
import type { WorkItemRecord } from "./work-item.types";
import type {
  TransitionStatusDeps,
  TransitionStatusParams,
} from "./work-item-transition.types";

export async function transitionWorkItemStatus(
  deps: TransitionStatusDeps,
  params: TransitionStatusParams,
): Promise<WorkItemRecord> {
  const { project_id, workItemId, status } = params;
  const { workItems, projects, coreClient } = deps;
  const item = await requireWorkItem(project_id, workItemId, workItems);

  if (!SUPPORTED_WORK_ITEM_STATUSES.has(status)) {
    throw new BadRequestException(`Invalid work item status: ${status}`);
  }

  if (item.status === status) {
    return toWorkItemRecord(item, await getDependencyIds(item.id, workItems));
  }

  const previousStatus = item.status;

  const gate = await runTransitionGate({
    project_id,
    workItemId,
    targetStatus: status,
    hook: "before",
    blocking: true,
    projects,
    coreClient,
    payload: buildTransitionPayload({
      item,
      fromStatus: previousStatus,
      toStatus: status,
      hook: "before",
    }),
  });

  if (gate.blocked) {
    const heldMetadata = mergeGateHeldMetadata({
      metadata: item.metadata,
      targetStatus: status,
      heldAt: new Date().toISOString(),
      failures: gate.failures,
    });
    await workItems.save({ ...item, metadata: heldMetadata });
    const summary = gate.failures
      .map(
        (f) =>
          `${f.workflowName}: ${f.status}${f.error ? ` (${f.error})` : ""}`,
      )
      .join("; ");
    throw new ConflictException({
      code: "LIFECYCLE_GATE_BLOCKED",
      message: `Transition to ${status} blocked: ${summary}`,
      gate: { targetStatus: status, failures: gate.failures },
    });
  }

  const clearedMetadata = clearGateMetadata(item.metadata);
  const updated = await workItems.save({
    ...item,
    status,
    metadata: clearedMetadata,
  });

  const dependencies = await getDependencyIds(updated.id, workItems);
  const resource = toWorkItemRecord(updated, dependencies);

  const project = await projects.findById(project_id);
  const integration = resolveRepositoryIntegrationSettings(
    project?.repository_workflow_settings,
  );

  await deps.lifecycleEventPublisher
    .emitStatusChanged({
      projectId: project_id,
      workItemId,
      status,
      previousStatus,
      actor: params.actor,
      updatedAt: updated.updated_at.toISOString(),
      resource,
      integration,
      repositoryUrl: project?.repository_url,
      githubSecretId: project?.github_secret_id,
    })
    .catch(ignoreFailVisibleLifecycleEventDeliveryError);

  deps.realtimeGateway.broadcastWorkItemUpdated(project_id, resource, []);

  // Fire-and-forget — best effort; publisher handles errors internally
  void deps.realtimePublisher.publish(project_id, resource);

  void runTransitionGate({
    project_id,
    workItemId,
    targetStatus: status,
    hook: "after",
    blocking: false,
    projects,
    coreClient,
    payload: buildTransitionPayload({
      item: updated,
      fromStatus: previousStatus,
      toStatus: status,
      hook: "after",
    }),
  }).catch((err: unknown) => {
    console.error(`after-hook for ${workItemId} → ${status} failed:`, err);
  });

  return resource;
}
