import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { WorkItemService } from "../../../work-item/work-item.service";

const TrackSchema = z.enum(["trivial", "standard", "complex"]);

const FinalizeTriageSchema = ContextualWorkItemIdSchema.extend({
  deterministic_track: TrackSchema,
  ambiguous: z.boolean(),
  classified_track: TrackSchema.optional(),
});

interface FinalizeTriageParams {
  project_id?: string | null;
  workItemId: string;
  deterministic_track: "trivial" | "standard" | "complex";
  ambiguous: boolean;
  classified_track?: "trivial" | "standard" | "complex";
}

@Injectable()
export class WorkItemFinalizeTriageTool extends KanbanTool<
  FinalizeTriageParams,
  { track: "trivial" | "standard" | "complex" }
> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.work_item_finalize_triage", {
      name: "kanban.work_item_finalize_triage",
      description:
        "Persist the final refinement track (classified track when ambiguous, else deterministic).",
      inputSchema: FinalizeTriageSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: FinalizeTriageParams,
  ): Promise<{ track: "trivial" | "standard" | "complex" }> {
    const contextScopeId = (context as Record<string, string | undefined>)
      .scopeId;
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId,
      toolName: this.getName(),
    });
    const track =
      params.ambiguous && params.classified_track
        ? params.classified_track
        : params.deterministic_track;

    await this.workItems.updateWorkItem(projectId, params.workItemId, {
      metadata: {
        refinement: { track },
      },
    });
    return { track };
  }
}
