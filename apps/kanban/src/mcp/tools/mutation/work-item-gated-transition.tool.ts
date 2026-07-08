import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { WorkItemStatusSchema } from "@nexus/kanban-contracts";
import type { WorkItemStatus } from "@nexus/kanban-contracts";
import { z } from "zod";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { WorkItemService } from "../../../work-item/work-item.service";
import { OrchestrationService } from "../../../orchestration/orchestration.service";

const GATED_RISK = "high";
const PLAN_APPROVAL_ACTION = "approve_refinement_plan_exit";

const GatedTransitionSchema = ContextualWorkItemIdSchema.extend({
  target_status: WorkItemStatusSchema,
  risk_level: z.string().optional(),
  autonomy_merge: z.enum(["auto", "ask"]).optional(),
});

interface GatedTransitionParams {
  project_id?: string | null;
  workItemId: string;
  target_status: WorkItemStatus;
  risk_level?: string;
  autonomy_merge?: "auto" | "ask";
}

@Injectable()
export class WorkItemGatedTransitionTool extends KanbanTool<
  GatedTransitionParams,
  unknown
> {
  constructor(
    private readonly workItems: WorkItemService,
    private readonly orchestration: OrchestrationService,
  ) {
    super("kanban.work_item_gated_transition", {
      name: "kanban.work_item_gated_transition",
      description:
        "Transition a work item, queuing for human approval when risk is high and orchestration mode is not autonomous. The autonomy_merge parameter overrides mode-based gating: 'ask' forces approval, 'auto' forces immediate execution.",
      inputSchema: GatedTransitionSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: GatedTransitionParams,
  ): Promise<unknown> {
    const contextScopeId = (context as Record<string, string | undefined>)
      .scopeId;
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId,
      toolName: this.getName(),
    });

    const state = await this.orchestration.get(projectId);
    const mode = state.orchestrationMode;
    const mergeAutonomy =
      params.autonomy_merge ?? (mode === "autonomous" ? "auto" : "ask");
    const highRisk = (params.risk_level ?? "").toLowerCase() === GATED_RISK;

    if (highRisk && mergeAutonomy !== "auto") {
      const request = await this.orchestration.requestAction(projectId, {
        action: PLAN_APPROVAL_ACTION,
        payload: {
          workItemId: params.workItemId,
          toStatus: params.target_status,
          riskLevel: params.risk_level,
        },
        requestedBy: "work_item_refinement_default",
      });
      return { gated: true, actionRequestId: request.id, mode };
    }

    const resource = (await this.workItems.updateStatus(
      projectId,
      params.workItemId,
      params.target_status,
    )) as unknown;
    return { gated: false, resource };
  }
}
