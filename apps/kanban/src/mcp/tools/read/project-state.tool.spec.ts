import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { ProjectStateTool } from "./project-state.tool";
import type { ProjectService } from "../../../project/project.service";
import type { WorkItemService } from "../../../work-item/work-item.service";
import type { ProjectGoalsService } from "../../../goals/project-goals.service";
import type { OrchestrationService } from "../../../orchestration/orchestration.service";
import type { ProjectMemorySummaryService } from "../../../project/project-memory-summary.service";
import type { OrchestrationFactSnapshotService } from "../../../orchestration/control-plane/orchestration-fact-snapshot.service";
import type { InitiativesService } from "../../../initiatives/initiatives.service";
import type { ProjectStrategicStateService } from "../../../orchestration/strategic/project-strategic-state.service";

interface ProjectMemorySummary {
  entity_type: "kanban.project";
  entity_id: string;
  totalCount: number;
  byType: {
    preference: number;
    fact: number;
    history: number;
  };
  retrievalTool: "query_memory";
}

interface MemorySummaryCollaborator {
  getProjectMemorySummary: (
    project_id: string,
  ) => Promise<ProjectMemorySummary>;
}

interface ActivitySummaryEntry {
  action: string;
  timestamp: string;
}

interface ActivitySummaryResult {
  totalActionCount: number;
  recent: ActivitySummaryEntry[];
}

interface MockProjects {
  get: ReturnType<typeof vi.fn>;
}

interface MockWorkItems {
  listWorkItems: ReturnType<typeof vi.fn>;
}

interface MockGoals {
  listGoals: ReturnType<typeof vi.fn>;
}

interface MockOrchestration {
  getDiagnostics: ReturnType<typeof vi.fn>;
  getActivitySummary: ReturnType<typeof vi.fn>;
}

describe("ProjectStateTool", () => {
  let context: InternalToolExecutionContext;
  let projects: MockProjects;
  let workItems: MockWorkItems;
  let goals: MockGoals;
  let orchestration: MockOrchestration;
  let memories: MemorySummaryCollaborator;
  let tool: ProjectStateTool;
  let factSnapshot: { publishProjectStateSnapshot: ReturnType<typeof vi.fn> };
  let strategicState: { buildStrategicState: ReturnType<typeof vi.fn> };

  const projectId = "project-1";

  beforeEach(() => {
    vi.clearAllMocks();

    context = {};

    const projectEntity = {
      id: projectId,
      name: "Test Project",
      description: "For testing",
    };

    const workItemEntities = [
      { id: "wi-1", title: "Task A", status: "todo" },
      { id: "wi-2", title: "Task B", status: "in_progress" },
    ];

    const goalEntities = [{ id: "goal-1", title: "Goal X", status: "todo" }];

    const orchestrationDiagnostics = {
      project_id: projectId,
      blocked: false,
      reasons: [],
      decisionCount: 0,
      decisionHistory: [
        {
          type: "cycle_decision",
          reasoning: "Observed reasoning",
          recommendation: "Do not expose this recommendation",
          readinessSignals: { stale: true },
          recommendedWorkflowId: "legacy-workflow",
          selectedRoute: "legacy-route",
        },
      ],
      lastDecision: {
        type: "cycle_decision",
        reasoning: "Observed last reasoning",
        needsRecovery: true,
        recommendation: "Do not expose this last recommendation",
        readyForDispatch: true,
        selectedRuleId: "legacy-rule",
      },
    };

    const memorySummary: ProjectMemorySummary = {
      entity_type: "kanban.project",
      entity_id: projectId,
      totalCount: 12,
      byType: {
        preference: 3,
        fact: 5,
        history: 4,
      },
      retrievalTool: "query_memory",
    };

    const activitySummary: ActivitySummaryResult = {
      totalActionCount: 7,
      recent: [
        { action: "status_update", timestamp: "2026-05-11T00:00:00.000Z" },
        { action: "dispatch", timestamp: "2026-05-10T00:00:00.000Z" },
        { action: "goal_update", timestamp: "2026-05-09T00:00:00.000Z" },
        { action: "work_item_create", timestamp: "2026-05-08T00:00:00.000Z" },
        { action: "diagnostic_check", timestamp: "2026-05-07T00:00:00.000Z" },
      ],
    };

    projects = {
      get: vi.fn().mockResolvedValue(projectEntity),
    };

    workItems = {
      listWorkItems: vi.fn().mockResolvedValue(workItemEntities),
    };

    goals = {
      listGoals: vi.fn().mockResolvedValue(goalEntities),
    };

    orchestration = {
      getDiagnostics: vi.fn().mockResolvedValue(orchestrationDiagnostics),
      getActivitySummary: vi.fn().mockResolvedValue(activitySummary),
    };

    memories = {
      getProjectMemorySummary: vi.fn().mockResolvedValue(memorySummary),
    };

    factSnapshot = {
      publishProjectStateSnapshot: vi.fn().mockResolvedValue(undefined),
    };

    strategicState = {
      buildStrategicState: vi.fn().mockResolvedValue({
        staleness: {
          lastDiscoveryAt: null,
          mergesSinceDiscovery: 0,
          commitsSinceDiscovery: null,
          lastCharterUpdateAt: null,
          lastInitiativeReviewAt: null,
          lastWorkItemCreatedAt: null,
          backlogDepth: 0,
          recentBurnRatePerCycle: 0,
          starvationForecastCycles: null,
          activeNowInitiativeCount: 0,
        },
        latestStrategicIntent: null,
      }),
    };

    tool = new ProjectStateTool(
      projects as unknown as ProjectService,
      workItems as unknown as WorkItemService,
      goals as unknown as ProjectGoalsService,
      orchestration as unknown as OrchestrationService,
      memories as unknown as ProjectMemorySummaryService,
      factSnapshot as unknown as OrchestrationFactSnapshotService,
      { listInitiatives: vi.fn().mockResolvedValue([]) } as never,
      strategicState as never,
      { getNumber: vi.fn().mockResolvedValue(3) } as never,
    );
  });

  it("has tool name kanban.project_state from both getName and getDefinition", () => {
    expect(tool.getName()).toBe("kanban.project_state");
    expect(tool.getDefinition().name).toBe("kanban.project_state");
  });

  it("returns project, workItems, goals, orchestration, memorySummary, and recentActivity", async () => {
    const result = await tool.execute(context, {
      project_id: projectId,
      include_work_item_bodies: true,
    });

    expect(result).toMatchObject({
      project: expect.objectContaining({ id: projectId, name: "Test Project" }),
      workItems: expect.arrayContaining([
        expect.objectContaining({ id: "wi-1" }),
        expect.objectContaining({ id: "wi-2" }),
      ]),
      goals: expect.arrayContaining([
        expect.objectContaining({ id: "goal-1" }),
      ]),
      orchestration: expect.objectContaining({
        project_id: projectId,
      }),
      memorySummary: expect.objectContaining({
        entity_type: "kanban.project",
        entity_id: projectId,
        totalCount: 12,
      }),
      recentActivity: expect.objectContaining({
        totalActionCount: 7,
        recent: expect.any(Array),
      }),
    });
  });

  it("derives project_id from context.scopeId when omitted", async () => {
    context = { scopeId: projectId };

    await tool.execute(context, {
      include_work_item_bodies: false,
    });

    expect(projects.get).toHaveBeenCalledWith(projectId);
    expect(workItems.listWorkItems).toHaveBeenCalledWith(projectId);
    expect(goals.listGoals).toHaveBeenCalledWith(projectId);
    expect(orchestration.getDiagnostics).toHaveBeenCalledWith(projectId);
    expect(memories.getProjectMemorySummary).toHaveBeenCalledWith(projectId);
    expect(factSnapshot.publishProjectStateSnapshot).toHaveBeenCalledWith({
      projectId,
      workItemCounts: expect.any(Object),
      totalCount: expect.any(Number),
    });
  });

  it("returns a compact summary before raw workItems for mixed work items", async () => {
    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-foundation",
        title: "Foundation complete",
        status: "done",
        priority: "p0",
      },
      {
        id: "wi-ready-camel",
        title: "Ready from camel dependencies",
        status: "todo",
        priority: "p1",
        dependencyIds: ["wi-foundation"],
      },
      {
        id: "wi-ready-snake",
        title: "Ready from snake dependencies",
        status: "todo",
        dependency_ids: ["wi-foundation"],
      },
      {
        id: "wi-waiting",
        title: "Waiting on unfinished work",
        status: "todo",
        priority: "p2",
        dependency_ids: ["wi-review"],
      },
      {
        id: "wi-review",
        title: "Still in review",
        status: "in-review",
      },
      {
        id: "wi-linked",
        title: "Already linked",
        status: "todo",
        priority: "p3",
        linked_run_id: "run-1",
      },
      {
        id: "wi-blocked",
        title: "Explicitly blocked",
        status: "blocked",
        priority: "p1",
      },
    ]);

    const result = await tool.execute(context, {
      project_id: projectId,
      include_work_item_bodies: true,
    });

    expect(Object.keys(result)).toEqual([
      "summary",
      "project",
      "workItems",
      "goals",
      "orchestration",
      "memorySummary",
      "recentActivity",
      "strategic",
    ]);
    expect(result).toMatchObject({
      summary: {
        workItemCounts: {
          done: 1,
          todo: 4,
          "in-review": 1,
          blocked: 1,
        },
        linkedRunCount: 1,
        dispatchableTodoCount: 2,
        dispatchableTodoItems: [
          {
            id: "wi-ready-camel",
            title: "Ready from camel dependencies",
            status: "todo",
            priority: "p1",
          },
          {
            id: "wi-ready-snake",
            title: "Ready from snake dependencies",
            status: "todo",
          },
        ],
        blockedItems: [
          {
            id: "wi-waiting",
            title: "Waiting on unfinished work",
            status: "todo",
            priority: "p2",
          },
          {
            id: "wi-blocked",
            title: "Explicitly blocked",
            status: "blocked",
            priority: "p1",
          },
        ],
      },
    });
  });

  it("excludes a todo container item (story with a child) from dispatchableTodoItems", async () => {
    // Regression coverage for the shared filterDispatchableTodo container
    // guard (epics and any item with children are never individually
    // dispatchable) — this call site already passes the full, unfiltered
    // workItems list, unlike the orchestration-continuation bug fixed
    // alongside this test.
    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-story-with-child",
        title: "Story with a child",
        status: "todo",
        type: "story",
      },
      {
        id: "wi-child",
        title: "Child of the story",
        status: "todo",
        type: "task",
        parentWorkItemId: "wi-story-with-child",
      },
      {
        id: "wi-childless",
        title: "Childless todo",
        status: "todo",
        type: "task",
      },
    ]);

    const result = await tool.execute(context, {
      project_id: projectId,
      include_work_item_bodies: true,
    });

    // dispatchableTodoCount only counts todo items that survive the shared
    // container guard (filterDispatchableTodo) — 2 (child + childless), not
    // all 3 todo items, because the story-with-a-child is a container.
    expect(result.summary.dispatchableTodoCount).toBe(2);
    expect(result.summary.workItemCounts.todo).toBe(3);
  });

  it("does not include readyForDispatch top-level key", async () => {
    const result = await tool.execute(context, { project_id: projectId });

    expect(result).not.toHaveProperty("readyForDispatch");
  });

  it("does not include needsRecovery top-level key", async () => {
    const result = await tool.execute(context, { project_id: projectId });

    expect(result).not.toHaveProperty("needsRecovery");
  });

  it("does not include selectedRoute top-level key", async () => {
    const result = await tool.execute(context, { project_id: projectId });

    expect(result).not.toHaveProperty("selectedRoute");
  });

  it("does not include selectedRuleId top-level key", async () => {
    const result = await tool.execute(context, { project_id: projectId });

    expect(result).not.toHaveProperty("selectedRuleId");
  });

  it("does not include recommendedWorkflowId top-level key", async () => {
    const result = await tool.execute(context, { project_id: projectId });

    expect(result).not.toHaveProperty("recommendedWorkflowId");
  });

  it("omits recommendation and route decision keys from orchestration diagnostics", async () => {
    const result = await tool.execute(context, { project_id: projectId });
    const serialized = JSON.stringify(result.orchestration);

    expect(serialized).not.toContain("recommendation");
    expect(serialized).not.toContain("needsRecovery");
    expect(serialized).not.toContain("readinessSignals");
    expect(serialized).not.toContain("readyForDispatch");
    expect(serialized).not.toContain("recommendedWorkflowId");
    expect(serialized).not.toContain("selectedRoute");
    expect(serialized).not.toContain("selectedRuleId");
    expect(serialized).toContain("Observed reasoning");
    expect(serialized).toContain("Observed last reasoning");
  });

  it("calls projects.get with the project_id", async () => {
    await tool.execute(context, { project_id: projectId });

    expect(projects.get).toHaveBeenCalledWith(projectId);
  });

  it("calls workItems.listWorkItems with the project_id", async () => {
    await tool.execute(context, { project_id: projectId });

    expect(workItems.listWorkItems).toHaveBeenCalledWith(projectId);
  });

  it("calls goals.listGoals with the project_id", async () => {
    await tool.execute(context, { project_id: projectId });

    expect(goals.listGoals).toHaveBeenCalledWith(projectId);
  });

  it("calls orchestration.getDiagnostics with the project_id", async () => {
    await tool.execute(context, { project_id: projectId });

    expect(orchestration.getDiagnostics).toHaveBeenCalledWith(projectId);
  });

  it("calls memories.getProjectMemorySummary with the project_id", async () => {
    await tool.execute(context, { project_id: projectId });

    expect(memories.getProjectMemorySummary).toHaveBeenCalledWith(projectId);
  });

  it("calls orchestration.getActivitySummary with the project_id and limit", async () => {
    await tool.execute(context, { project_id: projectId });

    expect(orchestration.getActivitySummary).toHaveBeenCalledWith(projectId, {
      limit: 5,
    });
  });

  it("publishes a project state snapshot fact after building the summary", async () => {
    await tool.execute(context, { project_id: projectId });

    expect(factSnapshot.publishProjectStateSnapshot).toHaveBeenCalledWith({
      projectId,
      workItemCounts: { todo: 1, in_progress: 1 },
      totalCount: 2,
    });
  });

  it("returns memorySummary from the memory collaborator", async () => {
    const result = await tool.execute(context, { project_id: projectId });

    expect(result.memorySummary).toEqual(
      expect.objectContaining({
        entity_type: "kanban.project",
        entity_id: projectId,
        totalCount: 12,
        byType: {
          preference: 3,
          fact: 5,
          history: 4,
        },
        retrievalTool: "query_memory",
      }),
    );
  });

  it("returns recentActivity from the orchestration activity collaborator", async () => {
    const result = await tool.execute(context, { project_id: projectId });

    expect(result.recentActivity).toEqual(
      expect.objectContaining({
        totalActionCount: 7,
        recent: expect.any(Array),
      }),
    );
  });

  it("falls back only when orchestration state is missing", async () => {
    orchestration.getDiagnostics.mockRejectedValue(new NotFoundException());
    orchestration.getActivitySummary.mockRejectedValue(new NotFoundException());

    const result = await tool.execute(context, { project_id: projectId });

    expect(result.orchestration).toBeNull();
    expect(result.recentActivity).toEqual({ totalActionCount: 0, recent: [] });
  });

  it("propagates orchestration diagnostics errors that are not missing state", async () => {
    orchestration.getDiagnostics.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      tool.execute(context, { project_id: projectId }),
    ).rejects.toThrow("database unavailable");
  });

  it("propagates activity summary errors that are not missing state", async () => {
    orchestration.getActivitySummary.mockRejectedValue(
      new Error("activity unavailable"),
    );

    await expect(
      tool.execute(context, { project_id: projectId }),
    ).rejects.toThrow("activity unavailable");
  });

  it("caps workItems to max_work_items when include_work_item_bodies is true", async () => {
    const manyItems = Array.from({ length: 150 }, (_, i) => ({
      id: `wi-${i}`,
      title: `Task ${i}`,
      status: i % 2 === 0 ? "todo" : "done",
    }));
    workItems.listWorkItems.mockResolvedValue(manyItems);

    const result = await tool.execute(context, {
      project_id: projectId,
      include_work_item_bodies: true,
      max_work_items: 50,
    });

    expect(result.workItems).toHaveLength(50);
    expect(result.summary.totalCount).toBe(150);
    expect(result.summary.workItemCounts.todo).toBe(75);
    expect(result.summary.workItemCounts.done).toBe(75);
  });

  it("caps workItems to default 100 when max_work_items is not specified", async () => {
    const manyItems = Array.from({ length: 150 }, (_, i) => ({
      id: `wi-${i}`,
      title: `Task ${i}`,
      status: "todo",
    }));
    workItems.listWorkItems.mockResolvedValue(manyItems);

    const result = await tool.execute(context, {
      project_id: projectId,
      include_work_item_bodies: true,
    });

    expect(result.workItems).toHaveLength(100);
    expect(result.summary.totalCount).toBe(150);
  });

  it("does not include workItems key when include_work_item_bodies is false", async () => {
    const manyItems = Array.from({ length: 150 }, (_, i) => ({
      id: `wi-${i}`,
      title: `Task ${i}`,
      status: "todo",
    }));
    workItems.listWorkItems.mockResolvedValue(manyItems);

    const result = await tool.execute(context, {
      project_id: projectId,
      include_work_item_bodies: false,
      max_work_items: 10,
    });

    expect(result).not.toHaveProperty("workItems");
    expect(result.summary.totalCount).toBe(150);
  });
});

describe("ProjectStateTool strategic block", () => {
  it("includes a strategic.initiatives array sourced from InitiativesService", async () => {
    const initiativesStub = {
      listInitiatives: vi.fn().mockResolvedValue([
        {
          id: "i1",
          title: "Harden loop",
          horizon: "now",
          priority: 0,
          status: "active",
          goalIds: [],
          lastReviewedAt: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ]),
    };
    const tool = new ProjectStateTool(
      { get: vi.fn().mockResolvedValue({ id: "p1" }) } as never,
      { listWorkItems: vi.fn().mockResolvedValue([]) } as never,
      { listGoals: vi.fn().mockResolvedValue([]) } as never,
      {
        getDiagnostics: vi.fn().mockResolvedValue(null),
        getActivitySummary: vi
          .fn()
          .mockResolvedValue({ totalActionCount: 0, recent: [] }),
      } as never,
      { getProjectMemorySummary: vi.fn().mockResolvedValue({}) } as never,
      {
        publishProjectStateSnapshot: vi.fn().mockResolvedValue(undefined),
      } as never,
      initiativesStub as never,
      {
        buildStrategicState: vi.fn().mockResolvedValue({
          staleness: {
            lastDiscoveryAt: null,
            mergesSinceDiscovery: 0,
            commitsSinceDiscovery: null,
            lastCharterUpdateAt: null,
            lastInitiativeReviewAt: null,
            lastWorkItemCreatedAt: null,
            backlogDepth: 0,
            recentBurnRatePerCycle: 0,
            starvationForecastCycles: null,
            activeNowInitiativeCount: 0,
          },
          latestStrategicIntent: null,
        }),
      } as never,
      { getNumber: vi.fn().mockResolvedValue(3) } as never,
    );
    const result = (await tool.execute(
      { scopeId: "p1" },
      { max_work_items: 100 },
    )) as { strategic: { initiatives: Array<{ id: string }> } };
    expect(initiativesStub.listInitiatives).toHaveBeenCalledWith("p1");
    expect(result.strategic.initiatives).toEqual([
      expect.objectContaining({ id: "i1", horizon: "now" }),
    ]);
  });
});

describe("ProjectStateTool promotable backlog and capacity", () => {
  const projectId = "p-dispatch";

  function buildDispatchTool(
    mockWorkItemList: unknown[],
    maxActiveOverride = 3,
  ) {
    const kanbanSettings = {
      getNumber: vi.fn().mockResolvedValue(maxActiveOverride),
    };

    return new ProjectStateTool(
      { get: vi.fn().mockResolvedValue({ id: projectId }) } as never,
      { listWorkItems: vi.fn().mockResolvedValue(mockWorkItemList) } as never,
      { listGoals: vi.fn().mockResolvedValue([]) } as never,
      {
        getDiagnostics: vi.fn().mockResolvedValue(null),
        getActivitySummary: vi
          .fn()
          .mockResolvedValue({ totalActionCount: 0, recent: [] }),
      } as never,
      { getProjectMemorySummary: vi.fn().mockResolvedValue({}) } as never,
      {
        publishProjectStateSnapshot: vi.fn().mockResolvedValue(undefined),
      } as never,
      { listInitiatives: vi.fn().mockResolvedValue([]) } as never,
      {
        buildStrategicState: vi.fn().mockResolvedValue({
          staleness: {
            lastDiscoveryAt: null,
            mergesSinceDiscovery: 0,
            commitsSinceDiscovery: null,
            lastCharterUpdateAt: null,
            lastInitiativeReviewAt: null,
            lastWorkItemCreatedAt: null,
            backlogDepth: 0,
            recentBurnRatePerCycle: 0,
            starvationForecastCycles: null,
            activeNowInitiativeCount: 0,
          },
          latestStrategicIntent: null,
        }),
      } as never,
      kanbanSettings as never,
    );
  }

  it("includes only promotable backlog items (status backlog, deps met, no human_decision flag)", async () => {
    const workItemList = [
      // Promotable: status backlog, no deps, no human_decision metadata
      { id: "wi-promotable", title: "Ready to go", status: "backlog" },
      // Not promotable: dependency not done
      {
        id: "wi-blocked-dep",
        title: "Blocked by dep",
        status: "backlog",
        dependencyIds: ["wi-in-review"],
      },
      // Not promotable: has human_decision flag in metadata
      {
        id: "wi-human-decision",
        title: "Needs human decision",
        status: "backlog",
        metadata: { human_decision: { reason: "needs approval" } },
      },
      // Not promotable: in-review (used as unmet dependency above)
      { id: "wi-in-review", title: "In review", status: "in-review" },
    ];

    const tool = buildDispatchTool(workItemList);
    const result = await tool.execute(
      { scopeId: projectId },
      { max_work_items: 100 },
    );

    expect(result.strategic.dispatch.promotableBacklog).toHaveLength(1);
    expect(result.strategic.dispatch.promotableBacklog[0]).toMatchObject({
      id: "wi-promotable",
      status: "backlog",
    });
  });

  it("computes capacity from WIP setting and active work items", async () => {
    const workItemList = [
      { id: "wi-active", title: "In progress", status: "in-progress" },
      { id: "wi-backlog", title: "Waiting", status: "backlog" },
    ];

    // maxActive = 3, 1 active item => availableSlots = 2
    const tool = buildDispatchTool(workItemList, 3);
    const result = await tool.execute(
      { scopeId: projectId },
      { max_work_items: 100 },
    );

    expect(result.strategic.dispatch.capacity.availableSlots).toBe(2);
    expect(result.strategic.dispatch.capacity.canLaunchNewWork).toBe(true);
    expect(result.strategic.dispatch.capacity.maxActive).toBe(3);
    expect(result.strategic.dispatch.capacity.activeCount).toBe(1);
  });

  it("exposes escalated blocked items with their recommendation and replanAttempts", async () => {
    const tool = buildDispatchTool([
      {
        id: "wi-escalated",
        title: "Resolve hardcoded token cap",
        status: "blocked",
        priority: "p1",
        metadata: {
          escalation: {
            reason: "repeated_ac_failure",
            escalatedAt: "2026-06-16T09:51:00.000Z",
            recommendation: "fresh_architect_pass",
            replanAttempts: 1,
          },
        },
      },
      // A plain blocked item WITHOUT escalation metadata must NOT appear.
      { id: "wi-plain-blocked", title: "Waiting on dep", status: "blocked" },
      // A backlog item must remain promotable, unaffected.
      { id: "wi-backlog", title: "New feature", status: "backlog" },
    ]);

    const result = await tool.execute(
      { scopeId: projectId },
      { max_work_items: 100 },
    );

    const escalated = result.strategic.dispatch.escalatedBlockedItems;
    expect(escalated).toHaveLength(1);
    expect(escalated[0]).toMatchObject({
      id: "wi-escalated",
      recommendation: "fresh_architect_pass",
      reason: "repeated_ac_failure",
      replanAttempts: 1,
    });
    // Unaffected sets:
    expect(
      result.strategic.dispatch.escalatedBlockedItems.map((i) => i.id),
    ).not.toContain("wi-plain-blocked");
    expect(
      result.strategic.dispatch.promotableBacklog.map((i) => i.id),
    ).toContain("wi-backlog");
  });

  it("defaults replanAttempts to 0 when escalation metadata omits it", async () => {
    const tool = buildDispatchTool([
      {
        id: "wi-escalated",
        title: "X",
        status: "blocked",
        metadata: {
          escalation: {
            reason: "repeated_ac_failure",
            escalatedAt: "2026-06-16T09:51:00.000Z",
            recommendation: "fresh_architect_pass",
          },
        },
      },
    ]);
    const result = await tool.execute(
      { scopeId: projectId },
      { max_work_items: 100 },
    );
    expect(
      result.strategic.dispatch.escalatedBlockedItems[0].replanAttempts,
    ).toBe(0);
  });
});

describe("ProjectStateTool strategic staleness + intent + initiative open-counts", () => {
  const projectId = "p-staleness";

  const mockInitiatives = [
    {
      id: "init-1",
      project_id: projectId,
      title: "Core initiative",
      description: null,
      horizon: "now" as const,
      priority: 0,
      status: "active" as const,
      goalIds: ["goal-1"],
      lastReviewedAt: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  const mockStrategicState = {
    staleness: {
      lastDiscoveryAt: "2026-05-01T00:00:00.000Z",
      mergesSinceDiscovery: 4,
      commitsSinceDiscovery: null,
      lastCharterUpdateAt: null,
      lastInitiativeReviewAt: null,
      lastWorkItemCreatedAt: null,
      backlogDepth: 2,
      recentBurnRatePerCycle: 0.5,
      starvationForecastCycles: 4,
      activeNowInitiativeCount: 0,
    },
    latestStrategicIntent: {
      kind: "strategic_intent" as const,
      focus_initiative_id: "init-1",
      rationale: "Focus on core initiative",
      planned_next_steps: ["Step A"],
      staleness_actions: [],
      created_at: "2026-05-10T00:00:00.000Z",
    },
  };

  const mockWorkItems = [
    {
      id: "wi-open",
      title: "Open task",
      status: "todo",
      initiative_id: "init-1",
    },
    {
      id: "wi-done",
      title: "Done task",
      status: "done",
      initiative_id: "init-1",
    },
    {
      id: "wi-other",
      title: "Unlinked task",
      status: "todo",
    },
  ];

  function buildTool(overrides?: {
    strategicState?: { buildStrategicState: ReturnType<typeof vi.fn> };
  }) {
    const strategicState = overrides?.strategicState ?? {
      buildStrategicState: vi.fn().mockResolvedValue(mockStrategicState),
    };

    return new ProjectStateTool(
      { get: vi.fn().mockResolvedValue({ id: projectId }) } as never,
      { listWorkItems: vi.fn().mockResolvedValue(mockWorkItems) } as never,
      { listGoals: vi.fn().mockResolvedValue([]) } as never,
      {
        getDiagnostics: vi.fn().mockResolvedValue(null),
        getActivitySummary: vi
          .fn()
          .mockResolvedValue({ totalActionCount: 0, recent: [] }),
      } as never,
      { getProjectMemorySummary: vi.fn().mockResolvedValue({}) } as never,
      {
        publishProjectStateSnapshot: vi.fn().mockResolvedValue(undefined),
      } as never,
      { listInitiatives: vi.fn().mockResolvedValue(mockInitiatives) } as never,
      strategicState as unknown as ProjectStrategicStateService,
      { getNumber: vi.fn().mockResolvedValue(3) } as never,
    );
  }

  it("surfaces staleness, latestStrategicIntent, and initiative openWorkItemCount in strategic block", async () => {
    const tool = buildTool();

    const result = await tool.execute(
      { scopeId: projectId },
      { max_work_items: 100 },
    );

    expect(result.strategic.staleness.mergesSinceDiscovery).toBe(4);
    expect(result.strategic.staleness.activeNowInitiativeCount).toBe(0);
    expect(result.strategic.latestStrategicIntent).toMatchObject({
      kind: "strategic_intent",
    });
    expect(result.strategic.initiatives[0]).toMatchObject({
      id: "init-1",
      openWorkItemCount: 1,
    });
  });
});
