import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { ProjectService } from "../../../project/project.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { z } from "zod";

type ProjectBriefParams = z.infer<typeof ContextualProjectIdSchema>;

@Injectable()
export class ProjectBriefTool extends KanbanTool<ProjectBriefParams> {
  constructor(private readonly projects: ProjectService) {
    super("kanban.project_brief", {
      name: "kanban.project_brief",
      description: "Read a kanban project brief.",
      inputSchema: ContextualProjectIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: ProjectBriefParams,
  ) {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.projects.get(projectId);
  }
}
