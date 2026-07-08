import { Injectable } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { WorkItemService } from "../../../work-item/work-item.service";
import { withCanonicalSplitParentId } from "../../../work-item/split-work-item-metadata.helper";
import { ProjectService } from "../../../project/project.service";
import { PublishSpecsSchema } from "../shared/schemas";
import { parseSpecFile, type SpecParseResult } from "./spec-parser";
import { validateTargetBranchClaims } from "./publish-specs-target-branch-claims";
import { validateSourceSpecTracking } from "./publish-specs-source-tracking";

const DEFAULT_SPEC_DIRECTORY = "docs/work-items";
const CONFLICT_STATUSES = new Set([
  "todo",
  "in-progress",
  "in-review",
  "ready-to-merge",
]);

type PublishSpecsParams = z.infer<typeof PublishSpecsSchema>;
type PublishSpecError = { source_path: string; message: string };
type WorkItemRecord = Record<string, unknown>;
type ExistingItemIndexes = {
  itemsBySourceId: Map<string, WorkItemRecord>;
  itemsById: Map<string, WorkItemRecord>;
  sourceIdToWorkItemId: Map<string, string>;
};
type ApplySpecsResult = {
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  dependencySourceIdsByWorkItemId: Map<string, string[]>;
};

@Injectable()
export class PublishSpecsTool extends KanbanTool<PublishSpecsParams> {
  constructor(
    private readonly workItems: WorkItemService,
    private readonly projects: ProjectService,
  ) {
    super("kanban.publish_specs", {
      name: "kanban.publish_specs",
      description:
        "Hydrate markdown work-item specs from the active workflow workspace into kanban work items.",
      inputSchema: PublishSpecsSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    rawParams: unknown,
  ): Promise<Record<string, unknown>> {
    const params = PublishSpecsSchema.parse(rawParams);
    const projectId = this.resolveProjectId(params, context);
    const specDirectory = params.spec_directory ?? DEFAULT_SPEC_DIRECTORY;
    const specRoot = await this.resolveSpecRoot(params, projectId);
    const allowMissing = params.allow_missing_specs ?? false;

    if (this.isRunnerLocalWorkspacePath(specRoot)) {
      if (allowMissing) {
        return this.buildNoopResult(
          projectId,
          specDirectory,
          specRoot,
          "missing_spec_directory",
        );
      }
      throw new Error(
        `/workspace paths are runner-local; use workspace_root or a project base_path that exists on the kanban service host. Resolved spec directory: ${specRoot}`,
      );
    }

    const files = await this.listMarkdownFiles(specRoot, allowMissing);
    if (!files) {
      return this.buildNoopResult(
        projectId,
        specDirectory,
        specRoot,
        "missing_spec_directory",
      );
    }

    const existingItems = await this.workItems.listWorkItems(projectId);
    const { itemsBySourceId, itemsById, sourceIdToWorkItemId } =
      this.indexExistingItems(existingItems);
    const { specs, errors } = await this.parseSpecs(
      files,
      specDirectory,
      specRoot,
    );
    const sourceSpecValidation = await validateSourceSpecTracking({
      allowUntrackedSpecs: params.allow_untracked_specs,
      specs,
      files,
      specDirectory,
      specRoot,
    });
    errors.push(...sourceSpecValidation.errors);

    this.sortSpecs(specs);
    const validation = validateTargetBranchClaims(
      specs,
      existingItems,
      itemsBySourceId,
    );
    errors.push(...validation.errors);
    const erroredSourceIds = new Set([
      ...sourceSpecValidation.erroredSourceIds,
      ...validation.erroredSourceIds,
    ]);

    const applyResult = await this.applySpecs(
      projectId,
      specs,
      itemsBySourceId,
      itemsById,
      sourceIdToWorkItemId,
      erroredSourceIds,
    );

    await this.updateDependencyIds(
      projectId,
      applyResult.dependencySourceIdsByWorkItemId,
      sourceIdToWorkItemId,
      erroredSourceIds,
    );

    const workItemIdsBySourceId = this.buildWorkItemIdsBySourceId(
      specs,
      sourceIdToWorkItemId,
      erroredSourceIds,
    );

    return {
      ok: errors.length === 0,
      status: errors.length === 0 ? "completed" : "completed_with_errors",
      project_id: projectId,
      spec_directory: specDirectory,
      resolved_spec_directory: specRoot,
      spec_count: files.length,
      created_count: applyResult.createdCount,
      updated_count: applyResult.updatedCount,
      unchanged_count: applyResult.unchangedCount,
      archived_count: 0,
      errored_count: errors.length,
      skipped_count: 0,
      errors,
      work_item_ids_by_source_id: workItemIdsBySourceId,
    };
  }

  private buildNoopResult(
    projectId: string,
    specDirectory: string,
    specRoot: string,
    reason: string,
  ): Record<string, unknown> {
    return {
      ok: true,
      status: "noop",
      reason,
      project_id: projectId,
      spec_directory: specDirectory,
      resolved_spec_directory: specRoot,
      spec_count: 0,
      created_count: 0,
      updated_count: 0,
      unchanged_count: 0,
      archived_count: 0,
      errored_count: 0,
      skipped_count: 0,
      work_item_ids_by_source_id: {},
    };
  }

  private indexExistingItems(existingItems: unknown[]): ExistingItemIndexes {
    const itemsBySourceId = new Map<string, WorkItemRecord>();
    const itemsById = new Map<string, WorkItemRecord>();
    const sourceIdToWorkItemId = new Map<string, string>();

    for (const item of existingItems) {
      const itemRecord = item as WorkItemRecord;
      const metadata = this.asRecord(itemRecord.metadata);
      const sourceId = this.asString(metadata?.sourceId);
      const workItemId = this.asString(itemRecord.id);
      if (workItemId) {
        itemsById.set(workItemId, itemRecord);
      }
      if (!sourceId) continue;

      itemsBySourceId.set(sourceId, itemRecord);
      if (workItemId) {
        sourceIdToWorkItemId.set(sourceId, workItemId);
      }
    }

    return { itemsBySourceId, itemsById, sourceIdToWorkItemId };
  }

  private async parseSpecs(
    files: string[],
    specDirectory: string,
    specRoot: string,
  ): Promise<{ specs: SpecParseResult[]; errors: PublishSpecError[] }> {
    const specs: SpecParseResult[] = [];
    const errors: PublishSpecError[] = [];
    const sourcePathPrefix = specDirectory
      .replaceAll("\\", "/")
      .replace(/\/+$/, "");

    for (const fileName of files) {
      const sourcePath = `${sourcePathPrefix}/${fileName}`;
      try {
        specs.push(
          parseSpecFile(
            fileName,
            await readFile(path.join(specRoot, fileName), "utf-8"),
            sourcePath,
          ),
        );
      } catch (error) {
        errors.push({
          source_path: sourcePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { specs, errors };
  }

  private sortSpecs(specs: SpecParseResult[]): void {
    specs.sort((left, right) => {
      const dependencyDelta =
        left.dependsOnSourceIds.length - right.dependsOnSourceIds.length;
      return dependencyDelta !== 0
        ? dependencyDelta
        : left.sourceId.localeCompare(right.sourceId);
    });
  }

  private async applySpecs(
    projectId: string,
    specs: SpecParseResult[],
    itemsBySourceId: Map<string, WorkItemRecord>,
    itemsById: Map<string, WorkItemRecord>,
    sourceIdToWorkItemId: Map<string, string>,
    erroredSourceIds: Set<string>,
  ): Promise<ApplySpecsResult> {
    const dependencySourceIdsByWorkItemId = new Map<string, string[]>();
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    for (const spec of specs) {
      if (erroredSourceIds.has(spec.sourceId)) continue;

      const existing =
        itemsBySourceId.get(spec.sourceId) ?? itemsById.get(spec.itemId ?? "");
      if (!existing) {
        await this.createSpecWorkItem(
          projectId,
          spec,
          sourceIdToWorkItemId,
          dependencySourceIdsByWorkItemId,
        );
        createdCount += 1;
        continue;
      }

      const result = await this.updateExistingSpecWorkItem(
        projectId,
        spec,
        existing,
        sourceIdToWorkItemId,
        dependencySourceIdsByWorkItemId,
      );
      if (result === "updated") updatedCount += 1;
      if (result === "unchanged") unchangedCount += 1;
    }

    return {
      createdCount,
      updatedCount,
      unchangedCount,
      dependencySourceIdsByWorkItemId,
    };
  }

  private async createSpecWorkItem(
    projectId: string,
    spec: SpecParseResult,
    sourceIdToWorkItemId: Map<string, string>,
    dependencySourceIdsByWorkItemId: Map<string, string[]>,
  ): Promise<void> {
    const payload = this.buildPayload(spec);
    const createPayload = spec.status
      ? { ...payload, status: spec.status }
      : payload;
    const workItem = await this.workItems.createWorkItem(
      projectId,
      createPayload,
    );
    const workItemRecord = this.asRecord(workItem) ?? {};
    const workItemId = this.asString(workItemRecord.id);
    if (!workItemId) return;

    sourceIdToWorkItemId.set(spec.sourceId, workItemId);
    if (spec.dependsOnSourceIds.length > 0) {
      dependencySourceIdsByWorkItemId.set(workItemId, spec.dependsOnSourceIds);
    }
  }

  private async updateExistingSpecWorkItem(
    projectId: string,
    spec: SpecParseResult,
    existing: WorkItemRecord,
    sourceIdToWorkItemId: Map<string, string>,
    dependencySourceIdsByWorkItemId: Map<string, string[]>,
  ): Promise<"updated" | "unchanged" | "errored"> {
    const existingId = this.asString(existing.id);
    if (!existingId) return "errored";

    const existingMetadata = this.asRecord(existing.metadata);
    const existingExecutionConfig = this.asRecord(existing.executionConfig);
    const payload = this.buildPayload(
      spec,
      existingMetadata,
      existingExecutionConfig,
    );
    const existingHash = this.asString(existingMetadata?.sourceHash);

    if (existingHash === spec.sourceHash) {
      sourceIdToWorkItemId.set(spec.sourceId, existingId);
      dependencySourceIdsByWorkItemId.set(existingId, spec.dependsOnSourceIds);
      return "unchanged";
    }

    this.preserveActiveTargetBranch(payload, existing);

    const workItem = await this.workItems.updateWorkItem(
      projectId,
      existingId,
      payload,
    );
    const workItemId = this.asString(this.asRecord(workItem)?.id) ?? existingId;
    sourceIdToWorkItemId.set(spec.sourceId, workItemId);
    dependencySourceIdsByWorkItemId.set(workItemId, spec.dependsOnSourceIds);
    return "updated";
  }

  private async updateDependencyIds(
    projectId: string,
    dependencySourceIdsByWorkItemId: Map<string, string[]>,
    sourceIdToWorkItemId: Map<string, string>,
    erroredSourceIds: Set<string>,
  ): Promise<void> {
    for (const [
      workItemId,
      dependencySourceIds,
    ] of dependencySourceIdsByWorkItemId) {
      const dependencyIds = dependencySourceIds
        .filter((sourceId) => !erroredSourceIds.has(sourceId))
        .map((sourceId) => sourceIdToWorkItemId.get(sourceId))
        .filter((value): value is string => typeof value === "string");
      if (dependencyIds.length > 0 || dependencySourceIds.length === 0) {
        await this.workItems.updateWorkItem(projectId, workItemId, {
          dependencyIds,
        });
      }
    }
  }

  private buildWorkItemIdsBySourceId(
    specs: SpecParseResult[],
    sourceIdToWorkItemId: Map<string, string>,
    erroredSourceIds: Set<string>,
  ): Record<string, string> {
    const workItemIdsBySourceId: Record<string, string> = {};
    for (const spec of specs) {
      if (erroredSourceIds.has(spec.sourceId)) continue;
      const workItemId = sourceIdToWorkItemId.get(spec.sourceId);
      if (workItemId) {
        workItemIdsBySourceId[spec.sourceId] = workItemId;
      }
    }
    return workItemIdsBySourceId;
  }

  private resolveProjectId(
    params: PublishSpecsParams,
    context: InternalToolExecutionContext,
  ): string {
    return resolveProjectIdFromToolContext({
      projectId: params.project_id ?? params.scope_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
  }

  private async resolveSpecRoot(
    params: PublishSpecsParams,
    projectId: string,
  ): Promise<string> {
    const specDirectory = params.spec_directory ?? DEFAULT_SPEC_DIRECTORY;
    if (path.isAbsolute(specDirectory)) {
      return path.normalize(specDirectory);
    }

    const workspaceRoot = params.workspace_root?.trim();
    if (workspaceRoot && workspaceRoot.length > 0) {
      return path.resolve(workspaceRoot, specDirectory);
    }

    const project = await this.projects.get(projectId);
    const projectBasePath =
      typeof project.basePath === "string" ? project.basePath.trim() : "";
    if (projectBasePath.length > 0) {
      return path.resolve(projectBasePath, specDirectory);
    }

    return path.resolve(specDirectory);
  }

  private buildPayload(
    spec: SpecParseResult,
    existingMetadata?: Record<string, unknown>,
    existingExecutionConfig?: Record<string, unknown>,
  ) {
    const executionConfig = spec.executionConfig
      ? { ...existingExecutionConfig, ...spec.executionConfig }
      : undefined;

    const metadata = withCanonicalSplitParentId({
      ...existingMetadata,
      ...spec.metadata,
      source: "publish_specs",
      sourceId: spec.sourceId,
      sourcePath: spec.sourcePath,
      workItemMarkdownPath: spec.sourcePath,
      sourceHash: spec.sourceHash,
    });

    return {
      title: spec.title,
      description: spec.body,
      priority: spec.priority,
      scope: spec.scope,
      ...(executionConfig ? { executionConfig } : {}),
      metadata,
    };
  }

  private async listMarkdownFiles(
    specRoot: string,
    allowMissing: boolean,
  ): Promise<string[] | undefined> {
    if (this.isRunnerLocalWorkspacePath(specRoot)) {
      if (allowMissing) {
        return undefined;
      }
      throw new Error(
        `Refusing to read spec directory ${specRoot}. /workspace paths are runner-local; use workspace_root or a project base_path that exists on the kanban service host.`,
      );
    }
    try {
      const entries = await readdir(specRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.toLowerCase().endsWith(".md"))
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      if (this.isMissingDirectoryError(error) && allowMissing) {
        return undefined;
      }
      throw error;
    }
  }

  private isMissingDirectoryError(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
    );
  }

  private isRunnerLocalWorkspacePath(specRoot: string): boolean {
    const normalized = specRoot.replaceAll("\\", "/");
    return normalized === "/workspace" || normalized.startsWith("/workspace/");
  }

  private preserveActiveTargetBranch(
    payload: { executionConfig?: unknown },
    existing: WorkItemRecord,
  ): void {
    const existingStatus = this.asString(existing.status);
    const existingTargetBranch = this.getTargetBranch(existing);
    if (!existingStatus || !existingTargetBranch) return;
    if (!CONFLICT_STATUSES.has(existingStatus)) return;

    const payloadExecConfig = this.asRecord(payload.executionConfig) ?? {};
    payloadExecConfig.targetBranch = existingTargetBranch;
    payload.executionConfig = payloadExecConfig;
  }

  private getTargetBranch(itemRecord: WorkItemRecord): string | undefined {
    const execConfig = this.asRecord(itemRecord.executionConfig);
    return this.asString(execConfig?.targetBranch)?.trim();
  }

  private asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  }
}
