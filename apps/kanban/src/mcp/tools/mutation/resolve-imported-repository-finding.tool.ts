import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { ImportedRepositoryFindingResolutionService } from "../../../orchestration/imported-repository-finding-resolution.service";
import { ResolveImportedRepositoryFindingSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

type ResolveFindingParams = z.infer<
  typeof ResolveImportedRepositoryFindingSchema
>;

@Injectable()
export class ResolveImportedRepositoryFindingTool extends KanbanTool<ResolveFindingParams> {
  constructor(
    @Inject(ImportedRepositoryFindingResolutionService)
    private readonly resolutionService: ImportedRepositoryFindingResolutionService,
  ) {
    super("kanban.resolve_imported_repository_finding", {
      name: "kanban.resolve_imported_repository_finding",
      description:
        "Resolve an imported repository finding by creating a work item or recording a disposition.",
      inputSchema: ResolveImportedRepositoryFindingSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    rawParams: unknown,
  ): Promise<Record<string, unknown>> {
    const params = ResolveImportedRepositoryFindingSchema.parse(rawParams);
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const result = await this.resolutionService.resolveFinding({
      projectId,
      findingId: params.finding_id,
      disposition: params.disposition,
      rationale: params.rationale,
      decidedBy: params.decided_by,
      metadata: params.metadata,
    });
    return { ...result };
  }
}
