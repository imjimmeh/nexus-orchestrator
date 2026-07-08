import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { ProjectIdSchema } from "../shared/schemas";

@Injectable()
export class OrchestrationCompleteTool extends KanbanTool<
  z.infer<typeof ProjectIdSchema>,
  unknown
> {
  constructor(private readonly orchestration: OrchestrationService) {
    super("kanban.orchestration_complete", {
      name: "kanban.orchestration_complete",
      description: "Mark kanban project orchestration complete.",
      inputSchema: ProjectIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    _context: InternalToolExecutionContext,
    params: z.infer<typeof ProjectIdSchema>,
  ): Promise<unknown> {
    return this.orchestration.complete(params.project_id);
  }
}
