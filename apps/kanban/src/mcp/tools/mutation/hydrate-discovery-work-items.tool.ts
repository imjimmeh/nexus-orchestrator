import { Injectable } from "@nestjs/common";
import { getErrorMessage, isUuid } from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { WorkItemService } from "../../../work-item/work-item.service";
import { HydrateDiscoveryWorkItemsSchema } from "../shared/schemas";
import { parseSpecFile } from "../publish-specs/spec-parser";

const DEFAULT_SPEC_DIRECTORY = "docs/work-items";

interface HydrationParseError {
  file_name: string;
  source_path: string;
  message: string;
}

type HydrateDiscoveryWorkItemsParams = z.infer<
  typeof HydrateDiscoveryWorkItemsSchema
>;

@Injectable()
export class HydrateDiscoveryWorkItemsTool extends KanbanTool<HydrateDiscoveryWorkItemsParams> {
  constructor(private readonly workItems: WorkItemService) {
    super("hydrate_discovery_work_items", {
      name: "hydrate_discovery_work_items",
      description:
        "Hydrate discovered repository specs into canonical kanban work items and return hydration summary counts.",
      inputSchema: HydrateDiscoveryWorkItemsSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    rawParams: unknown,
  ): Promise<Record<string, unknown>> {
    const params = HydrateDiscoveryWorkItemsSchema.parse(rawParams);
    const projectId = this.resolveProjectId(params, context);
    const specDirectory = params.spec_directory ?? DEFAULT_SPEC_DIRECTORY;
    const files = await this.listMarkdownFiles(
      specDirectory,
      params.allow_missing_specs === true,
    );
    if (!files) {
      return {
        ok: false,
        status: "blocked",
        reason: "missing_spec_directory",
        spec_count: 0,
        created_count: 0,
        updated_count: 0,
        skipped_count: 0,
        spec_directory: specDirectory,
        project_id: projectId,
      };
    }

    const existingItems = await this.workItems.listWorkItems(projectId);
    const existingBySourceId = new Map<string, string>();
    const existingById = new Map<string, string>();

    for (const item of existingItems) {
      existingById.set(item.id, item.id);
      const metadata =
        item.metadata && typeof item.metadata === "object"
          ? item.metadata
          : undefined;
      const sourceId =
        metadata && typeof metadata.sourceId === "string"
          ? metadata.sourceId
          : undefined;
      if (sourceId) {
        existingBySourceId.set(sourceId, item.id);
      }
    }

    let createdCount = 0;
    let updatedCount = 0;
    const parseErrors: HydrationParseError[] = [];

    for (const fileName of files) {
      const sourcePath = `${specDirectory.replaceAll("\\", "/").replace(/\/+$/, "")}/${fileName}`;
      const fileContent = await readFile(
        path.join(specDirectory, fileName),
        "utf-8",
      );
      let spec: ReturnType<typeof parseSpecFile>;
      try {
        spec = parseSpecFile(fileName, fileContent, sourcePath);
      } catch (error) {
        parseErrors.push({
          file_name: fileName,
          source_path: sourcePath,
          message: getErrorMessage(error),
        });
        continue;
      }

      const payload = {
        id: isUuid(spec.sourceId) ? spec.sourceId : undefined,
        title: spec.title,
        description: spec.body,
        priority: spec.priority,
        scope: spec.scope,
        metadata: {
          source: "hydrate_discovery_work_items",
          sourceId: spec.sourceId,
          sourcePath: spec.sourcePath,
          sourceHash: spec.sourceHash,
          hydration_source: "repo_discovery",
        },
      };

      const existingId =
        existingBySourceId.get(spec.sourceId) ??
        existingById.get(spec.sourceId);
      if (existingId) {
        await this.workItems.updateWorkItem(projectId, existingId, payload);
        updatedCount += 1;
      } else {
        await this.workItems.createWorkItem(projectId, payload);
        createdCount += 1;
      }
    }

    const refreshed = await this.workItems.listWorkItems(projectId);
    const implementedCount = refreshed.filter(
      (item) => item.status === "done",
    ).length;
    const backlogCount = refreshed.length - implementedCount;
    const hydratedCount = createdCount + updatedCount;
    const skippedCount = Math.max(files.length - hydratedCount, 0);

    return {
      ok: true,
      hydrated_count: hydratedCount,
      created_count: createdCount,
      updated_count: updatedCount,
      skipped_count: skippedCount,
      skipped_files: parseErrors.map((parseError) => parseError.file_name),
      implemented_count: implementedCount,
      backlog_count: backlogCount,
      spec_count: files.length,
      parse_errors: parseErrors,
    };
  }

  private resolveProjectId(
    params: HydrateDiscoveryWorkItemsParams,
    context: InternalToolExecutionContext,
  ): string {
    return resolveProjectIdFromToolContext({
      projectId: params.project_id ?? params.scope_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
  }

  private async listMarkdownFiles(
    specRoot: string,
    allowMissingSpecs: boolean,
  ): Promise<string[] | undefined> {
    let entries: Array<{ isFile(): boolean; name: string }>;
    try {
      entries = await readdir(specRoot, { withFileTypes: true });
    } catch (error) {
      if (allowMissingSpecs && isMissingDirectoryError(error)) {
        return undefined;
      }
      throw error;
    }
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .sort((a, b) => a.localeCompare(b));
  }
}

function isMissingDirectoryError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
