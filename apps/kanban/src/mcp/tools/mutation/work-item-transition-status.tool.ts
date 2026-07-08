import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { WorkItemStatusSchema } from "@nexus/kanban-contracts";
import type { InternalToolExecutionContext } from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import {
  readRefinementRoutingMeta,
  resolvePromotionReroute,
} from "../../../work-item/work-item-preflight-routing.helper";
import {
  isProjectDispatchActiveContractItem,
  PROJECT_DISPATCH_ACTIVE_STATUSES,
  resolveProjectDispatchCapacityForContractItems,
} from "../../../dispatch/project-dispatch-capacity";
import type { ProjectDispatchCapacity } from "../../../dispatch/project-dispatch-capacity.types";
import { OrchestrationDecisionExecutorService } from "../../../orchestration/control-plane/orchestration-decision-executor.service";
import { OrchestrationFactSnapshotService } from "../../../orchestration/control-plane/orchestration-fact-snapshot.service";
import { KanbanSettingsService } from "../../../settings/kanban-settings.service";
import { WorkItemService } from "../../../work-item/work-item.service";
import type {
  WorkItemRecord,
  WorkItemStatus,
} from "../../../work-item/work-item.types";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const NormalizedWorkItemStatusSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.replaceAll("_", "-") : value),
  WorkItemStatusSchema,
);

const StatusSchema = ContextualWorkItemIdSchema.extend({
  status: NormalizedWorkItemStatusSchema,
});

interface StatusParams {
  project_id?: string | null;
  workItemId: string;
  status: WorkItemStatus;
}

@Injectable()
export class WorkItemTransitionStatusTool extends KanbanTool<
  StatusParams,
  unknown
> {
  constructor(
    private readonly workItems: WorkItemService,
    private readonly decisionExecutor: OrchestrationDecisionExecutorService,
    private readonly factSnapshot: OrchestrationFactSnapshotService,
    private readonly kanbanSettings: KanbanSettingsService,
  ) {
    super("kanban.work_item_transition_status", {
      name: "kanban.work_item_transition_status",
      description: "Transition a kanban work item status.",
      inputSchema: StatusSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: StatusParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const status = WorkItemStatusSchema.parse(
      params.status.replaceAll("_", "-"),
    );

    // Preflight: read current state and publish fact for scheduler
    const projectWorkItems = await this.workItems.listWorkItems(projectId);
    const currentItem = projectWorkItems.find(
      (item) => item.id === params.workItemId,
    );
    if (!currentItem) {
      throw new NotFoundException(
        `Work item ${params.workItemId} not found for project ${projectId}`,
      );
    }
    await this.factSnapshot.publishWorkItemState({
      projectId,
      workItemId: params.workItemId,
      currentStatus: currentItem.status,
    });

    const preflightEnabled = await this.kanbanSettings.getBoolean(
      "work_item_preflight_pipeline_enabled",
    );
    const refinementMeta = readRefinementRoutingMeta(
      (currentItem as { metadata?: unknown }).metadata,
    );
    const reroute = resolvePromotionReroute({
      currentStatus: currentItem.status,
      requestedStatus: status,
      hasClearedRefinementOnce: refinementMeta.hasClearedRefinementOnce,
      preflightEnabled,
    });
    const effectiveStatus = reroute.effectiveStatus;

    const capacitySnapshot = await this.resolveCapacitySnapshotIfNeeded(
      projectWorkItems,
      currentItem,
      effectiveStatus,
    );
    if (capacitySnapshot && !capacitySnapshot.canLaunchNewWork) {
      throw new BadRequestException(
        `Project WIP limit reached: activeCount=${capacitySnapshot.activeCount}, maxActive=${capacitySnapshot.maxActive}, availableSlots=${capacitySnapshot.availableSlots}, reason=project_wip_limit_reached`,
      );
    }

    return this.decisionExecutor.executeDirectMutationDecision({
      projectId,
      requester: "kanban.work_item_transition_status",
      failureMetadata: {
        workItemId: params.workItemId,
        status: effectiveStatus,
        ...(capacitySnapshot
          ? {
              activeCount: capacitySnapshot.activeCount,
              maxActive: capacitySnapshot.maxActive,
              availableSlots: capacitySnapshot.availableSlots,
            }
          : {}),
      },
      structuredDecision: {
        action: "transition_work_item_status",
        lane: "work_item_transition",
        intent_type: "validate_project_health",
        reason: `Transition ${params.workItemId} to ${effectiveStatus}`,
        work_item_ids: [params.workItemId],
        target_status: effectiveStatus,
        evidence: [{ kind: "tool_result", id: "transition-status-input" }],
      },
      execute: () =>
        this.workItems.updateStatus(
          projectId,
          params.workItemId,
          effectiveStatus,
        ),
    });
  }

  private async resolveCapacitySnapshotIfNeeded(
    projectWorkItems: WorkItemRecord[],
    currentItem: WorkItemRecord,
    targetStatus: WorkItemStatus,
  ): Promise<ProjectDispatchCapacity | null> {
    if (!PROJECT_DISPATCH_ACTIVE_STATUSES.has(targetStatus)) {
      return null;
    }
    if (isProjectDispatchActiveContractItem(currentItem)) {
      return null;
    }

    const maxActive = await this.kanbanSettings.getNumber(
      "work_item_dispatch_max_active_per_project",
    );
    return resolveProjectDispatchCapacityForContractItems(
      projectWorkItems,
      maxActive,
    );
  }
}
