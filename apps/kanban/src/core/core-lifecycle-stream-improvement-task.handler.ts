import { Injectable, Logger } from "@nestjs/common";
import type { ImprovementTaskRequestedV1 } from "@nexus/core";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import { WorkItemService } from "../work-item/work-item.service";
import {
  buildImprovementWorkItemDescription,
  ImprovementTaskParkedError,
  severityToPriority,
} from "./core-lifecycle-stream-improvement-task.helpers";

const SELF_IMPROVEMENT_PROJECT_SETTING = "self_improvement_project_id";
const BACKLOG = "backlog";

/**
 * Files a core improvement.task.requested brief as a work item on the
 * configured self-improvement project. Idempotent: the work-item id IS the
 * proposal id, so redelivery never files twice. When no project is
 * configured the event is parked — warning here plus the consumer's
 * dead-letter record — never a silent drop.
 */
@Injectable()
export class CoreLifecycleStreamImprovementTaskHandler {
  private readonly logger = new Logger(
    CoreLifecycleStreamImprovementTaskHandler.name,
  );

  constructor(
    private readonly settings: KanbanSettingsService,
    private readonly workItemService: WorkItemService,
    private readonly workItems: KanbanWorkItemRepository,
  ) {}

  async handle(payload: ImprovementTaskRequestedV1): Promise<void> {
    const projectId = await this.settings.get<string>(
      SELF_IMPROVEMENT_PROJECT_SETTING,
      "",
    );
    if (!projectId) {
      this.logger.warn(
        `improvement.task.requested ${payload.proposalId} parked: ${SELF_IMPROVEMENT_PROJECT_SETTING} is not configured (see docs/operations/self-improvement-project.md)`,
      );
      throw new ImprovementTaskParkedError(
        `${SELF_IMPROVEMENT_PROJECT_SETTING} not configured`,
      );
    }

    const existing = await this.workItems.findByProjectAndId(
      projectId,
      payload.proposalId,
    );
    if (existing) {
      this.logger.log(
        `improvement task ${payload.proposalId} already filed on project ${projectId}; skipping`,
      );
      return;
    }

    await this.workItemService.createWorkItem(projectId, {
      id: payload.proposalId,
      title: payload.title,
      description: buildImprovementWorkItemDescription(payload),
      priority: severityToPriority(payload.severity),
      status: BACKLOG,
      metadata: {
        improvement: {
          proposalId: payload.proposalId,
          severity: payload.severity,
          occurrenceCount: payload.occurrenceCount,
          suspectedArea: payload.suspectedArea ?? [],
          evidence: payload.evidence,
        },
      },
    });
    this.logger.log(
      `Filed improvement work item ${payload.proposalId} on project ${projectId} (severity ${payload.severity}, occurrences ${payload.occurrenceCount})`,
    );
  }
}
