import { existsSync } from "node:fs";
import path from "node:path";
import type { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { asRecord } from "./work-item.service.helpers";
import {
  writeWorkItemSpec,
  type WorkItemSpecInput,
} from "./work-item-spec-writer";
import type {
  CoreWorkflowRequester,
  WorkItemEntityRecord,
} from "./work-item.service.types";

/**
 * Write (and commit) the canonical `docs/work-items/<id>.md` spec projection for
 * a work item. The markdown is a projection of DB state, so this keeps the
 * committed file in sync with the record. `publish_specs` items are a special
 * case handled by {@link materializeMissingPublishSpecFile}.
 */
export async function writeWorkItemSpecFile(params: {
  project_id: string;
  item: WorkItemEntityRecord;
  dependencyIds: string[];
  projects: KanbanProjectRepository;
  coreClient: CoreWorkflowRequester;
  workItems: KanbanWorkItemRepository;
}): Promise<void> {
  try {
    const project = await params.projects.findById(params.project_id);
    if (!project?.base_path) return;

    const metadata = asRecord(params.item.metadata);

    // The authored spec file IS the source of truth for publish_specs items, so
    // a committed copy must never be clobbered. But publish_specs only records a
    // PATH; when that file was never committed to the project repo (e.g. it was
    // authored in an ephemeral worktree and lost), the reference dangles and
    // every worktree provisioned from the base branch lacks it — agents then
    // cannot read the spec. When the referenced file is absent, materialize a
    // regenerated copy from the DB record at the recorded path so the reference
    // resolves for future runs. The recorded (relative) workItemMarkdownPath is
    // preserved so the workflow trigger keeps pointing at the same location.
    if (metadata.source === "publish_specs") {
      await materializeMissingPublishSpecFile({
        ...params,
        metadata,
        projectBasePath: project.base_path,
      });
      return;
    }

    const specInput = buildWorkItemSpecInput(params.item, params.dependencyIds);
    const writeResult = await writeWorkItemSpec(project.base_path, specInput, {
      filePath: resolveSpecFilePath(metadata, project.base_path),
      frontmatterId: resolveFrontmatterId(metadata),
    });

    if (!writeResult.ok || !writeResult.filePath) return;

    await params.coreClient.commitPaths({
      repoPath: project.base_path,
      paths: [writeResult.filePath],
      message: `docs(work-items): add spec for "${params.item.title}"`,
      push: true,
    });

    const updatedMetadata = {
      ...(params.item.metadata ?? {}),
      workItemMarkdownPath: writeResult.filePath,
      sourceHash: writeResult.sourceHash,
    };

    await params.workItems.save({
      id: params.item.id,
      metadata: updatedMetadata,
    });
    params.item.metadata = updatedMetadata;
  } catch (err) {
    console.error(
      `Failed to write spec file for work item ${params.item.id}:`,
      err,
    );
  }
}

function resolveSpecFilePath(
  metadata: Record<string, unknown>,
  projectBasePath: string,
): string | undefined {
  // Honour a previously-generated path first, then the publish_specs sourcePath
  // (both point at the canonical docs/work-items/<...>.md location).
  const recordedPath =
    typeof metadata.workItemMarkdownPath === "string" &&
    metadata.workItemMarkdownPath.length > 0
      ? metadata.workItemMarkdownPath
      : typeof metadata.sourcePath === "string" &&
          metadata.sourcePath.length > 0
        ? metadata.sourcePath
        : undefined;

  if (!recordedPath) return undefined;
  return path.isAbsolute(recordedPath)
    ? recordedPath
    : path.resolve(projectBasePath, recordedPath);
}

/**
 * Repair a dangling publish_specs spec reference: if the authored markdown was
 * never committed to the project repo, regenerate it from the DB record at the
 * recorded path and commit it, so worktrees provisioned from the base branch
 * can read it. A committed authored file is left untouched (source of truth),
 * and the recorded relative path in metadata is preserved.
 */
async function materializeMissingPublishSpecFile(params: {
  item: WorkItemEntityRecord;
  dependencyIds: string[];
  coreClient: CoreWorkflowRequester;
  workItems: KanbanWorkItemRepository;
  metadata: Record<string, unknown>;
  projectBasePath: string;
}): Promise<void> {
  const targetPath = resolveSpecFilePath(
    params.metadata,
    params.projectBasePath,
  );
  if (!targetPath || existsSync(targetPath)) return;

  const materialized = await writeWorkItemSpec(
    params.projectBasePath,
    buildWorkItemSpecInput(params.item, params.dependencyIds),
    {
      filePath: targetPath,
      frontmatterId: resolveFrontmatterId(params.metadata),
    },
  );
  if (!materialized.ok || !materialized.filePath) return;

  await params.coreClient.commitPaths({
    repoPath: params.projectBasePath,
    paths: [materialized.filePath],
    message: `docs(work-items): materialize missing spec for "${params.item.title}"`,
    push: true,
  });

  const updatedMetadata = {
    ...(params.item.metadata ?? {}),
    sourceHash: materialized.sourceHash,
  };
  await params.workItems.save({
    id: params.item.id,
    metadata: updatedMetadata,
  });
  params.item.metadata = updatedMetadata;
}

function resolveFrontmatterId(
  metadata: Record<string, unknown>,
): string | undefined {
  return typeof metadata.sourceId === "string" && metadata.sourceId.length > 0
    ? metadata.sourceId
    : undefined;
}

function buildWorkItemSpecInput(
  item: WorkItemEntityRecord,
  dependencyIds: string[],
): WorkItemSpecInput {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    priority: item.priority,
    status: item.status,
    dependencyIds,
    executionConfig: item.execution_config ?? {},
    metadata: asRecord(item.metadata),
  };
}
