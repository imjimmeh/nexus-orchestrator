import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { DispatchService } from "../../../dispatch/dispatch.service";
import { OrchestrationDecisionExecutorService } from "../../../orchestration/control-plane/orchestration-decision-executor.service";
import { OrchestrationFactSnapshotService } from "../../../orchestration/control-plane/orchestration-fact-snapshot.service";
import { DispatchSelectedWorkItemsTool } from "./dispatch-selected-work-items.tool";

interface MockDispatchService {
  dispatchSelectedWorkItems: ReturnType<typeof vi.fn>;
}

interface MockDecisionExecutor {
  executeDirectMutationDecision: ReturnType<typeof vi.fn>;
}

interface MockFactSnapshot {
  publishProjectStateSnapshot: ReturnType<typeof vi.fn>;
}

describe("DispatchSelectedWorkItemsTool", () => {
  const context = {} as InternalToolExecutionContext;

  function createDecisionExecutor(): MockDecisionExecutor {
    return {
      executeDirectMutationDecision: vi
        .fn()
        .mockImplementation(
          async (input: { execute: () => Promise<unknown> }) => input.execute(),
        ),
    };
  }

  function createFactSnapshot(): MockFactSnapshot {
    return {
      publishProjectStateSnapshot: vi.fn().mockResolvedValue(undefined),
    };
  }

  function createTool(overrides?: {
    dispatch?: MockDispatchService;
    decisionExecutor?: MockDecisionExecutor;
    factSnapshot?: MockFactSnapshot;
  }): {
    tool: DispatchSelectedWorkItemsTool;
    dispatch: MockDispatchService;
    decisionExecutor: MockDecisionExecutor;
    factSnapshot: MockFactSnapshot;
  } {
    const dispatch = overrides?.dispatch ?? {
      dispatchSelectedWorkItems: vi.fn().mockResolvedValue({
        dispatched: [],
        skipped: [],
        reconciled: [],
      }),
    };
    const decisionExecutor =
      overrides?.decisionExecutor ?? createDecisionExecutor();
    const factSnapshot = overrides?.factSnapshot ?? createFactSnapshot();
    const tool = new DispatchSelectedWorkItemsTool(
      dispatch as unknown as DispatchService,
      decisionExecutor as unknown as OrchestrationDecisionExecutorService,
      factSnapshot as unknown as OrchestrationFactSnapshotService,
    );
    return { tool, dispatch, decisionExecutor, factSnapshot };
  }

  it("has the Kanban dispatch selected work items tool name", () => {
    const { tool } = createTool();

    expect(tool.getName()).toBe("kanban.dispatch_selected_work_items");
    expect(tool.getDefinition().name).toBe(
      "kanban.dispatch_selected_work_items",
    );
  });

  it("records a launchable dispatch decision before routing selected context IDs through Kanban dispatch", async () => {
    const { tool, dispatch, decisionExecutor, factSnapshot } = createTool();

    const result = await tool.execute(context, {
      project_id: "project-1",
      context_ids: ["work-item-1", "work-item-2"],
      workflow_id: "work_item_in_progress_default",
      requested_by: "dispatch-selector",
      max_concurrent_per_agent: 2,
      slots: 2,
    });

    expect(factSnapshot.publishProjectStateSnapshot).toHaveBeenCalledWith({
      projectId: "project-1",
      workItemCounts: {},
      totalCount: 2,
    });
    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        requester: "kanban.dispatch_selected_work_items",
        failureMetadata: {
          workItemIds: ["work-item-1", "work-item-2"],
          workflowId: "work_item_in_progress_default",
        },
        structuredDecision: {
          action: "dispatch_work_items",
          lane: "dispatch",
          intent_type: "dispatch_candidates",
          reason: "Selected work-item dispatch",
          work_item_ids: ["work-item-1", "work-item-2"],
          workflow_id: "work_item_in_progress_default",
          workflow_scope: "work-item-1,work-item-2",
          evidence: [{ kind: "tool_result", id: "dispatch-selected-input" }],
        },
        execute: expect.any(Function),
      }),
    );
    expect(dispatch.dispatchSelectedWorkItems).toHaveBeenCalledWith({
      projectId: "project-1",
      workItemIds: ["work-item-1", "work-item-2"],
      workflowId: "work_item_in_progress_default",
      requestedBy: "dispatch-selector",
      maxConcurrentPerAgent: 2,
      slots: 2,
    });
    expect(result).toEqual({ dispatched: [], skipped: [], reconciled: [] });
  });

  it("does not dispatch selected work when the decision is not launchable", async () => {
    const decisionExecutor = createDecisionExecutor();
    decisionExecutor.executeDirectMutationDecision.mockRejectedValue(
      new Error("Decision is not launchable: conflict_key_active"),
    );
    const { tool, dispatch, factSnapshot } = createTool({
      decisionExecutor,
    });

    await expect(
      tool.execute(context, {
        project_id: "project-1",
        context_ids: ["work-item-1"],
      }),
    ).rejects.toThrow("Decision is not launchable: conflict_key_active");

    expect(factSnapshot.publishProjectStateSnapshot).toHaveBeenCalled();
    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalled();
    expect(dispatch.dispatchSelectedWorkItems).not.toHaveBeenCalled();
  });

  it("trims selected dispatch string inputs before decision execution and dispatch", async () => {
    const { tool, dispatch, decisionExecutor } = createTool();
    const parsed = tool.getDefinition().inputSchema.parse({
      project_id: " project-1 ",
      context_ids: [" work-item-1 ", " work-item-2 "],
      workflow_id: " work_item_in_progress_default ",
      requested_by: " dispatch-selector ",
    });

    await tool.execute(context, parsed);

    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        structuredDecision: expect.objectContaining({
          work_item_ids: ["work-item-1", "work-item-2"],
          workflow_scope: "work-item-1,work-item-2",
        }),
      }),
    );
    expect(dispatch.dispatchSelectedWorkItems).toHaveBeenCalledWith({
      projectId: "project-1",
      workItemIds: ["work-item-1", "work-item-2"],
      workflowId: "work_item_in_progress_default",
      requestedBy: "dispatch-selector",
      maxConcurrentPerAgent: undefined,
      slots: undefined,
    });
  });

  it("derives project_id from context.scopeId when omitted", async () => {
    const { tool, dispatch, decisionExecutor, factSnapshot } = createTool();

    await tool.execute(
      { scopeId: "project-from-context" },
      {
        context_ids: ["work-item-1"],
      },
    );

    expect(factSnapshot.publishProjectStateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-from-context" }),
    );
    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-from-context" }),
    );
    expect(dispatch.dispatchSelectedWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-from-context" }),
    );
  });

  it("defaults to the in-progress workflow when workflow_id is omitted", async () => {
    const { tool, dispatch, decisionExecutor } = createTool();

    await tool.execute(context, {
      project_id: "project-1",
      context_ids: ["work-item-1"],
    });

    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        structuredDecision: expect.objectContaining({
          workflow_id: "work_item_in_progress_default",
        }),
      }),
    );
    expect(dispatch.dispatchSelectedWorkItems).toHaveBeenCalledWith({
      projectId: "project-1",
      workItemIds: ["work-item-1"],
      workflowId: "work_item_in_progress_default",
      requestedBy: undefined,
      maxConcurrentPerAgent: undefined,
      slots: undefined,
    });
  });

  it("advertises slots as a validated positive integer", () => {
    const { tool } = createTool();

    const result = tool.getDefinition().inputSchema.safeParse({
      project_id: "project-1",
      context_ids: ["work-item-1"],
      slots: 1,
    });

    expect(result.success).toBe(true);
    expect(
      tool.getDefinition().inputSchema.safeParse({
        project_id: "project-1",
        context_ids: ["work-item-1"],
        slots: 0,
      }).success,
    ).toBe(false);
  });
});
