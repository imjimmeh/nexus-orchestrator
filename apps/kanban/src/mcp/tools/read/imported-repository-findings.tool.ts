import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { ImportedRepositoryFindingResolutionService } from "../../../orchestration/imported-repository-finding-resolution.service";
import { ImportedRepositoryFindingsSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

type FindingsParams = z.infer<typeof ImportedRepositoryFindingsSchema>;

@Injectable()
export class ImportedRepositoryFindingsTool extends KanbanTool<
  FindingsParams,
  unknown[]
> {
  constructor(
    @Inject(ImportedRepositoryFindingResolutionService)
    private readonly resolutionService: ImportedRepositoryFindingResolutionService,
  ) {
    super("kanban.imported_repository_findings", {
      name: "kanban.imported_repository_findings",
      description:
        "List imported repository findings for a project, optionally filtered by status.",
      inputSchema: ImportedRepositoryFindingsSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    rawParams: unknown,
  ): Promise<unknown[]> {
    const params = ImportedRepositoryFindingsSchema.parse(rawParams);
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.resolutionService.listFindings({
      projectId,
      statuses: params.statuses,
      limit: params.limit,
    });
  }
}
