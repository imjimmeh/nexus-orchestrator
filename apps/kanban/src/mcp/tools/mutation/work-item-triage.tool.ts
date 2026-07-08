import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { WorkItemService } from "../../../work-item/work-item.service";
import { scoreTriage } from "../../../work-item/work-item-triage.helper";
import type { TriageScore } from "../../../work-item/work-item-triage.types";
import { RejectionHotspotsService } from "../../../orchestration/rejection-hotspots.service";
import { extractTargetFiles } from "../../../dispatch/plan-contention.helper";

const AC_PATTERN = /\bAC-?\d+\b/gi;
const HOTSPOT_UPGRADE_THRESHOLD = 3;

interface TriageParams {
  project_id?: string | null;
  workItemId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(
  item: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = item[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

@Injectable()
export class WorkItemTriageTool extends KanbanTool<
  TriageParams,
  TriageScore
> {
  constructor(
    private readonly workItems: WorkItemService,
    private readonly hotspots: RejectionHotspotsService,
  ) {
    super("kanban.work_item_triage", {
      name: "kanban.work_item_triage",
      description:
        "Deterministically classify a work item's refinement track (trivial|standard|complex) and flag ambiguity.",
      inputSchema: ContextualWorkItemIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: TriageParams,
  ): Promise<TriageScore> {
    const contextScopeId = (context as Record<string, string | undefined>)
      .scopeId;
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId,
      toolName: this.getName(),
    });
    const all = await this.workItems.listWorkItems(projectId);
    const records = all.filter(isRecord);
    const item = records.find(
      (entry) => getString(entry, "id") === params.workItemId,
    );
    if (!item) {
      throw new NotFoundException(
        `Work item ${params.workItemId} not found for project ${projectId}`,
      );
    }
    const description = getString(item, "description") ?? "";
    const matches = description.match(AC_PATTERN);
    const acCount = matches
      ? new Set(matches.map((m) => m.toUpperCase())).size
      : 0;
    const score = scoreTriage({ description, acCount });
    const plan = item.executionConfig as Record<string, unknown> | null;
    const planFiles = extractTargetFiles(plan?.["implementationPlan"]);
    const areaScore =
      planFiles.size > 0
        ? await this.hotspots.areaRejectionScore(projectId, [...planFiles])
        : 0;
    if (areaScore >= HOTSPOT_UPGRADE_THRESHOLD && score.track === "trivial") {
      return { ...score, track: "standard" as const };
    }
    return score;
  }
}
