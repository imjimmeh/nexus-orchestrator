import { Injectable } from "@nestjs/common";
import { OrchestrationControlPlaneSchedulerService } from "./orchestration-control-plane-scheduler.service";

const WORK_ITEM_STATE_TTL_MS = 60_000;
const PROJECT_STATE_TTL_MS = 30_000;

@Injectable()
export class OrchestrationFactSnapshotService {
  constructor(
    private readonly scheduler: OrchestrationControlPlaneSchedulerService,
  ) {}

  async publishWorkItemState(input: {
    readonly projectId: string;
    readonly workItemId: string;
    readonly currentStatus: string;
  }): Promise<void> {
    await this.scheduler.publishFact({
      projectId: input.projectId,
      factType: "work_item_current_state",
      subjectKind: "work_item",
      subjectId: input.workItemId,
      sourceType: "kanban_tool_preflight",
      sourceId: `preflight:${input.workItemId}`,
      confidence: 1,
      payload: { status: input.currentStatus },
      expiresAt: new Date(Date.now() + WORK_ITEM_STATE_TTL_MS),
    });
  }

  async publishProjectStateSnapshot(input: {
    readonly projectId: string;
    readonly workItemCounts: Record<string, number>;
    readonly totalCount: number;
  }): Promise<void> {
    await this.scheduler.publishFact({
      projectId: input.projectId,
      factType: "project_state_snapshot",
      subjectKind: "project",
      subjectId: input.projectId,
      sourceType: "kanban_tool_preflight",
      sourceId: `preflight:${input.projectId}`,
      confidence: 1,
      payload: {
        workItemCounts: input.workItemCounts,
        totalCount: input.totalCount,
      },
      expiresAt: new Date(Date.now() + PROJECT_STATE_TTL_MS),
    });
  }
}
