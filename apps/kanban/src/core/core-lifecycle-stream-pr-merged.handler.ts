import { Injectable, Logger } from "@nestjs/common";
import type { CoreIntegrationPrMergedV1 } from "@nexus/core";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { WorkItemService } from "../work-item/work-item.service";

const AWAITING_PR_MERGE = "awaiting-pr-merge";
const DONE = "done";

/**
 * Closes the PR lifecycle on the neutral `core.integration.pr_merged.v1` event:
 * patches `lifecycle.merge` with the observed merge commit and transitions the
 * work item to `done`. Idempotent — a second delivery for an already-`done`
 * item is a no-op. The neutral scopeId/contextId map to project/work-item ids.
 */
@Injectable()
export class CoreLifecycleStreamPrMergedHandler {
  private readonly logger = new Logger(CoreLifecycleStreamPrMergedHandler.name);

  constructor(
    private readonly workItems: KanbanWorkItemRepository,
    private readonly workItemService: WorkItemService,
  ) {}

  async handle(payload: CoreIntegrationPrMergedV1): Promise<void> {
    const projectId = payload.scopeId;
    const workItemId = payload.contextId;

    const item = await this.workItems.findByProjectAndId(projectId, workItemId);
    if (!item) {
      this.logger.warn(
        `pr_merged for unknown work item ${workItemId} in project ${projectId}; ignoring`,
      );
      return;
    }
    if (item.status === DONE) {
      return;
    }
    if (item.status !== AWAITING_PR_MERGE) {
      this.logger.warn(
        `pr_merged for work item ${workItemId} in unexpected status ${item.status}; transitioning to done anyway`,
      );
    }

    const existingMetadata =
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata)
        : {};
    const existingLifecycle =
      typeof existingMetadata.lifecycle === "object" &&
      existingMetadata.lifecycle !== null
        ? (existingMetadata.lifecycle as Record<string, unknown>)
        : {};
    const existingMerge =
      typeof existingLifecycle.merge === "object" &&
      existingLifecycle.merge !== null
        ? (existingLifecycle.merge as Record<string, unknown>)
        : {};

    await this.workItemService.updateWorkItem(projectId, workItemId, {
      metadata: {
        ...existingMetadata,
        lifecycle: {
          ...existingLifecycle,
          merge: {
            ...existingMerge,
            status: "merged",
            mergeCommit: payload.mergeCommitSha,
            prUrl: payload.prUrl,
          },
        },
      },
    });

    await this.workItemService.updateStatus(projectId, workItemId, DONE);
    this.logger.log(
      `Work item ${workItemId} transitioned to done on PR merge (${payload.prUrl})`,
    );
  }
}
