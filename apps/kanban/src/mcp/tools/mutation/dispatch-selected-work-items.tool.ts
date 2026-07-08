import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { DispatchService } from "../../../dispatch/dispatch.service";
import { OrchestrationDecisionExecutorService } from "../../../orchestration/control-plane/orchestration-decision-executor.service";
import { OrchestrationFactSnapshotService } from "../../../orchestration/control-plane/orchestration-fact-snapshot.service";
import { DispatchSelectedWorkItemsSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const DEFAULT_SELECTED_WORKFLOW_ID = "work_item_in_progress_default";

type DispatchSelectedWorkItemsParams = z.infer<
  typeof DispatchSelectedWorkItemsSchema
>;

@Injectable()
export class DispatchSelectedWorkItemsTool extends KanbanTool<
  DispatchSelectedWorkItemsParams,
  unknown
> {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly decisionExecutor: OrchestrationDecisionExecutorService,
    private readonly factSnapshot: OrchestrationFactSnapshotService,
  ) {
    super("kanban.dispatch_selected_work_items", {
      name: "kanban.dispatch_selected_work_items",
      description:
        "Dispatch selected Kanban work items through Kanban-owned lifecycle tooling.",
      inputSchema: DispatchSelectedWorkItemsSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: DispatchSelectedWorkItemsParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const workflowId = params.workflow_id ?? DEFAULT_SELECTED_WORKFLOW_ID;

    // Preflight: publish project state snapshot for scheduler
    await this.factSnapshot.publishProjectStateSnapshot({
      projectId,
      workItemCounts: {},
      totalCount: params.context_ids.length,
    });

    return this.decisionExecutor.executeDirectMutationDecision({
      projectId,
      requester: "kanban.dispatch_selected_work_items",
      failureMetadata: { workItemIds: params.context_ids, workflowId },
      structuredDecision: {
        action: "dispatch_work_items",
        lane: "dispatch",
        intent_type: "dispatch_candidates",
        reason: "Selected work-item dispatch",
        work_item_ids: params.context_ids,
        workflow_id: workflowId,
        workflow_scope: params.context_ids.join(","),
        evidence: [{ kind: "tool_result", id: "dispatch-selected-input" }],
      },
      execute: () =>
        this.dispatch.dispatchSelectedWorkItems({
          projectId,
          workItemIds: params.context_ids,
          workflowId,
          requestedBy: params.requested_by,
          maxConcurrentPerAgent: params.max_concurrent_per_agent,
          slots: params.slots,
        }),
    });
  }
}
