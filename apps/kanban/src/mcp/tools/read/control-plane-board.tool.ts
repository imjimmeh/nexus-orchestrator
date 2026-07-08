import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { ControlPlaneBoardService } from "../../../orchestration/control-plane/control-plane-board.service";
import type { ControlPlaneBoardResponse } from "../../../orchestration/control-plane/control-plane-board.types";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

type ControlPlaneBoardParams = z.infer<typeof ContextualProjectIdSchema>;

const CONTROL_PLANE_BOARD_TOOL_NAME = "kanban.control_plane_board";

@Injectable()
export class ControlPlaneBoardTool extends KanbanTool<
  ControlPlaneBoardParams,
  ControlPlaneBoardResponse
> {
  constructor(private readonly board: ControlPlaneBoardService) {
    super(CONTROL_PLANE_BOARD_TOOL_NAME, {
      name: CONTROL_PLANE_BOARD_TOOL_NAME,
      description:
        "Read orchestration control-plane lanes, intents, facts, launch attempts, and no-launch reasons.",
      inputSchema: ContextualProjectIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected run(
    context: InternalToolExecutionContext,
    params: ControlPlaneBoardParams,
  ): Promise<ControlPlaneBoardResponse> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.board.getProjectBoard(projectId);
  }
}
