import { Injectable, Logger } from "@nestjs/common";
import type { CoreIntegrationPrStatusV1 } from "@nexus/core";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { WorkItemService } from "../work-item/work-item.service";

/**
 * Refreshes the dynamic PR observation on the neutral
 * `core.integration.pr_status.v1` event: idempotently overwrites
 * `lifecycle.merge.{checks, reviewDecision}` so the CEO stalled-PR detector sees
 * current provider status. It performs NO status transition — closing the
 * lifecycle is owned exclusively by the pr_merged handler. The neutral
 * scopeId/contextId map to project/work-item ids.
 */
@Injectable()
export class CoreLifecycleStreamPrStatusHandler {
  private readonly logger = new Logger(CoreLifecycleStreamPrStatusHandler.name);

  constructor(
    private readonly workItems: KanbanWorkItemRepository,
    private readonly workItemService: WorkItemService,
  ) {}

  async handle(payload: CoreIntegrationPrStatusV1): Promise<void> {
    const projectId = payload.scopeId;
    const workItemId = payload.contextId;

    const item = await this.workItems.findByProjectAndId(projectId, workItemId);
    if (!item) {
      this.logger.warn(
        `pr_status for unknown work item ${workItemId} in project ${projectId}; ignoring`,
      );
      return;
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
            prUrl: payload.prUrl,
            checks: payload.checks,
            reviewDecision: payload.reviewDecision,
          },
        },
      },
    });
  }
}
