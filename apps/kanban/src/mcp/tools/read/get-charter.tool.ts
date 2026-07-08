import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { CharterDocRenderService } from "../../../project/charter-doc-render.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

type GetCharterParams = z.infer<typeof ContextualProjectIdSchema>;

interface GetCharterResult {
  charter: string;
}

const GET_CHARTER_TOOL_NAME = "kanban.get_charter";

@Injectable()
export class GetCharterTool extends KanbanTool<
  GetCharterParams,
  GetCharterResult
> {
  constructor(private readonly charter: CharterDocRenderService) {
    super(GET_CHARTER_TOOL_NAME, {
      name: GET_CHARTER_TOOL_NAME,
      description:
        "Render the current project charter (vision, goals, and charter memories) as markdown, sourced live from the kanban database. Use this as the authoritative charter source.",
      inputSchema: ContextualProjectIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: GetCharterParams,
  ): Promise<GetCharterResult> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const charter = await this.charter.render(projectId);
    return { charter };
  }
}
