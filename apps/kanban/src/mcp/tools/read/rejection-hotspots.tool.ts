import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { RejectionHotspotsService } from "../../../orchestration/rejection-hotspots.service";
import type { RejectionHotspot } from "../../../orchestration/rejection-hotspots.helper";

const RejectionHotspotsSchema = ContextualProjectIdSchema.extend({
  depth: z.number().int().min(1).max(6).optional(),
});

interface RejectionHotspotsParams {
  project_id?: string | null;
  depth?: number;
}

@Injectable()
export class RejectionHotspotsTool extends KanbanTool<
  RejectionHotspotsParams,
  { hotspots: RejectionHotspot[] }
> {
  constructor(private readonly hotspots: RejectionHotspotsService) {
    super("kanban.rejection_hotspots", {
      name: "kanban.rejection_hotspots",
      description:
        "List QA-rejection hotspots for a project, grouped by code area (file path prefix).",
      inputSchema: RejectionHotspotsSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: RejectionHotspotsParams,
  ): Promise<{ hotspots: RejectionHotspot[] }> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const hotspots = await this.hotspots.getHotspots(projectId, {
      depth: params.depth,
    });
    return { hotspots };
  }
}
