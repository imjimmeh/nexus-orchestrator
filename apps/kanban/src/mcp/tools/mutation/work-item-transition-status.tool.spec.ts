import { BadRequestException } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationDecisionExecutorService } from "../../../orchestration/control-plane/orchestration-decision-executor.service";
import { OrchestrationFactSnapshotService } from "../../../orchestration/control-plane/orchestration-fact-snapshot.service";
import { KanbanSettingsService } from "../../../settings/kanban-settings.service";
import { WorkItemService } from "../../../work-item/work-item.service";
import { WorkItemTransitionStatusTool } from "./work-item-transition-status.tool";

interface MockWorkItems {
  updateStatus: ReturnType<typeof vi.fn>;
  listWorkItems: ReturnType<typeof vi.fn>;
}

interface MockDecisionExecutor {
  executeDirectMutationDecision: ReturnType<typeof vi.fn>;
}

interface MockFactSnapshot {
  publishWorkItemState: ReturnType<typeof vi.fn>;
}

interface MockKanbanSettings {
  getNumber: ReturnType<typeof vi.fn>;
  getBoolean?: ReturnType<typeof vi.fn>;
}

type WorkItemFixture = {
  id: string;
  status: string;
  linkedRunId: string | null;
  currentExecutionId: string | null;
};

describe("WorkItemTransitionStatusTool", () => {
  const context = {} as InternalToolExecutionContext;
  const workItemId = "11111111-1111-4111-8111-111111111111";

  function item(
    id: string,
    status: string,
    overrides: Partial<WorkItemFixture> = {},
  ): WorkItemFixture {
    return {
      id,
      status,
      linkedRunId: null,
      currentExecutionId: null,
      ...overrides,
    };
  }

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
      publishWorkItemState: vi.fn().mockResolvedValue(undefined),
    };
  }

  function createTool(overrides?: {
    workItems?: MockWorkItems;
    decisionExecutor?: MockDecisionExecutor;
    factSnapshot?: MockFactSnapshot;
    kanbanSettings?: MockKanbanSettings;
  }): {
    tool: WorkItemTransitionStatusTool;
    workItems: MockWorkItems;
    decisionExecutor: MockDecisionExecutor;
    factSnapshot: MockFactSnapshot;
    kanbanSettings: MockKanbanSettings;
  } {
    const workItems = overrides?.workItems ?? {
      updateStatus: vi.fn().mockResolvedValue({ id: "work-item-1" }),
      listWorkItems: vi.fn().mockResolvedValue([item(workItemId, "backlog")]),
    };
    const decisionExecutor =
      overrides?.decisionExecutor ?? createDecisionExecutor();
    const factSnapshot = overrides?.factSnapshot ?? createFactSnapshot();
    const kanbanSettings = {
      getNumber: vi.fn().mockResolvedValue(3),
      getBoolean: vi.fn().mockResolvedValue(false),
      ...overrides?.kanbanSettings,
    };
    const tool = new WorkItemTransitionStatusTool(
      workItems as unknown as WorkItemService,
      decisionExecutor as unknown as OrchestrationDecisionExecutorService,
      factSnapshot as unknown as OrchestrationFactSnapshotService,
      kanbanSettings as unknown as KanbanSettingsService,
    );
    return { tool, workItems, decisionExecutor, factSnapshot, kanbanSettings };
  }

  it("rejects unsupported statuses in the tool schema", () => {
    const { tool } = createTool();

    const result = tool.getDefinition().inputSchema.safeParse({
      project_id: "project-1",
      workItemId: "work-item-1",
      status: "not-a-status",
    });

    expect(result.success).toBe(false);
  });

  it("records a launchable status-transition decision before updating the work item", async () => {
    const { tool, workItems, decisionExecutor, factSnapshot } = createTool();

    const parsed = tool.getDefinition().inputSchema.parse({
      project_id: "project-1",
      workItemId,
      status: "todo",
    });

    await tool.execute(context, parsed);

    expect(factSnapshot.publishWorkItemState).toHaveBeenCalledWith({
      projectId: "project-1",
      workItemId,
      currentStatus: "backlog",
    });
    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        requester: "kanban.work_item_transition_status",
        failureMetadata: {
          workItemId,
          status: "todo",
        },
        structuredDecision: {
          action: "transition_work_item_status",
          lane: "work_item_transition",
          intent_type: "validate_project_health",
          reason: `Transition ${workItemId} to todo`,
          work_item_ids: [workItemId],
          target_status: "todo",
          evidence: [{ kind: "tool_result", id: "transition-status-input" }],
        },
        execute: expect.any(Function),
      }),
    );
    expect(workItems.updateStatus).toHaveBeenCalledWith(
      "project-1",
      workItemId,
      "todo",
    );
  });

  it("derives project_id from context.scopeId while keeping workItemId explicit", async () => {
    const { tool, workItems, decisionExecutor, factSnapshot } = createTool();

    const parsed = tool.getDefinition().inputSchema.parse({
      workItemId,
      status: "todo",
    });

    await tool.execute({ scopeId: "project-from-context" }, parsed);

    expect(factSnapshot.publishWorkItemState).toHaveBeenCalledWith({
      projectId: "project-from-context",
      workItemId,
      currentStatus: "backlog",
    });
    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-from-context",
        failureMetadata: expect.objectContaining({
          workItemId,
          status: "todo",
        }),
      }),
    );
    expect(workItems.updateStatus).toHaveBeenCalledWith(
      "project-from-context",
      workItemId,
      "todo",
    );
  });

  it("throws BadRequestException when project_id and context scope are both missing", async () => {
    const { tool } = createTool();

    await expect(
      tool.execute(
        {},
        {
          workItemId,
          status: "todo",
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("allows todo to in-progress when project capacity has available slots", async () => {
    const { tool, workItems, kanbanSettings, decisionExecutor } = createTool({
      workItems: {
        updateStatus: vi.fn().mockResolvedValue({ id: workItemId }),
        listWorkItems: vi.fn().mockResolvedValue([item(workItemId, "todo")]),
      },
      kanbanSettings: { getNumber: vi.fn().mockResolvedValue(1) },
    });

    await tool.execute(context, {
      project_id: "project-1",
      workItemId,
      status: "in-progress",
    });

    expect(kanbanSettings.getNumber).toHaveBeenCalledWith(
      "work_item_dispatch_max_active_per_project",
    );
    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        failureMetadata: expect.objectContaining({
          activeCount: 0,
          maxActive: 1,
          availableSlots: 1,
        }),
      }),
    );
    expect(workItems.updateStatus).toHaveBeenCalledWith(
      "project-1",
      workItemId,
      "in-progress",
    );
  });

  it("rejects todo to in-progress when project capacity is reached with capacity metadata", async () => {
    const { tool, workItems, decisionExecutor, kanbanSettings } = createTool({
      workItems: {
        updateStatus: vi.fn(),
        listWorkItems: vi
          .fn()
          .mockResolvedValue([
            item(workItemId, "todo"),
            item("active-1", "in-progress"),
          ]),
      },
      kanbanSettings: { getNumber: vi.fn().mockResolvedValue(1) },
    });

    await expect(
      tool.execute(context, {
        project_id: "project-1",
        workItemId,
        status: "in-progress",
      }),
    ).rejects.toMatchObject({
      response: {
        error: "Bad Request",
        message:
          "Project WIP limit reached: activeCount=1, maxActive=1, availableSlots=0, reason=project_wip_limit_reached",
        statusCode: 400,
      },
    });

    expect(kanbanSettings.getNumber).toHaveBeenCalledWith(
      "work_item_dispatch_max_active_per_project",
    );
    expect(workItems.updateStatus).not.toHaveBeenCalled();
    expect(
      decisionExecutor.executeDirectMutationDecision,
    ).not.toHaveBeenCalled();
  });

  it("allows same-status in-progress transitions when already at capacity", async () => {
    const { tool, workItems, decisionExecutor } = createTool({
      workItems: {
        updateStatus: vi.fn().mockResolvedValue({ id: workItemId }),
        listWorkItems: vi
          .fn()
          .mockResolvedValue([item(workItemId, "in-progress")]),
      },
      kanbanSettings: { getNumber: vi.fn().mockResolvedValue(1) },
    });

    await tool.execute(context, {
      project_id: "project-1",
      workItemId,
      status: "in-progress",
    });

    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalled();
    expect(workItems.updateStatus).toHaveBeenCalledWith(
      "project-1",
      workItemId,
      "in-progress",
    );
  });

  it("allows active-to-active transitions when already at capacity", async () => {
    const { tool, workItems } = createTool({
      workItems: {
        updateStatus: vi.fn().mockResolvedValue({ id: workItemId }),
        listWorkItems: vi
          .fn()
          .mockResolvedValue([item(workItemId, "in-progress")]),
      },
      kanbanSettings: { getNumber: vi.fn().mockResolvedValue(1) },
    });

    await tool.execute(context, {
      project_id: "project-1",
      workItemId,
      status: "in-review",
    });

    expect(workItems.updateStatus).toHaveBeenCalledWith(
      "project-1",
      workItemId,
      "in-review",
    );
  });

  it("allows non-active transitions when already at capacity", async () => {
    const { tool, workItems, kanbanSettings } = createTool({
      workItems: {
        updateStatus: vi.fn().mockResolvedValue({ id: workItemId }),
        listWorkItems: vi
          .fn()
          .mockResolvedValue([
            item(workItemId, "in-progress"),
            item("active-1", "in-progress"),
          ]),
      },
      kanbanSettings: { getNumber: vi.fn().mockResolvedValue(1) },
    });

    await tool.execute(context, {
      project_id: "project-1",
      workItemId,
      status: "done",
    });

    expect(kanbanSettings.getNumber).not.toHaveBeenCalled();
    expect(workItems.updateStatus).toHaveBeenCalledWith(
      "project-1",
      workItemId,
      "done",
    );
  });

  it("normalizes underscore statuses before cap evaluation and updating the work item", async () => {
    const { tool, workItems, decisionExecutor } = createTool({
      workItems: {
        updateStatus: vi.fn().mockResolvedValue({ id: workItemId }),
        listWorkItems: vi.fn().mockResolvedValue([item(workItemId, "todo")]),
      },
      kanbanSettings: { getNumber: vi.fn().mockResolvedValue(2) },
    });

    const parsed = tool.getDefinition().inputSchema.parse({
      project_id: "project-1",
      workItemId,
      status: "in_progress",
    });

    await tool.execute(context, parsed);

    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        structuredDecision: expect.objectContaining({
          reason: `Transition ${workItemId} to in-progress`,
          target_status: "in-progress",
        }),
      }),
    );
    expect(workItems.updateStatus).toHaveBeenCalledWith(
      "project-1",
      workItemId,
      "in-progress",
    );
  });

  it("routes the status transition through the work_item_transition lane", async () => {
    const executeDirectMutationDecision = vi
      .fn()
      .mockResolvedValue({ ok: true });
    const { tool } = createTool({
      decisionExecutor: { executeDirectMutationDecision },
      workItems: {
        updateStatus: vi.fn().mockResolvedValue({ id: workItemId }),
        listWorkItems: vi.fn().mockResolvedValue([item(workItemId, "backlog")]),
      },
    });

    await tool.execute(context, {
      project_id: "p1",
      workItemId,
      status: "ready-to-merge",
    });

    const decision =
      executeDirectMutationDecision.mock.calls[0][0].structuredDecision;
    expect(decision.lane).toBe("work_item_transition");
    expect(decision.action).toBe("transition_work_item_status");
  });

  it("does not update status when the decision is not launchable", async () => {
    const decisionExecutor = createDecisionExecutor();
    decisionExecutor.executeDirectMutationDecision.mockRejectedValue(
      new Error("Decision is not launchable: conflict_key_active"),
    );
    const { tool, workItems, factSnapshot } = createTool({
      decisionExecutor,
    });

    await expect(
      tool.execute(context, {
        project_id: "project-1",
        workItemId,
        status: "todo",
      }),
    ).rejects.toThrow("Decision is not launchable: conflict_key_active");

    expect(factSnapshot.publishWorkItemState).toHaveBeenCalled();
    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalled();
    expect(workItems.updateStatus).not.toHaveBeenCalled();
  });
});

describe("WorkItemTransitionStatusTool preflight reroute", () => {
  function buildTool(overrides: {
    currentStatus: string;
    metadata?: unknown;
    preflightEnabled: boolean;
  }) {
    const workItem = {
      id: "wi-1",
      project_id: "proj-1",
      status: overrides.currentStatus,
      scope: "standard",
      metadata: overrides.metadata ?? {},
    };
    const updateStatus = vi.fn(
      (
        _p: string,
        _id: string,
        status: string,
      ): Promise<{ id: string; status: string }> =>
        Promise.resolve({ id: "wi-1", status }),
    );
    const workItems = {
      listWorkItems: vi.fn(() => Promise.resolve([workItem])),
      updateStatus,
    } as unknown as ConstructorParameters<
      typeof WorkItemTransitionStatusTool
    >[0];
    const decisionExecutor = {
      executeDirectMutationDecision: vi.fn(
        (args: { execute: () => Promise<unknown> }) => args.execute(),
      ),
    } as unknown as ConstructorParameters<
      typeof WorkItemTransitionStatusTool
    >[1];
    const factSnapshot = {
      publishWorkItemState: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as ConstructorParameters<
      typeof WorkItemTransitionStatusTool
    >[2];
    const kanbanSettings = {
      getBoolean: vi.fn((key: string) =>
        Promise.resolve(
          key === "work_item_preflight_pipeline_enabled"
            ? overrides.preflightEnabled
            : false,
        ),
      ),
      getNumber: vi.fn(() => Promise.resolve(50)),
    } as unknown as ConstructorParameters<
      typeof WorkItemTransitionStatusTool
    >[3];

    const tool = new WorkItemTransitionStatusTool(
      workItems,
      decisionExecutor,
      factSnapshot,
      kanbanSettings,
    );
    return { tool, updateStatus };
  }

  const ctx = { scopeId: "proj-1" } as never;

  it("reroutes backlog→todo to refinement when preflight enabled and not cleared", async () => {
    const { tool, updateStatus } = buildTool({
      currentStatus: "backlog",
      preflightEnabled: true,
    });
    await tool["run"](ctx, {
      project_id: "proj-1",
      workItemId: "wi-1",
      status: "todo",
    });
    expect(updateStatus).toHaveBeenCalledWith("proj-1", "wi-1", "refinement");
  });

  it("keeps backlog→todo as todo when preflight disabled", async () => {
    const { tool, updateStatus } = buildTool({
      currentStatus: "backlog",
      preflightEnabled: false,
    });
    await tool["run"](ctx, {
      project_id: "proj-1",
      workItemId: "wi-1",
      status: "todo",
    });
    expect(updateStatus).toHaveBeenCalledWith("proj-1", "wi-1", "todo");
  });

  it("does not reroute when item already cleared refinement", async () => {
    const { tool, updateStatus } = buildTool({
      currentStatus: "backlog",
      preflightEnabled: true,
      metadata: { refinement: { hasClearedRefinementOnce: true } },
    });
    await tool["run"](ctx, {
      project_id: "proj-1",
      workItemId: "wi-1",
      status: "todo",
    });
    expect(updateStatus).toHaveBeenCalledWith("proj-1", "wi-1", "todo");
  });

  it("does not reroute an explicit CEO backward move todo→backlog", async () => {
    const { tool, updateStatus } = buildTool({
      currentStatus: "todo",
      preflightEnabled: true,
    });
    await tool["run"](ctx, {
      project_id: "proj-1",
      workItemId: "wi-1",
      status: "backlog",
    });
    expect(updateStatus).toHaveBeenCalledWith("proj-1", "wi-1", "backlog");
  });
});
