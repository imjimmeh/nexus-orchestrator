import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { WorkItemService } from "../../../work-item/work-item.service";
import type { WorkItemRecord } from "../../../work-item/work-item.types";
import { OrchestrationRecordCycleDecisionSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const OrchestrationRecordCycleDecisionInputSchema =
  OrchestrationRecordCycleDecisionSchema;

type OrchestrationRecordCycleDecisionParams = z.infer<
  typeof OrchestrationRecordCycleDecisionInputSchema
>;

@Injectable()
export class OrchestrationRecordCycleDecisionTool extends KanbanTool<
  OrchestrationRecordCycleDecisionParams,
  unknown
> {
  constructor(
    private readonly orchestration: OrchestrationService,
    private readonly workItems: WorkItemService,
  ) {
    super("kanban.orchestration_record_cycle_decision", {
      name: "kanban.orchestration_record_cycle_decision",
      description:
        "Record a continuous orchestration cycle decision (repeat, pause, complete, or blocked) in kanban orchestration metadata and decision log.",
      inputSchema: OrchestrationRecordCycleDecisionInputSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: OrchestrationRecordCycleDecisionParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const paramsWithProject = {
      ...params,
      project_id: projectId,
    };

    const normalizedParams =
      await this.overrideBlockedDecisionForAutonomousFeedbackOnly(
        paramsWithProject,
      );

    await this.assertRepeatDecisionIsActionable(normalizedParams);

    const result = await this.orchestration.recordCycleDecision(projectId, {
      decision: normalizedParams.decision,
      reason: normalizedParams.reason,
      idempotencyKey: normalizedParams.idempotency_key,
      autonomousDefault: normalizedParams.autonomous_default,
      readyWorkRemaining: normalizedParams.ready_work_remaining,
      blockedItems: normalizedParams.blockedItems,
    });

    return {
      ok: true,
      project_id: projectId,
      ...result,
    };
  }

  private async overrideBlockedDecisionForAutonomousFeedbackOnly(
    params: OrchestrationRecordCycleDecisionParams & { project_id: string },
  ): Promise<OrchestrationRecordCycleDecisionParams & { project_id: string }> {
    if (params.decision !== "blocked") {
      return params;
    }

    const mode = await this.resolveProjectMode(params.project_id);
    if (mode !== "autonomous") {
      return params;
    }

    const items = await this.workItems.listWorkItems(params.project_id);
    const activeItems = items.filter((item) => item.status !== "done");
    if (activeItems.length === 0) {
      return params;
    }

    const allFeedbackOnlyImported = activeItems.every((item) => {
      if (item.status !== "blocked") {
        return false;
      }
      const metadata =
        item.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const sourceId =
        typeof metadata.sourceId === "string" ? metadata.sourceId : "";
      return (
        sourceId.startsWith("imported-repo:") &&
        metadata.importedRepoReconciliation === true &&
        metadata.feedbackNeeded === true
      );
    });

    if (!allFeedbackOnlyImported) {
      return params;
    }

    return {
      ...params,
      decision: "repeat",
      reason: `Autonomous feedback-only override: ${params.reason}`,
    };
  }

  private async resolveProjectMode(
    projectId: string,
  ): Promise<"autonomous" | "supervised" | null> {
    try {
      const state = await this.orchestration.get(projectId);
      if (state.orchestrationMode === "autonomous") {
        return "autonomous";
      }
      if (state.orchestrationMode === "supervised") {
        return "supervised";
      }
      return null;
    } catch {
      return null;
    }
  }

  private async assertRepeatDecisionIsActionable(
    params: OrchestrationRecordCycleDecisionParams & { project_id: string },
  ): Promise<void> {
    if (params.decision !== "repeat") {
      return;
    }

    const mode = await this.resolveProjectMode(params.project_id);
    if (mode === null) {
      return;
    }

    const items = await this.workItems.listWorkItems(params.project_id);
    if (this.hasTodo(items) || !this.hasAvailableBacklog(items)) {
      return;
    }

    if (this.hasTicketLevelNoActionEvidence(params.reason)) {
      return;
    }

    throw new BadRequestException(
      "Backlog-only repeat decisions must review backlog candidates, promote safe work, or record ticket-level blockers.",
    );
  }

  private hasTodo(items: WorkItemRecord[]): boolean {
    return items.some((item) => item.status === "todo");
  }

  private hasAvailableBacklog(items: WorkItemRecord[]): boolean {
    return items.some(
      (item) =>
        item.status === "backlog" &&
        !item.currentExecutionId &&
        !item.linkedRunId,
    );
  }

  private hasTicketLevelNoActionEvidence(reason: string): boolean {
    const normalizedReason = reason.toLowerCase();
    return (
      normalizedReason.includes("ticket-level blocker") ||
      normalizedReason.includes("reviewed candidate") ||
      normalizedReason.includes("promot") ||
      (normalizedReason.includes("backlog") &&
        normalizedReason.includes("todo"))
    );
  }
}
