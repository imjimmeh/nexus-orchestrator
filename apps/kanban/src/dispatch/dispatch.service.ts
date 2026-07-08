import { Inject, Injectable } from "@nestjs/common";
import { BaseRequestContextService } from "@nexus/core";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { WorkItemService } from "../work-item/work-item.service";
import { ProjectService } from "../project/project.service";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import { buildOrchestrationCycleEvent } from "./dispatch-orchestration-cycle.helper";
import type {
  CoreDispatchClient,
  WorkItemRecord,
} from "./dispatch-internal.types";
import { resolveProjectDispatchCapacity } from "./project-dispatch-capacity";
import type { ProjectDispatchCapacity } from "./project-dispatch-capacity.types";
import type {
  DispatchReadyWorkItemsInput,
  DispatchResult,
  DispatchRunReconciliationSummary,
  DispatchSelectedWorkItemsInput,
} from "./dispatch.service.types";
import { dispatchWorkItems } from "./dispatch-work-items.core";
import {
  reconcileAllLinkedRuns,
  reconcileOrphans,
} from "./dispatch-work-items-reconciliation";

@Injectable()
export class DispatchService {
  constructor(
    @Inject(CoreWorkflowClientService)
    private readonly coreClient: CoreDispatchClient,
    private readonly requestContext: BaseRequestContextService,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly workItemService: WorkItemService,
    private readonly kanbanSettings: KanbanSettingsService,
    private readonly projects: ProjectService,
    private readonly projectRepository: KanbanProjectRepository,
  ) {}

  async requestOrchestrationCycle(
    project_id: string,
    options?: { reason?: string; source?: string; dedupeKey?: string },
  ): Promise<void> {
    const source = options?.source ?? "kanban_dispatch";
    const reason = options?.reason ?? "Work item completed or dispatch polling";
    const dedupeKey =
      options?.dedupeKey ??
      `project-orchestration-cycle:${project_id}:${source}:${reason}`;

    const project = await this.projects.get(project_id).catch(() => null);

    await this.coreClient.emitDomainEventOrThrow(
      buildOrchestrationCycleEvent({
        projectId: project_id,
        source,
        reason,
        dedupeKey,
        basePath: project?.basePath ?? null,
        repositoryUrl: project?.repositoryUrl ?? null,
      }),
    );
  }

  async dispatchReadyWorkItems(
    input: DispatchReadyWorkItemsInput,
  ): Promise<DispatchResult> {
    const [maxActivePerProject, preflightRequired] = await Promise.all([
      input.maxActivePerProject ??
        this.kanbanSettings.getNumber(
          "work_item_dispatch_max_active_per_project",
        ),
      this.kanbanSettings.getBoolean("work_item_preflight_required"),
    ]);
    return dispatchWorkItems(this.buildDispatchCoreDeps(), {
      projectId: input.project_id,
      workflowId: input.workflowId,
      requestedBy: input.requestedBy,
      reconcileRunStatus: input.reconcileRunStatus,
      reconcileOrphans: true,
      checkTargetFileContention: true,
      partialFailure: false,
      limit: input.limit,
      maxConcurrentPerAgent: input.maxConcurrentPerAgent,
      maxActivePerProject,
      capacitySkipReason: "agent_capacity_reached",
      causationIdPrefix: "kanban:dispatch",
      releaseBranchOnFailure: false,
      preflightRequired,
    });
  }

  async resolveProjectDispatchCapacity(
    projectId: string,
  ): Promise<ProjectDispatchCapacity> {
    const projectItems = (await this.workItems.findByproject_id(
      projectId,
    )) as WorkItemRecord[];
    const maxActivePerProject = await this.kanbanSettings.getNumber(
      "work_item_dispatch_max_active_per_project",
    );

    return resolveProjectDispatchCapacity(projectItems, maxActivePerProject);
  }

  async reconcileProjectLinkedRuns(
    projectId: string,
  ): Promise<DispatchRunReconciliationSummary> {
    const result: DispatchRunReconciliationSummary = {
      reconciled: [],
      skipped: [],
      orphanReconciled: [],
    };
    const projectItems = (await this.workItems.findByproject_id(
      projectId,
    )) as WorkItemRecord[];
    const deps = this.buildDispatchCoreDeps();

    await reconcileAllLinkedRuns(deps, projectItems, result, true);
    await reconcileOrphans(deps, projectItems, result);

    return result;
  }

  private buildDispatchCoreDeps() {
    return {
      coreClient: this.coreClient,
      requestContext: this.requestContext,
      workItems: this.workItems,
      workItemService: this.workItemService,
      projects: this.projectRepository,
    };
  }

  async dispatchSelectedWorkItems(
    input: DispatchSelectedWorkItemsInput,
  ): Promise<DispatchResult> {
    const [maxActivePerProject, preflightRequired] = await Promise.all([
      input.maxActivePerProject ??
        this.kanbanSettings.getNumber(
          "work_item_dispatch_max_active_per_project",
        ),
      this.kanbanSettings.getBoolean("work_item_preflight_required"),
    ]);
    return dispatchWorkItems(this.buildDispatchCoreDeps(), {
      projectId: input.projectId,
      workflowId: input.workflowId,
      requestedBy: input.requestedBy,
      selectedWorkItemIds: input.workItemIds,
      reconcileRunStatus: true,
      reconcileOrphans: false,
      checkTargetFileContention: false,
      partialFailure: true,
      slots: input.slots,
      maxConcurrentPerAgent: input.maxConcurrentPerAgent,
      maxActivePerProject,
      capacitySkipReason: "concurrency_exceeded",
      causationIdPrefix: "kanban:dispatch:selected",
      releaseBranchOnFailure: true,
      preflightRequired,
    });
  }
}
