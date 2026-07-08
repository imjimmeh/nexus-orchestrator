import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { BaseRequestContextService } from "@nexus/core";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { KanbanWorkItemRunCostRepository } from "../database/repositories/kanban-work-item-run-cost.repository";
import type { WorkItemQueryParams } from "../database/repositories/kanban-work-item.repository.types";
import {
  listAllWorkItemRecords,
  listProjectWorkItems,
  queryPaginatedWorkItems,
} from "./work-item-pagination.helper";
import { toCreateEntity } from "./work-item.factory";
import {
  getActiveWorkItemAutomationStatuses,
  getWorkItemExecutionConfig,
  upsertWorkItemExecutionConfig,
} from "./work-item-execution-config.helper";
import { transitionWorkItemStatus } from "./work-item-transition.helper";
import type { PaginatedWorkItemRecords } from "./work-item-pagination.types";
import { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import type { WorkItemType } from "@nexus/kanban-contracts";
import { assertWorkItemInvariants } from "./work-item-invariants";
import type {
  CreateWorkItemInput,
  DispatchWorkItemInput,
  MergeWorkItemInput,
  ReviewDecisionInput,
  WorkItemRecord,
  WorkItemRunRequestResult,
  WorkItemStatus,
} from "./work-item.types";
import {
  asWorkItemPatch,
  getInputDependencyIds,
  hasLifecycleStatusInMetadata,
  resolveHumanFeedbackResolution,
  toWorkItemRecord,
  assertDependenciesExist,
} from "./work-item.service.helpers";
import { writeWorkItemSpecFile } from "./work-item-spec-file.helpers";
import {
  requireWorkItem,
  getDependencyIds,
  replaceSubtasksFromInput,
  applyPatchToWorkItem,
  detachParentOnEpicPromotion,
  requestWorkItemRun as requestWorkItemRunHelper,
} from "./work-item-run.helpers";
import type {
  CoreWorkflowRequester,
  HumanFeedbackResolutionInput,
  WorkItemRunParams,
} from "./work-item.service.types";
import {
  KanbanLifecycleEventPublisher,
  ignoreFailVisibleLifecycleEventDeliveryError,
} from "./kanban-lifecycle-event-publisher";
import { WorkItemRealtimeGateway } from "./work-item-realtime.gateway";
import { WorkItemRealtimePublisher } from "./work-item-realtime.publisher";
import { WorkItemRunLeaseService } from "./work-item-run-lease";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import { WorkItemCostEstimationService } from "./cost-estimation/work-item-cost-estimation.service";
import {
  buildWorkItemCostSummary,
  computeCostEstimateAccuracy,
} from "./work-item-cost-reporting.helpers";

@Injectable()
export class WorkItemService {
  constructor(
    @Inject(CoreWorkflowClientService)
    private readonly coreClient: CoreWorkflowRequester,
    private readonly requestContext: BaseRequestContextService,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly lifecycleEventPublisher: KanbanLifecycleEventPublisher,
    private readonly projects: KanbanProjectRepository,
    private readonly realtimePublisher: WorkItemRealtimePublisher,
    private readonly realtimeGateway: WorkItemRealtimeGateway,
    private readonly runLeaseService: WorkItemRunLeaseService,
    private readonly kanbanSettings: KanbanSettingsService,
    private readonly costEstimation: WorkItemCostEstimationService,
    private readonly runCosts: KanbanWorkItemRunCostRepository,
  ) {}

  async createWorkItem(
    project_id: string,
    input: CreateWorkItemInput,
  ): Promise<WorkItemRecord> {
    if (hasLifecycleStatusInMetadata(input.metadata)) {
      throw new BadRequestException(
        "metadata.status is not a work-item lifecycle status; use top-level status",
      );
    }

    const type = input.type ?? "story";
    const parentWorkItemId = input.parentWorkItemId ?? null;
    const storyPoints = input.storyPoints ?? null;
    assertWorkItemInvariants({
      type,
      storyPoints,
      parentType: await this.resolveParentType(project_id, parentWorkItemId),
    });

    const item = await this.workItems.save(
      toCreateEntity({
        id: input.id?.trim() || randomUUID(),
        project_id: project_id,
        title: input.title,
        status: input.status ?? "backlog",
        priority: input.priority ?? "p2",
        type,
        parent_work_item_id: parentWorkItemId,
        story_points: storyPoints,
        description: input.description ?? null,
        execution_config: input.executionConfig ?? null,
        metadata: input.metadata ?? null,
      }),
    );
    const dependencyIds = getInputDependencyIds(input);
    if (dependencyIds.length > 0) {
      await assertDependenciesExist({
        project_id,
        dependencyIds,
        workItems: this.workItems,
      });
      await this.workItems.replaceDependencies(item.id, dependencyIds);
    }
    const subtasks = await replaceSubtasksFromInput(
      project_id,
      item.id,
      input.subtasks,
      this.workItems,
    );

    await writeWorkItemSpecFile({
      project_id,
      item,
      dependencyIds,
      projects: this.projects,
      coreClient: this.coreClient,
      workItems: this.workItems,
    });

    return toWorkItemRecord(item, dependencyIds, subtasks);
  }

  async listWorkItems(
    project_id: string,
    maxWorkItems?: number,
  ): Promise<WorkItemRecord[]> {
    return listProjectWorkItems(this.workItems, project_id, maxWorkItems);
  }

  async listAllWorkItems(maxWorkItems?: number): Promise<WorkItemRecord[]> {
    return listAllWorkItemRecords(this.workItems, maxWorkItems);
  }

  async queryAllWorkItems(
    params: WorkItemQueryParams,
  ): Promise<PaginatedWorkItemRecords> {
    return queryPaginatedWorkItems(this.workItems, params);
  }

  async getWorkItemCostSummary(params: {
    limit?: number;
    projectId?: string;
  }): Promise<
    {
      id: string;
      project_id: string;
      title: string;
      status: string;
      costCents: number;
      tokenSpend: number;
      predictedRemainingCostCents: number | null;
      projectedTotalCostCents: number | null;
    }[]
  > {
    const items = await this.workItems.findTopByCostDesc({
      limit: params.limit ?? 20,
      projectId: params.projectId,
    });
    return buildWorkItemCostSummary(items, this.costEstimation);
  }

  async getCostEstimateAccuracy(): Promise<{
    sampleCount: number;
    meanAbsoluteErrorCents: number;
    meanAbsolutePercentageError: number | null;
  }> {
    return computeCostEstimateAccuracy(
      await this.runCosts.findAllForBucketAggregation(),
      this.costEstimation,
    );
  }

  async queryWorkItems(
    project_id: string,
    params: WorkItemQueryParams,
  ): Promise<PaginatedWorkItemRecords> {
    return this.queryAllWorkItems({ ...params, projectId: project_id });
  }

  async updateStatus(
    project_id: string,
    workItemId: string,
    status: WorkItemStatus,
  ): Promise<WorkItemRecord> {
    return this.transitionStatus({
      project_id,
      workItemId,
      status,
      actor: "system",
    });
  }

  private transitionStatus(params: {
    project_id: string;
    workItemId: string;
    status: WorkItemStatus;
    actor: string;
  }): Promise<WorkItemRecord> {
    return transitionWorkItemStatus(
      {
        workItems: this.workItems,
        projects: this.projects,
        coreClient: this.coreClient,
        lifecycleEventPublisher: this.lifecycleEventPublisher,
        realtimeGateway: this.realtimeGateway,
        realtimePublisher: this.realtimePublisher,
      },
      params,
    );
  }

  async dispatchWorkItem(
    project_id: string,
    workItemId: string,
    input: DispatchWorkItemInput,
  ): Promise<WorkItemRunRequestResult> {
    return this.requestWorkItemRun({
      project_id,
      workItemId,
      workflowId: input.workflowId,
      launchSource: "kanban_dispatch",
      requestedBy: input.requestedBy,
      idempotencyKey: `kanban:dispatch:${project_id}:${workItemId}`,
      action: "dispatch",
    });
  }

  async submitReviewDecision(
    project_id: string,
    workItemId: string,
    input: ReviewDecisionInput,
  ): Promise<WorkItemRunRequestResult> {
    return this.requestWorkItemRun({
      project_id,
      workItemId,
      workflowId: input.workflowId,
      launchSource: "kanban_review",
      requestedBy: input.requestedBy,
      idempotencyKey: `kanban:review:${project_id}:${workItemId}:${input.decision}`,
      action: "review",
      decision: input.decision,
      feedback: input.feedback,
    });
  }

  async requestMerge(
    project_id: string,
    workItemId: string,
    input: MergeWorkItemInput,
  ): Promise<WorkItemRunRequestResult> {
    return this.requestWorkItemRun({
      project_id,
      workItemId,
      workflowId: input.workflowId,
      launchSource: "kanban_merge",
      requestedBy: input.requestedBy,
      idempotencyKey: `kanban:merge:${project_id}:${workItemId}`,
      action: "merge",
    });
  }

  async updateWorkItem(
    project_id: string,
    workItemId: string,
    data: unknown,
  ): Promise<WorkItemRecord> {
    const item = await requireWorkItem(project_id, workItemId, this.workItems);
    const patch = asWorkItemPatch(data);

    if (
      "type" in patch ||
      "storyPoints" in patch ||
      "parentWorkItemId" in patch
    ) {
      const effectiveType = (patch.type ?? item.type) as WorkItemType;
      detachParentOnEpicPromotion(item, patch, effectiveType);

      const parentWorkItemId: string | null =
        patch.parentWorkItemId !== undefined
          ? patch.parentWorkItemId
          : item.parent_work_item_id;
      assertWorkItemInvariants({
        type: effectiveType,
        storyPoints:
          "storyPoints" in patch
            ? (patch.storyPoints ?? null)
            : item.story_points,
        parentType: await this.resolveParentType(project_id, parentWorkItemId),
      });
    }

    if (patch.dependencyIds) {
      await assertDependenciesExist({
        project_id,
        dependencyIds: patch.dependencyIds,
        workItems: this.workItems,
      });
      await this.workItems.replaceDependencies(workItemId, patch.dependencyIds);
    }

    const updated = await this.workItems.save(
      applyPatchToWorkItem(item, patch),
    );
    const dependencyIds =
      patch.dependencyIds ??
      (await getDependencyIds(workItemId, this.workItems));
    const subtasks = await replaceSubtasksFromInput(
      project_id,
      workItemId,
      patch.subtasks,
      this.workItems,
    );
    const resource = toWorkItemRecord(updated, dependencyIds, subtasks);

    // updateWorkItem never changes status, so a storyPoints patch on an item
    // already in refinement leaves no status transition for any caller to
    // detect — yet the split-trigger workflow needs to react to exactly this
    // (an item reaching storyPoints: 13 while sitting in refinement). Emit a
    // same-status "refresh" event (previousStatus: null bypasses the
    // unchanged-status skip guard in emitStatusChanged, mirroring the
    // restartExecution precedent below) so the existing
    // kanban.work_item.status_changed.v1 listeners re-evaluate. Scoped
    // narrowly to storyPoints patches on refinement-status items to avoid
    // spamming unrelated event-driven workflows on every update.
    if ("storyPoints" in patch && updated.status === "refinement") {
      await this.lifecycleEventPublisher
        .emitStatusChanged({
          projectId: project_id,
          workItemId,
          status: updated.status,
          previousStatus: null,
          actor: "system",
          updatedAt: updated.updated_at.toISOString(),
          resource,
        })
        .catch(ignoreFailVisibleLifecycleEventDeliveryError);
    }

    return resource;
  }

  async submitHumanFeedbackResolution(
    project_id: string,
    workItemId: string,
    input: HumanFeedbackResolutionInput,
  ): Promise<WorkItemRecord> {
    const item = await requireWorkItem(project_id, workItemId, this.workItems);
    const response = input.response.trim();
    if (response.length === 0) {
      throw new BadRequestException("response is required");
    }

    const resolvedAt = new Date().toISOString();
    const { metadata, previousDecisionPrompt, resolvedBy } =
      resolveHumanFeedbackResolution({
        metadata: item.metadata,
        input,
        resolvedAt,
      });
    const nextStatus = item.status === "blocked" ? "todo" : item.status;
    const updated = await this.workItems.save({
      ...item,
      status: nextStatus,
      metadata,
    });

    const dependencyIds = await getDependencyIds(updated.id, this.workItems);
    const resource = toWorkItemRecord(updated, dependencyIds);

    await this.lifecycleEventPublisher
      .emitHumanFeedbackResolved({
        projectId: project_id,
        workItemId,
        response,
        resolvedBy,
        previousDecisionPrompt,
        updatedAt: updated.updated_at.toISOString(),
        resource,
      })
      .catch(ignoreFailVisibleLifecycleEventDeliveryError);

    if (item.status !== nextStatus) {
      await this.lifecycleEventPublisher
        .emitStatusChanged({
          projectId: project_id,
          workItemId,
          status: nextStatus,
          previousStatus: item.status,
          actor: resolvedBy ?? "user",
          updatedAt: updated.updated_at.toISOString(),
          resource,
        })
        .catch(ignoreFailVisibleLifecycleEventDeliveryError);
    }

    return resource;
  }

  async deleteWorkItem(project_id: string, workItemId: string): Promise<void> {
    const item = await requireWorkItem(project_id, workItemId, this.workItems);
    const project = await this.projects.findById(project_id);
    if (project?.base_path) {
      const metadata = item.metadata;
      const relativePath =
        typeof metadata?.workItemMarkdownPath === "string"
          ? metadata.workItemMarkdownPath
          : `docs/work-items/${item.id}.md`;
      try {
        await this.coreClient.deleteRepoFile({
          repoPath: project.base_path,
          filePath: relativePath,
          message: `docs(work-items): delete spec for "${item.title}"`,
          push: true,
        });
      } catch (err) {
        console.warn(
          `Failed to delete spec file for work item ${item.id}:`,
          err,
        );
      }
    }
    await this.workItems.deleteByProjectAndId(project_id, workItemId);
  }

  async restartExecution(
    project_id: string,
    workItemId: string,
  ): Promise<{ workItem: WorkItemRecord; triggeredRunIds: string[] }> {
    const item = await requireWorkItem(project_id, workItemId, this.workItems);
    const workItem = toWorkItemRecord(
      item,
      await getDependencyIds(workItemId, this.workItems),
    );

    await this.lifecycleEventPublisher.emitStatusChanged({
      projectId: project_id,
      workItemId,
      status: item.status,
      previousStatus: null,
      actor: "manual-retrigger",
      updatedAt: new Date().toISOString(),
      resource: workItem,
    });

    return {
      workItem,
      triggeredRunIds: [],
    };
  }

  async getExecutions(
    project_id: string,
    workItemId: string,
  ): Promise<unknown[]> {
    await requireWorkItem(project_id, workItemId, this.workItems);
    return this.coreClient.listWorkflowRuns({
      scopeId: project_id,
      contextId: workItemId,
      limit: 50,
    });
  }

  async getExecutionConfig(
    project_id: string,
    workItemId: string,
  ): Promise<unknown> {
    return getWorkItemExecutionConfig(this.workItems, project_id, workItemId);
  }

  async upsertExecutionConfig(
    project_id: string,
    workItemId: string,
    data: unknown,
  ): Promise<WorkItemRecord> {
    return upsertWorkItemExecutionConfig(
      this.workItems,
      project_id,
      workItemId,
      data,
    );
  }

  async getActiveAutomationStatuses(project_id: string): Promise<string[]> {
    return getActiveWorkItemAutomationStatuses(this.workItems, project_id);
  }

  /**
   * Resolves the work-item type of a parent for invariant checks
   * (`assertWorkItemInvariants`), shared by `createWorkItem` and
   * `updateWorkItem` so both paths validate the same
   * epic/story/task/bug/spike hierarchy rules. Public so callers that
   * must pre-validate a whole batch before persisting anything (e.g.
   * `ProposeWorkItemsTool`) can resolve the shared parent's type once
   * without duplicating the lookup logic.
   */
  async resolveParentType(
    project_id: string,
    parentWorkItemId: string | null,
  ): Promise<WorkItemType | null> {
    if (!parentWorkItemId) return null;
    const parent = await requireWorkItem(
      project_id,
      parentWorkItemId,
      this.workItems,
    );
    return parent.type as WorkItemType;
  }

  /**
   * Direct children of a work item, keyed off the real `parent_work_item_id`
   * column. Public so callers such as the umbrella-parent resolver can drive
   * rollup logic off the persisted hierarchy instead of the retired
   * `metadata.split.proposedChildIds` bookkeeping.
   */
  async findChildIds(parentWorkItemId: string): Promise<string[]> {
    return this.workItems.findChildIds(parentWorkItemId);
  }

  private async requestWorkItemRun(
    params: WorkItemRunParams,
  ): Promise<WorkItemRunRequestResult> {
    return requestWorkItemRunHelper(
      {
        workItems: this.workItems,
        coreClient: this.coreClient,
        requestContext: this.requestContext,
        runLeaseService: this.runLeaseService,
        kanbanSettings: this.kanbanSettings,
        transitionStatus: (statusParams) => this.transitionStatus(statusParams),
      },
      params,
    );
  }
}
