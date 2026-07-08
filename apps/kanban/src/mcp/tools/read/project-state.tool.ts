import { Injectable, NotFoundException } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { ProjectService } from "../../../project/project.service";
import { WorkItemService } from "../../../work-item/work-item.service";
import { ProjectGoalsService } from "../../../goals/project-goals.service";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { ProjectMemorySummaryService } from "../../../project/project-memory-summary.service";
import { OrchestrationFactSnapshotService } from "../../../orchestration/control-plane/orchestration-fact-snapshot.service";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ProjectStrategicStateService } from "../../../orchestration/strategic/project-strategic-state.service";
import { KanbanSettingsService } from "../../../settings/kanban-settings.service";
import type { Initiative } from "@nexus/kanban-contracts";
import type { StrategicIntentPayload } from "../../../orchestration/strategic/strategic-intent-timeline.types";
import type { StrategicStaleness } from "../../../orchestration/strategic/project-strategic-state.types";
import type { ProjectDispatchCapacity } from "../../../dispatch/project-dispatch-capacity.types";
import type { WorkItemRecord } from "../../../dispatch/dispatch-internal.types";
import {
  countActiveProjectDispatches,
  resolveProjectDispatchCapacityFromActiveCount,
} from "../../../dispatch/project-dispatch-capacity";
import { filterDispatchableTodo } from "../../../work-item/work-item-dispatchable.helper";
import { z } from "zod";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { compactOrchestrationDiagnostics } from "./project-state-diagnostics.helper";

const ProjectStateInputSchema = ContextualProjectIdSchema.extend({
  include_work_item_bodies: z.boolean().optional(),
  max_work_items: z.number().int().min(1).max(1000).optional().default(100),
});

type ProjectStateParams = z.infer<typeof ProjectStateInputSchema>;

interface StrategicInitiativeView {
  id: string;
  title: string;
  horizon: string;
  priority: number;
  status: string;
  goalIds: string[];
  openWorkItemCount: number;
  lastReviewedAt: string | null;
}

interface ProjectStateResult {
  summary: ProjectStateSummary;
  project: Record<string, unknown>;
  workItems?: unknown[];
  goals: unknown[];
  orchestration: unknown;
  memorySummary: unknown;
  recentActivity: unknown;
  strategic: {
    staleness: StrategicStaleness;
    latestStrategicIntent: StrategicIntentPayload | null;
    initiatives: StrategicInitiativeView[];
    dispatch: {
      promotableBacklog: CompactWorkItemSummary[];
      escalatedBlockedItems: EscalatedBlockedItemSummary[];
      capacity: ProjectDispatchCapacity;
    };
  };
}

interface ProjectStateSummary {
  workItemCounts: Record<string, number>;
  totalCount: number;
  linkedRunCount: number;
  dispatchableTodoCount: number;
  /** @deprecated Use itemsByStatus.todo instead */
  dispatchableTodoItems: CompactWorkItemSummary[];
  /** @deprecated Use itemsByStatus.blocked instead */
  blockedItems: CompactWorkItemSummary[];
  itemsByStatus: Record<string, CompactWorkItemSummary[]>;
}

interface CompactWorkItemSummary {
  id: string;
  title: string;
  status: string;
  priority?: string;
  linked_run_id?: string;
}

interface EscalatedBlockedItemSummary extends CompactWorkItemSummary {
  reason: string;
  recommendation: string;
  replanAttempts: number;
}

const DONE_ITEMS_LIMIT = 30;

const PROJECT_STATE_TOOL_NAME = "kanban.project_state";
const ORCHESTRATION_DIAGNOSTIC_KEYS_TO_OMIT = new Set([
  "needsRecovery",
  "recommendation",
  "recommendedWorkflowId",
  "readinessContext",
  "readinessSignals",
  "readyForDispatch",
  "selectedRoute",
  "selectedRuleId",
  "routeId",
  "ruleId",
]);

function omitOrchestrationDecisionKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => omitOrchestrationDecisionKeys(item));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!ORCHESTRATION_DIAGNOSTIC_KEYS_TO_OMIT.has(key)) {
      sanitized[key] = omitOrchestrationDecisionKeys(nestedValue);
    }
  }
  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

@Injectable()
export class ProjectStateTool extends KanbanTool<
  ProjectStateParams,
  ProjectStateResult
> {
  constructor(
    private readonly projects: ProjectService,
    private readonly workItems: WorkItemService,
    private readonly goals: ProjectGoalsService,
    private readonly orchestration: OrchestrationService,
    private readonly memorySummary: ProjectMemorySummaryService,
    private readonly factSnapshot: OrchestrationFactSnapshotService,
    private readonly initiativesService: InitiativesService,
    private readonly strategicState: ProjectStrategicStateService,
    private readonly kanbanSettings: KanbanSettingsService,
  ) {
    super(PROJECT_STATE_TOOL_NAME, {
      name: PROJECT_STATE_TOOL_NAME,
      description:
        "Read kanban project, work items grouped by status, goals, orchestration diagnostics, memory summary, and recent activity. Set include_work_item_bodies=true only when full work item details are needed.",
      inputSchema: ProjectStateInputSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: ProjectStateParams,
  ): Promise<ProjectStateResult> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const initiatives =
      await this.initiativesService.listInitiatives(projectId);

    const [
      project,
      workItems,
      goals,
      orchestration,
      memorySummary,
      recentActivity,
      strategic,
      maxActive,
    ] = await Promise.all([
      this.projects.get(projectId),
      this.workItems.listWorkItems(projectId),
      this.goals.listGoals(projectId),
      this.getOptionalOrchestrationDiagnostics(projectId),
      this.memorySummary.getProjectMemorySummary(projectId),
      this.getOptionalActivitySummary(projectId),
      this.strategicState.buildStrategicState(projectId, initiatives),
      this.kanbanSettings.getNumber(
        "work_item_dispatch_max_active_per_project",
      ),
    ]);
    const summary = this.buildSummary(workItems);
    await this.factSnapshot.publishProjectStateSnapshot({
      projectId,
      workItemCounts: summary.workItemCounts,
      totalCount: summary.totalCount,
    });

    const maxWorkItems = params.max_work_items ?? 100;
    const paginatedWorkItems =
      params.include_work_item_bodies && Array.isArray(workItems)
        ? workItems.slice(0, maxWorkItems)
        : undefined;

    const workItemRecords = (Array.isArray(workItems) ? workItems : []).filter(
      isRecord,
    );
    const itemById = new Map(
      workItemRecords.flatMap((item) => {
        const id = this.getString(item, "id");
        return id ? [[id, item] as const] : [];
      }),
    );

    const promotableBacklog = workItemRecords
      .filter((item) => this.isPromotableBacklogItem(item, itemById))
      .map((item) => this.toCompactWorkItemSummary(item));

    const escalatedBlockedItems = workItemRecords
      .filter((item) => this.isEscalatedBlockedItem(item))
      .map((item) => this.toEscalatedBlockedItemSummary(item));

    const capacity = resolveProjectDispatchCapacityFromActiveCount(
      countActiveProjectDispatches(
        workItemRecords as unknown as WorkItemRecord[],
      ),
      maxActive,
    );

    return {
      summary,
      project,
      ...(paginatedWorkItems !== undefined
        ? { workItems: paginatedWorkItems }
        : {}),
      goals,
      orchestration,
      memorySummary,
      recentActivity,
      strategic: {
        staleness: strategic.staleness,
        latestStrategicIntent: strategic.latestStrategicIntent,
        initiatives: this.toStrategicInitiativeViews(initiatives, workItems),
        dispatch: { promotableBacklog, escalatedBlockedItems, capacity },
      },
    };
  }

  private toStrategicInitiativeViews(
    initiatives: Initiative[],
    workItems: unknown[],
  ): StrategicInitiativeView[] {
    const workItemRecords = workItems.filter(isRecord);
    return initiatives.map((initiative) => {
      const openWorkItemCount = workItemRecords.filter((item) => {
        const initiativeId = this.getString(item, "initiative_id");
        const status = this.getString(item, "status");
        return initiativeId === initiative.id && status !== "done";
      }).length;

      return {
        id: initiative.id,
        title: initiative.title,
        horizon: initiative.horizon,
        priority: initiative.priority,
        status: initiative.status,
        goalIds: initiative.goalIds,
        openWorkItemCount,
        lastReviewedAt: initiative.lastReviewedAt,
      };
    });
  }

  private buildSummary(workItems: unknown[]): ProjectStateSummary {
    const records = workItems.filter(isRecord);
    const itemById = new Map(
      records.flatMap((item) => {
        const id = this.getString(item, "id");
        return id ? [[id, item] as const] : [];
      }),
    );
    const dispatchableIds = new Set(
      filterDispatchableTodo(
        records.map((item) => ({
          id: this.getString(item, "id") ?? "",
          status: this.getString(item, "status") ?? "",
          type: this.getString(item, "type") ?? "story",
          parent_work_item_id: this.getString(item, "parentWorkItemId") ?? null,
        })),
      ).map((item) => item.id),
    );

    const workItemCounts: Record<string, number> = {};
    const itemsByStatus: Record<string, CompactWorkItemSummary[]> = {};
    const dispatchableTodoItems: CompactWorkItemSummary[] = [];
    const blockedItems: CompactWorkItemSummary[] = [];
    let linkedRunCount = 0;
    let totalCount = 0;

    for (const item of records) {
      totalCount += 1;
      const status = this.getString(item, "status") ?? "unknown";
      workItemCounts[status] = (workItemCounts[status] ?? 0) + 1;

      if (this.getLinkedRunId(item)) {
        linkedRunCount += 1;
      }

      const compact = this.toCompactWorkItemSummary(item);

      // Collect into itemsByStatus (cap done items)
      if (status === "done") {
        const doneBucket = itemsByStatus["done"] ?? [];
        if (doneBucket.length >= DONE_ITEMS_LIMIT) {
          // Drop oldest done items; keep newest (items are in created_at ASC order)
          doneBucket.shift();
        }
        doneBucket.push(compact);
        itemsByStatus["done"] = doneBucket;
      } else {
        const bucket = itemsByStatus[status] ?? [];
        bucket.push(compact);
        itemsByStatus[status] = bucket;
      }

      // Keep backward-compat fields
      if (this.isDispatchableTodoItem(item, itemById, dispatchableIds)) {
        dispatchableTodoItems.push(compact);
      }
      if (this.isBlockedSummaryItem(item, itemById)) {
        blockedItems.push(compact);
      }
    }

    return {
      workItemCounts,
      totalCount,
      linkedRunCount,
      dispatchableTodoCount: dispatchableTodoItems.length,
      dispatchableTodoItems,
      blockedItems,
      itemsByStatus,
    };
  }

  private isHumanDecisionBlocked(item: Record<string, unknown>): boolean {
    const metadata = item["metadata"];
    if (!isRecord(metadata)) return false;
    return isRecord(metadata["human_decision"]);
  }

  private isPromotableBacklogItem(
    item: Record<string, unknown>,
    itemById: Map<string, Record<string, unknown>>,
  ): boolean {
    return (
      this.getString(item, "status") === "backlog" &&
      !this.isHumanDecisionBlocked(item) &&
      this.dependenciesReady(item, itemById)
    );
  }

  private isEscalatedBlockedItem(item: Record<string, unknown>): boolean {
    if (this.getString(item, "status") !== "blocked") return false;
    const metadata = item["metadata"];
    if (!isRecord(metadata)) return false;
    const escalation = metadata["escalation"];
    return (
      isRecord(escalation) &&
      typeof escalation["recommendation"] === "string" &&
      escalation["recommendation"].length > 0
    );
  }

  private toEscalatedBlockedItemSummary(
    item: Record<string, unknown>,
  ): EscalatedBlockedItemSummary {
    const metadata = item["metadata"];
    const escalation =
      isRecord(metadata) && isRecord(metadata["escalation"])
        ? metadata["escalation"]
        : {};
    const replanAttempts = escalation["replanAttempts"];
    return {
      ...this.toCompactWorkItemSummary(item),
      reason:
        typeof escalation["reason"] === "string" ? escalation["reason"] : "",
      recommendation:
        typeof escalation["recommendation"] === "string"
          ? escalation["recommendation"]
          : "",
      replanAttempts:
        typeof replanAttempts === "number" && Number.isFinite(replanAttempts)
          ? replanAttempts
          : 0,
    };
  }

  private isDispatchableTodoItem(
    item: Record<string, unknown>,
    itemById: Map<string, Record<string, unknown>>,
    dispatchableIds: ReadonlySet<string>,
  ): boolean {
    const id = this.getString(item, "id");
    return (
      id !== undefined &&
      dispatchableIds.has(id) &&
      !this.getLinkedRunId(item) &&
      this.dependenciesReady(item, itemById)
    );
  }

  private isBlockedSummaryItem(
    item: Record<string, unknown>,
    itemById: Map<string, Record<string, unknown>>,
  ): boolean {
    if (this.getString(item, "status") === "blocked") return true;
    const dependencyIds = this.getDependencyIds(item);
    return (
      this.getString(item, "status") === "todo" &&
      dependencyIds.length > 0 &&
      !this.dependenciesReady(item, itemById)
    );
  }

  private dependenciesReady(
    item: Record<string, unknown>,
    itemById: Map<string, Record<string, unknown>>,
  ): boolean {
    return this.getDependencyIds(item).every((dependencyId) => {
      const dependency = itemById.get(dependencyId);
      return dependency
        ? this.getString(dependency, "status") === "done"
        : false;
    });
  }

  private toCompactWorkItemSummary(
    item: Record<string, unknown>,
  ): CompactWorkItemSummary {
    const summary: CompactWorkItemSummary = {
      id: this.getString(item, "id") ?? "",
      title: this.getString(item, "title") ?? "",
      status: this.getString(item, "status") ?? "",
    };
    const priority = this.getString(item, "priority");
    const linkedRunId = this.getLinkedRunId(item);
    if (priority) summary.priority = priority;
    if (linkedRunId) summary.linked_run_id = linkedRunId;
    return summary;
  }

  private getDependencyIds(item: Record<string, unknown>): string[] {
    return [
      ...this.getStringArray(item, "dependencyIds"),
      ...this.getStringArray(item, "dependency_ids"),
      ...this.getStringArray(item, "dependsOn"),
    ];
  }

  private getLinkedRunId(item: Record<string, unknown>): string | undefined {
    return (
      this.getString(item, "linked_run_id") ??
      this.getString(item, "linkedRunId")
    );
  }

  private getString(
    item: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = item[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private getStringArray(item: Record<string, unknown>, key: string): string[] {
    const value = item[key];
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  }

  private async getOptionalOrchestrationDiagnostics(
    project_id: string,
  ): Promise<unknown> {
    try {
      return compactOrchestrationDiagnostics(
        omitOrchestrationDecisionKeys(
          await this.orchestration.getDiagnostics(project_id),
        ),
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  private async getOptionalActivitySummary(
    project_id: string,
  ): Promise<unknown> {
    try {
      return await this.orchestration.getActivitySummary(project_id, {
        limit: 5,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { totalActionCount: 0, recent: [] };
      }
      throw error;
    }
  }
}
