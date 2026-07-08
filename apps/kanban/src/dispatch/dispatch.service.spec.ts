import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BaseRequestContextService,
  WorkflowRunAcceptedV1,
  WorkflowRunRequestV1,
  WorkflowRunStatusV1,
} from "@nexus/core";
import type { CoreDispatchClient } from "./dispatch-internal.types";
import { DispatchService } from "./dispatch.service";
import { dispatchWorkItems } from "./dispatch-work-items.core";

type WorkItemFixture = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  priority: string;
  scope: "standard" | "large";
  assigned_agent_id: string | null;
  token_spend: number;
  current_execution_id: string | null;
  waiting_for_input: boolean;
  execution_config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  linked_run_id: string | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

const planFixture = (file: string) => ({
  implementationPlan: {
    milestones: [{ name: "M1", tasks: [{ id: "1.1", target_files: [file] }] }],
  },
});

describe("DispatchService", () => {
  const now = new Date("2026-04-29T00:00:00.000Z");
  const previousKanbanMcpServerId = process.env.KANBAN_MCP_SERVER_ID;
  const previousKanbanMcpServerIds = process.env.KANBAN_MCP_SERVER_IDS;
  const previousKanbanMcpUrl = process.env.KANBAN_MCP_URL;
  const previousServiceToken = process.env.KANBAN_SERVICE_BEARER_TOKEN;
  let items: WorkItemFixture[];
  let dependencies: Array<{
    work_item_id: string;
    depends_on_work_item_id: string;
  }>;
  let capturedRequests: WorkflowRunRequestV1[];
  let statuses: Map<string, WorkflowRunStatusV1>;
  let coreClient: CoreDispatchClient;
  let kanbanSettings: {
    getNumber: ReturnType<typeof vi.fn>;
    getBoolean: ReturnType<typeof vi.fn>;
  };
  let updateWorkItemStatus: ReturnType<typeof vi.fn>;
  let projectRepositoryFindById: ReturnType<typeof vi.fn>;

  const repository = {
    findByproject_id: vi.fn((project_id: string) =>
      Promise.resolve(items.filter((item) => item.project_id === project_id)),
    ),
    findByIds: vi.fn((workItemIds: string[]) =>
      Promise.resolve(items.filter((item) => workItemIds.includes(item.id))),
    ),
    findDependenciesByWorkItemIds: vi.fn((workItemIds: string[]) =>
      Promise.resolve(
        dependencies.filter((dependency) =>
          workItemIds.includes(dependency.work_item_id),
        ),
      ),
    ),
    save: vi.fn((input: WorkItemFixture) => {
      const index = items.findIndex((item) => item.id === input.id);
      const next = { ...input, updated_at: now };
      if (index >= 0) {
        items[index] = next;
      } else {
        items.push(next);
      }
      return Promise.resolve(next);
    }),
    findByProjectAndId: vi.fn((project_id: string, workItemId: string) =>
      Promise.resolve(
        items.find(
          (item) => item.project_id === project_id && item.id === workItemId,
        ) ?? null,
      ),
    ),
    clearRunLinksIfMatches: vi.fn(
      (project_id: string, workItemId: string, runId: string) => {
        const index = items.findIndex(
          (item) => item.project_id === project_id && item.id === workItemId,
        );
        const item = items[index];
        if (
          !item ||
          item.linked_run_id !== runId ||
          (item.current_execution_id !== null &&
            item.current_execution_id !== runId)
        ) {
          return Promise.resolve(false);
        }
        items[index] = {
          ...item,
          linked_run_id: null,
          current_execution_id: null,
          updated_at: now,
        };
        return Promise.resolve(true);
      },
    ),
    linkRunIfUnlinked: vi.fn(
      (params: { project_id: string; workItemId: string; runId: string }) => {
        const index = items.findIndex(
          (item) =>
            item.project_id === params.project_id &&
            item.id === params.workItemId,
        );
        const item = items[index];
        if (!item) return Promise.resolve(false);
        if (item.linked_run_id !== null || item.current_execution_id !== null) {
          return Promise.resolve(false);
        }
        items[index] = {
          ...item,
          linked_run_id: params.runId,
          current_execution_id: params.runId,
          updated_at: now,
        };
        return Promise.resolve(true);
      },
    ),
  };

  const accepted = (workItemId: string): WorkflowRunAcceptedV1 => ({
    run_id: `run-${workItemId}`,
    workflow_id: "implement-work-item",
    status: "accepted",
    accepted_at: now.toISOString(),
    metadata: { correlation_id: "corr-dispatch" },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    capturedRequests = [];
    statuses = new Map();
    dependencies = [];
    items = [
      workItem("blocked-by-dependency", "todo"),
      workItem("done-dependency", "done"),
      workItem("ready-high-priority", "todo", { priority: "p0" }),
      workItem("active-agent-a", "in-progress", {
        assigned_agent_id: "agent-a",
        linked_run_id: "run-active-agent-a",
      }),
      workItem("ready-agent-a", "todo", {
        assigned_agent_id: "agent-a",
        priority: "p1",
      }),
    ];
    dependencies.push({
      work_item_id: "blocked-by-dependency",
      depends_on_work_item_id: "missing-done",
    });

    const requestContext = {
      getRequestId: () => "corr-dispatch",
      getCausationId: () => "cause-dispatch",
    } as unknown as BaseRequestContextService;

    coreClient = {
      requestWorkflowRun: (request: WorkflowRunRequestV1) => {
        capturedRequests.push(request);
        return Promise.resolve(
          accepted(String(request.input.contextId ?? request.input.context_id)),
        );
      },
      getWorkflowRunStatus: (runId: string) => {
        const status = statuses.get(runId);
        if (!status) throw new Error(`status unavailable for ${runId}`);
        return Promise.resolve(status);
      },
      emitDomainEventOrThrow: vi.fn(() => Promise.resolve()),
    };
    kanbanSettings = {
      getNumber: vi.fn(() => Promise.resolve(3)),
      getBoolean: vi.fn(() => Promise.resolve(false)),
    };
    updateWorkItemStatus = vi.fn(
      (project_id: string, workItemId: string, status: string) => {
        const item = items.find(
          (candidate) =>
            candidate.project_id === project_id && candidate.id === workItemId,
        );
        if (!item) throw new Error(`work item not found: ${workItemId}`);
        const next = { ...item, status, updated_at: now };
        const index = items.findIndex(
          (candidate) => candidate.id === workItemId,
        );
        items[index] = next;
        return Promise.resolve(next);
      },
    );

    projectRepositoryFindById = vi.fn().mockResolvedValue(null);

    service = new DispatchService(
      coreClient,
      requestContext,
      repository as never,
      { updateStatus: updateWorkItemStatus } as never,
      kanbanSettings as never,
      { get: vi.fn().mockResolvedValue(null) } as never,
      { findById: projectRepositoryFindById } as never,
    );
  });

  it("propagates orchestration cycle event emission failures", async () => {
    const emitDomainEventOrThrow = vi
      .fn()
      .mockRejectedValue(new Error("core unavailable"));
    const throwingCoreClient = {
      ...coreClient,
      emitDomainEventOrThrow,
    } as unknown as CoreDispatchClient;
    const throwingService = new DispatchService(
      throwingCoreClient,
      {
        getRequestId: () => "corr-dispatch",
        getCausationId: () => "cause-dispatch",
      },
      repository as never,
      { updateStatus: updateWorkItemStatus } as never,
      kanbanSettings as never,
      { get: vi.fn().mockResolvedValue(null) } as never,
      { findById: vi.fn().mockResolvedValue(null) } as never,
    );

    await expect(
      throwingService.requestOrchestrationCycle("project-1", {
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      }),
    ).rejects.toThrow("core unavailable");
    expect(emitDomainEventOrThrow).toHaveBeenCalledWith({
      eventName: "ProjectOrchestrationCycleRequestedEvent",
      payload: expect.objectContaining({
        scopeId: "project-1",
        source: "orchestration_continuation_reconciler",
        reason: "stale_reconciler",
      }),
    });
  });

  afterEach(() => {
    process.env.KANBAN_MCP_SERVER_ID = previousKanbanMcpServerId;
    process.env.KANBAN_MCP_SERVER_IDS = previousKanbanMcpServerIds;
    process.env.KANBAN_MCP_URL = previousKanbanMcpUrl;
    process.env.KANBAN_SERVICE_BEARER_TOKEN = previousServiceToken;
  });

  let service: DispatchService;

  it("emits a stable orchestration cycle dedupe key", async () => {
    await service.requestOrchestrationCycle("project-1", {
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
    });

    expect(coreClient.emitDomainEventOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "ProjectOrchestrationCycleRequestedEvent",
        payload: expect.objectContaining({
          scopeId: "project-1",
          dedupeKey:
            "project-orchestration-cycle:project-1:core_lifecycle_stream:workflow_completed",
        }),
      }),
    );
  });

  it("uses an explicit orchestration cycle dedupe key when provided", async () => {
    await service.requestOrchestrationCycle("project-1", {
      source: "revision_complete",
      reason: "Spec revision workflow completed",
      dedupeKey:
        "project-orchestration-cycle:project-1:revision_complete:spec_revision_completed",
    });

    expect(coreClient.emitDomainEventOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "ProjectOrchestrationCycleRequestedEvent",
        payload: expect.objectContaining({
          dedupeKey:
            "project-orchestration-cycle:project-1:revision_complete:spec_revision_completed",
        }),
      }),
    );
  });

  it("selects dependency-ready todo work and honors per-agent capacity", async () => {
    dependencies.push({
      work_item_id: "ready-high-priority",
      depends_on_work_item_id: "done-dependency",
    });

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      maxConcurrentPerAgent: 1,
      limit: 5,
      requestedBy: "ceo-agent",
    });

    expect(
      result.dispatched
        .filter((item) => !item.idempotent)
        .map((item) => item.workItemId),
    ).toEqual(["ready-high-priority"]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workItemId: "blocked-by-dependency",
          reason: "dependencies_not_ready",
        }),
        expect.objectContaining({
          workItemId: "ready-agent-a",
          reason: "agent_capacity_reached",
        }),
      ]),
    );
    expect(capturedRequests).toHaveLength(1);
    const request = capturedRequests[0];
    expect(request.workflow_id).toBe("implement-work-item");
    expect(request.launch_source).toBe("kanban_dispatch");
    expect(request.input).toMatchObject({
      event: "kanban.work_item.status_changed.v1",
      scopeId: "project-1",
      contextId: "ready-high-priority",
      workItemId: "ready-high-priority",
      status: "in-progress",
      previousStatus: "todo",
      actor: "system",
      resource: expect.objectContaining({
        id: "ready-high-priority",
        status: "in-progress",
        dependsOn: ["done-dependency"],
        blockedBy: ["done-dependency"],
        executionConfig: undefined,
      }),
    });
    expect(request.input).not.toHaveProperty("scope_id");
    expect(request.input).not.toHaveProperty("context_id");
    expect(request.context).toEqual({
      scopeId: null,
      contextId: "project-1",
      contextType: "kanban.project",
      metadata: { work_item_id: "ready-high-priority" },
      scopeNodeId: null,
      scopePath: null,
    });
    expect(request.metadata).toEqual({
      correlation_id: "corr-dispatch",
      causation_id: "cause-dispatch",
      idempotency_key: "kanban:dispatch:project-1:ready-high-priority",
      requested_by: "ceo-agent",
    });
  });

  it("threads the dispatched project's runtime_toolchains onto the launch input", async () => {
    projectRepositoryFindById.mockResolvedValue({
      runtime_toolchains: {
        toolchains: [{ tool: "go", version: "1.23" }],
      },
    });

    await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      maxConcurrentPerAgent: 1,
      limit: 5,
      requestedBy: "ceo-agent",
    });

    expect(projectRepositoryFindById).toHaveBeenCalledWith("project-1");
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].input.runtime_toolchains).toEqual({
      toolchains: [{ tool: "go", version: "1.23" }],
    });
  });

  it("omits runtime_toolchains from the launch input when the project has none", async () => {
    projectRepositoryFindById.mockResolvedValue({ runtime_toolchains: null });

    await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      maxConcurrentPerAgent: 1,
      limit: 5,
      requestedBy: "ceo-agent",
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].input).not.toHaveProperty("runtime_toolchains");
  });

  it("skips ready dispatch when project WIP capacity is full", async () => {
    items = [
      workItem("active-work", "in-progress", {
        linked_run_id: "run-active-work",
      }),
      workItem("ready-work", "todo"),
    ];
    kanbanSettings.getNumber.mockResolvedValueOnce(1);

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
    });

    expect(result.dispatched).toEqual([
      expect.objectContaining({ workItemId: "active-work", idempotent: true }),
    ]);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        workItemId: "ready-work",
        reason: "project_wip_limit_reached",
      }),
    );
    expect(capturedRequests).toHaveLength(0);
  });

  it("resolves project dispatch capacity from settings and current work items", async () => {
    items = [
      workItem("active-status", "in-progress"),
      workItem("stale-status-linked", "todo", {
        linked_run_id: "run-stale-status-linked",
      }),
      workItem("idle-todo", "todo"),
    ];
    kanbanSettings.getNumber.mockResolvedValueOnce(3);

    const capacity = await service.resolveProjectDispatchCapacity("project-1");

    expect(kanbanSettings.getNumber).toHaveBeenCalledWith(
      "work_item_dispatch_max_active_per_project",
    );
    expect(capacity).toEqual({
      maxActive: 3,
      activeCount: 2,
      availableSlots: 1,
      projectAvailableSlots: 1,
      canLaunchNewWork: true,
    });
  });

  it("attaches dynamic kanban MCP mounts to dispatched workflow runs", async () => {
    process.env.KANBAN_MCP_SERVER_ID = "";
    process.env.KANBAN_MCP_SERVER_IDS = "";
    process.env.KANBAN_MCP_URL = "http://kanban.internal/mcp";
    process.env.KANBAN_SERVICE_BEARER_TOKEN = "kanban-token";

    await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      maxConcurrentPerAgent: 1,
      limit: 5,
      requestedBy: "ceo-agent",
    });

    expect(capturedRequests[0].external_mcp_mounts).toEqual([
      expect.objectContaining({
        id: "kanban-mcp",
        url: "http://kanban.internal/mcp",
        headers: {
          authorization: "Bearer kanban-token",
        },
      }),
    ]);
  });

  it("treats duplicate dispatch as idempotent when a run is already linked", async () => {
    items = [
      workItem("already-dispatched", "todo", {
        linked_run_id: "run-already-dispatched",
      }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
    });

    expect(result.dispatched).toEqual([
      {
        workItemId: "already-dispatched",
        runId: "run-already-dispatched",
        linkedRunId: "run-already-dispatched",
        currentExecutionId: null,
        status: "todo",
        idempotent: true,
        mutationConfirmed: true,
      },
    ]);
    expect(capturedRequests).toHaveLength(0);
  });

  it("clears stale terminal run links before selecting ready work", async () => {
    items = [
      workItem("stale-linked", "todo", {
        linked_run_id: "run-stale-linked",
      }),
    ];
    statuses.set("run-stale-linked", {
      run_id: "run-stale-linked",
      workflow_id: "implement-work-item",
      status: "FAILED",
      updated_at: now.toISOString(),
      metadata: { correlation_id: "corr-stale" },
    });

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      reconcileRunStatus: true,
    });

    expect(result.reconciled).toEqual([
      {
        workItemId: "stale-linked",
        runId: "run-stale-linked",
        status: "FAILED",
      },
    ]);
    expect(result.dispatched).toEqual([
      {
        workItemId: "stale-linked",
        runId: "run-stale-linked",
        linkedRunId: "run-stale-linked",
        currentExecutionId: "run-stale-linked",
        status: "in-progress",
        idempotent: false,
        mutationConfirmed: true,
      },
    ]);
    expect(capturedRequests).toHaveLength(1);
  });

  it("does not treat a reconciled terminal run target branch as still active", async () => {
    items = [
      workItem("stale-linked-with-branch", "todo", {
        linked_run_id: "run-stale-linked-with-branch",
        current_execution_id: "run-stale-linked-with-branch",
        execution_config: { targetBranch: "feature/retry-branch" },
      }),
    ];
    statuses.set("run-stale-linked-with-branch", {
      run_id: "run-stale-linked-with-branch",
      workflow_id: "implement-work-item",
      status: "FAILED",
      updated_at: now.toISOString(),
      metadata: { correlation_id: "corr-stale" },
    });

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      reconcileRunStatus: true,
    });

    expect(result.reconciled).toEqual([
      {
        workItemId: "stale-linked-with-branch",
        runId: "run-stale-linked-with-branch",
        status: "FAILED",
      },
    ]);
    expect(result.dispatched).toEqual([
      expect.objectContaining({
        workItemId: "stale-linked-with-branch",
        idempotent: false,
      }),
    ]);
    expect(result.skipped).toEqual([]);
    expect(capturedRequests).toHaveLength(1);
  });

  it("reports core status lookup failures without dispatching duplicate work", async () => {
    items = [
      workItem("unknown-linked", "todo", {
        linked_run_id: "run-core-unavailable",
      }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      reconcileRunStatus: true,
    });

    expect(result.dispatched).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        workItemId: "unknown-linked",
        reason: "core_status_unavailable",
      }),
    ]);
    expect(capturedRequests).toHaveLength(0);
  });

  it("includes dispatch confirmation fields for newly dispatched items", async () => {
    items = [
      workItem("confirm-new", "todo", {
        assigned_agent_id: "agent-b",
        priority: "p0",
      }),
    ];
    repository.save.mockImplementationOnce((input: WorkItemFixture) => {
      const persisted = {
        ...input,
        status: "in-progress",
        current_execution_id: "run-confirm-new",
        updated_at: now,
      };
      items[0] = persisted;
      return Promise.resolve(persisted);
    });

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      maxConcurrentPerAgent: 5,
    });

    const dispatched = result.dispatched[0];
    expect(dispatched.workItemId).toBe("confirm-new");
    expect(dispatched.runId).toBe("run-confirm-new");
    expect(dispatched.linkedRunId).toBe("run-confirm-new");
    expect(dispatched.currentExecutionId).toBe("run-confirm-new");
    expect(dispatched.status).toBe("in-progress");
    expect(dispatched.idempotent).toBe(false);
    expect(dispatched.mutationConfirmed).toBe(true);
    expect(result.skipped).toHaveLength(0);
    expect(result.reconciled).toHaveLength(0);
    expect(capturedRequests).toHaveLength(1);
  });

  it("rejects newly launched dispatches when the persisted work item stays in todo", async () => {
    items = [workItem("todo-with-run-link", "todo")];
    repository.save.mockImplementationOnce((input: WorkItemFixture) => {
      const persisted = {
        ...input,
        status: "todo",
        linked_run_id: "run-todo-with-run-link",
        current_execution_id: "run-todo-with-run-link",
        updated_at: now,
      };
      items[0] = persisted;
      return Promise.resolve(persisted);
    });

    await expect(
      service.dispatchReadyWorkItems({
        project_id: "project-1",
        workflowId: "implement-work-item",
      }),
    ).rejects.toThrow("Dispatch mutation was not confirmed");
  });

  it("includes confirmation fields on idempotent dispatch with persisted values", async () => {
    items = [
      workItem("already-linked", "todo", {
        linked_run_id: "run-already-linked",
        current_execution_id: "exec-already-linked",
      }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
    });

    const dispatched = result.dispatched[0];
    expect(dispatched.workItemId).toBe("already-linked");
    expect(dispatched.runId).toBe("run-already-linked");
    expect(dispatched.linkedRunId).toBe("run-already-linked");
    expect(dispatched.currentExecutionId).toBe("exec-already-linked");
    expect(dispatched.status).toBe("todo");
    expect(dispatched.idempotent).toBe(true);
    expect(dispatched.mutationConfirmed).toBe(true);
    expect(capturedRequests).toHaveLength(0);
  });

  it("reports linked non-todo items as idempotent dispatch confirmations", async () => {
    items = [
      workItem("active-linked", "in-progress", {
        linked_run_id: "run-active-linked",
        current_execution_id: "exec-active-linked",
      }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
    });

    expect(result.dispatched).toEqual([
      {
        workItemId: "active-linked",
        runId: "run-active-linked",
        linkedRunId: "run-active-linked",
        currentExecutionId: "exec-active-linked",
        status: "in-progress",
        idempotent: true,
        mutationConfirmed: true,
      },
    ]);
    expect(result.skipped).toEqual([]);
    expect(capturedRequests).toHaveLength(0);
  });

  it("does not let idempotent confirmations consume the new dispatch limit", async () => {
    items = [
      workItem("already-active", "in-progress", {
        priority: "p0",
        linked_run_id: "run-already-active",
        current_execution_id: "run-already-active",
      }),
      workItem("ready-limited", "todo", { priority: "p1" }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      limit: 1,
    });

    expect(result.dispatched).toEqual([
      expect.objectContaining({
        workItemId: "already-active",
        idempotent: true,
      }),
      expect.objectContaining({
        workItemId: "ready-limited",
        idempotent: false,
      }),
    ]);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].input.contextId).toBe("ready-limited");
  });

  it("continues reporting later idempotent confirmations after the new dispatch limit", async () => {
    items = [
      workItem("ready-first", "todo", { priority: "p0" }),
      workItem("already-active-later", "in-progress", {
        priority: "p1",
        linked_run_id: "run-already-active-later",
        current_execution_id: "run-already-active-later",
      }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      limit: 1,
    });

    expect(result.dispatched).toEqual([
      expect.objectContaining({
        workItemId: "ready-first",
        idempotent: false,
      }),
      expect.objectContaining({
        workItemId: "already-active-later",
        idempotent: true,
      }),
    ]);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].input.contextId).toBe("ready-first");
  });

  it("rejects when persisted dispatch linkage does not confirm the accepted run", async () => {
    items = [workItem("mismatched-link", "todo")];
    repository.save.mockImplementationOnce((input: WorkItemFixture) => {
      const persisted = {
        ...input,
        linked_run_id: "run-from-another-request",
        current_execution_id: "run-mismatched-link",
        updated_at: now,
      };
      items[0] = persisted;
      return Promise.resolve(persisted);
    });

    await expect(
      service.dispatchReadyWorkItems({
        project_id: "project-1",
        workflowId: "implement-work-item",
      }),
    ).rejects.toThrow("Dispatch mutation was not confirmed");
  });

  it("reports non-todo candidates as skipped instead of silently ignoring", async () => {
    items = [
      workItem("blocked-item", "blocked"),
      workItem("todo-item", "todo", { priority: "p0" }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
    });

    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workItemId: "blocked-item",
          reason: "not_dispatchable_status",
          status: "blocked",
        }),
      ]),
    );
    expect(result.dispatched.map((d) => d.workItemId)).toContain("todo-item");
  });

  it("no longer sorts dispatch candidates by priority order", async () => {
    items = [
      workItem("low-first", "todo", { priority: "p3" }),
      workItem("high-second", "todo", { priority: "p0" }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      limit: 2,
    });

    expect(result.dispatched.map((d) => d.workItemId)).toEqual([
      "low-first",
      "high-second",
    ]);
    expect(capturedRequests[0].input.contextId).toBe("low-first");
    expect(capturedRequests[1].input.contextId).toBe("high-second");
  });

  it("skips ready dispatch when another lifecycle-active item owns the target branch", async () => {
    const branchOwner = workItem("review-owner", "in-review", {
      linked_run_id: null,
      current_execution_id: null,
      execution_config: { targetBranch: "feature/automation-improvements" },
    });
    const candidate = workItem("todo-candidate", "todo", {
      linked_run_id: null,
      current_execution_id: null,
      execution_config: { targetBranch: "feature/automation-improvements" },
    });

    items = [branchOwner, candidate];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      requestedBy: "test",
    });

    expect(result.dispatched).toEqual([]);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        workItemId: "todo-candidate",
        reason: "target_branch_already_dispatched",
        detail: expect.stringContaining("feature/automation-improvements"),
      }),
    );
  });

  it("does not block ready dispatch for a done item on the same target branch", async () => {
    const completedOwner = workItem("done-owner", "done", {
      linked_run_id: null,
      current_execution_id: null,
      execution_config: { targetBranch: "feature/automation-improvements" },
    });
    const candidate = workItem("todo-candidate", "todo", {
      linked_run_id: null,
      current_execution_id: null,
      execution_config: { targetBranch: "feature/automation-improvements" },
    });

    items = [completedOwner, candidate];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      requestedBy: "test",
    });

    expect(result.dispatched).toContainEqual(
      expect.objectContaining({ workItemId: "todo-candidate" }),
    );
  });

  it("skips later ready todo items that share a claimed target branch", async () => {
    items = [
      workItem("first-branch-work", "todo", {
        execution_config: { targetBranch: "feature/shared-branch" },
      }),
      workItem("second-branch-work", "todo", {
        execution_config: { targetBranch: "feature/shared-branch" },
      }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
      limit: 5,
    });

    expect(result.dispatched).toEqual([
      expect.objectContaining({
        workItemId: "first-branch-work",
        idempotent: false,
      }),
    ]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        workItemId: "second-branch-work",
        reason: "target_branch_already_dispatched",
      }),
    ]);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].input.contextId).toBe("first-branch-work");
    expect(
      items.find((item) => item.id === "second-branch-work"),
    ).toMatchObject({
      status: "todo",
      linked_run_id: null,
      current_execution_id: null,
    });
  });

  it("resets failed provision linked runs to todo and clears run links", async () => {
    const failedRunId = "run-failed-provision";
    items = [
      workItem("failed-provision-work", "in-progress", {
        linked_run_id: failedRunId,
        current_execution_id: failedRunId,
      }),
    ];
    statuses.set(failedRunId, {
      run_id: failedRunId,
      workflow_id: "implement-work-item",
      status: "FAILED",
      current_step_id: "provision_worktree",
      updated_at: now.toISOString(),
      metadata: { correlation_id: "corr-failed-provision" },
    });

    const result = await service.reconcileProjectLinkedRuns("project-1");

    expect(result.reconciled).toEqual([
      {
        workItemId: "failed-provision-work",
        runId: failedRunId,
        status: "FAILED",
      },
    ]);
    expect(items[0]).toMatchObject({
      status: "todo",
      linked_run_id: null,
      current_execution_id: null,
    });
    expect(updateWorkItemStatus).toHaveBeenCalledWith(
      "project-1",
      "failed-provision-work",
      "todo",
    );
  });

  it("resets to todo when non-provision failed run links are cleared (orphan recovery)", async () => {
    const failedRunId = "run-failed-implementation";
    items = [
      workItem("failed-implementation-work", "in-progress", {
        linked_run_id: failedRunId,
        current_execution_id: failedRunId,
      }),
    ];
    statuses.set(failedRunId, {
      run_id: failedRunId,
      workflow_id: "implement-work-item",
      status: "FAILED",
      current_step_id: "implement_work_item",
      updated_at: now.toISOString(),
      metadata: { correlation_id: "corr-failed-implementation" },
    });

    const result = await service.reconcileProjectLinkedRuns("project-1");

    expect(result.reconciled).toEqual([
      {
        workItemId: "failed-implementation-work",
        runId: failedRunId,
        status: "FAILED",
      },
    ]);
    expect(result.orphanReconciled).toEqual([
      {
        workItemId: "failed-implementation-work",
        previousStatus: "in-progress",
      },
    ]);
    expect(items[0]).toMatchObject({
      status: "todo",
      linked_run_id: null,
      current_execution_id: null,
    });
    expect(updateWorkItemStatus).toHaveBeenCalledWith(
      "project-1",
      "failed-implementation-work",
      "todo",
    );
  });

  it("does not clear a newly linked run when stale reconciliation races with relinking", async () => {
    const staleRunId = "run-stale-link";
    items = [
      workItem("race-relinked-work", "in-progress", {
        linked_run_id: staleRunId,
        current_execution_id: staleRunId,
      }),
    ];
    statuses.set(staleRunId, {
      run_id: staleRunId,
      workflow_id: "implement-work-item",
      status: "FAILED",
      current_step_id: "implement_work_item",
      updated_at: now.toISOString(),
      metadata: { correlation_id: "corr-stale-link" },
    });
    repository.clearRunLinksIfMatches.mockImplementationOnce(
      (project_id: string, workItemId: string, _runId: string) => {
        const index = items.findIndex(
          (item) => item.project_id === project_id && item.id === workItemId,
        );
        items[index] = {
          ...items[index],
          linked_run_id: "run-new-link",
          current_execution_id: "run-new-link",
        };
        return Promise.resolve(false);
      },
    );

    const result = await service.reconcileProjectLinkedRuns("project-1");

    expect(repository.clearRunLinksIfMatches).toHaveBeenCalledWith(
      "project-1",
      "race-relinked-work",
      staleRunId,
      "FAILED",
    );
    expect(result.reconciled).toEqual([]);
    expect(items[0]).toMatchObject({
      linked_run_id: "run-new-link",
      current_execution_id: "run-new-link",
    });
    expect(updateWorkItemStatus).not.toHaveBeenCalled();
  });

  it("passes the terminal run status as the 4th arg to clearRunLinksIfMatches", async () => {
    const failedRunId = "run-terminal-status";
    items = [
      workItem("terminal-status-work", "in-progress", {
        linked_run_id: failedRunId,
        current_execution_id: failedRunId,
      }),
    ];
    statuses.set(failedRunId, {
      run_id: failedRunId,
      workflow_id: "implement-work-item",
      status: "FAILED",
      updated_at: now.toISOString(),
      metadata: { correlation_id: "corr-terminal-status" },
    });

    await service.reconcileProjectLinkedRuns("project-1");

    expect(repository.clearRunLinksIfMatches).toHaveBeenCalledWith(
      "project-1",
      "terminal-status-work",
      failedRunId,
      "FAILED",
    );
  });

  describe("dispatchSelectedWorkItems", () => {
    it("launches only explicitly selected work items", async () => {
      dependencies.push({
        work_item_id: "ready-high-priority",
        depends_on_work_item_id: "done-dependency",
      });

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["ready-high-priority"],
        workflowId: "implement-work-item",
      });

      expect(result.dispatched).toHaveLength(1);
      expect(result.dispatched[0].workItemId).toBe("ready-high-priority");
      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0].input).toMatchObject({
        scopeId: "project-1",
        contextId: "ready-high-priority",
        workItemId: "ready-high-priority",
        status: "in-progress",
        previousStatus: "todo",
        resource: expect.objectContaining({
          id: "ready-high-priority",
          status: "in-progress",
          dependsOn: ["done-dependency"],
          blockedBy: ["done-dependency"],
        }),
      });
      expect(capturedRequests[0].input).not.toHaveProperty("context_id");
      expect(result.skipped).toHaveLength(0);
    });

    it("attaches dynamic kanban MCP mounts to selected workflow runs", async () => {
      process.env.KANBAN_MCP_SERVER_ID = "";
      process.env.KANBAN_MCP_SERVER_IDS = "";
      process.env.KANBAN_MCP_URL = "http://kanban.internal/mcp";
      process.env.KANBAN_SERVICE_BEARER_TOKEN = "kanban-token";

      await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["ready-high-priority"],
        workflowId: "implement-work-item",
      });

      expect(capturedRequests[0].external_mcp_mounts).toEqual([
        expect.objectContaining({
          id: "kanban-mcp",
          url: "http://kanban.internal/mcp",
          headers: {
            authorization: "Bearer kanban-token",
          },
        }),
      ]);
    });

    it("rejects work items that do not belong to the project", async () => {
      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["nonexistent-item"],
        workflowId: "implement-work-item",
      });

      expect(result.dispatched).toHaveLength(0);
      expect(result.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workItemId: "nonexistent-item",
            reason: "work_item_not_found",
          }),
        ]),
      );
      expect(capturedRequests).toHaveLength(0);
    });

    it("rejects work items from a different project", async () => {
      items.push({
        ...workItem("cross-project-item", "todo"),
        project_id: "project-2",
      });

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["cross-project-item"],
        workflowId: "implement-work-item",
      });

      expect(result.dispatched).toHaveLength(0);
      expect(result.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workItemId: "cross-project-item",
            reason: "work_item_cross_project",
          }),
        ]),
      );
      expect(capturedRequests).toHaveLength(0);
    });

    it("reports already-dispatched items as idempotent with reason", async () => {
      items = [
        workItem("active-linked", "in-progress", {
          linked_run_id: "run-active-linked",
          current_execution_id: "exec-active-linked",
        }),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["active-linked"],
        workflowId: "implement-work-item",
      });

      expect(result.skipped).toEqual([]);
      expect(result.dispatched).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workItemId: "active-linked",
            runId: "run-active-linked",
            linkedRunId: "run-active-linked",
            currentExecutionId: "exec-active-linked",
            status: "in-progress",
            idempotent: true,
            mutationConfirmed: true,
          }),
        ]),
      );
      expect(capturedRequests).toHaveLength(0);
    });

    it("clears terminal linked runs before selected dispatch", async () => {
      items = [
        workItem("stale-linked", "todo", {
          linked_run_id: "run-stale-linked",
        }),
      ];
      statuses.set("run-stale-linked", {
        run_id: "run-stale-linked",
        workflow_id: "implement-work-item",
        status: "FAILED",
        updated_at: now.toISOString(),
        metadata: { correlation_id: "corr-stale" },
      });

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["stale-linked"],
        workflowId: "implement-work-item",
      });

      expect(result.reconciled).toEqual([
        {
          workItemId: "stale-linked",
          runId: "run-stale-linked",
          status: "FAILED",
        },
      ]);
      expect(result.dispatched).toEqual([
        expect.objectContaining({
          workItemId: "stale-linked",
          idempotent: false,
          mutationConfirmed: true,
        }),
      ]);
      expect(result.skipped).toEqual([]);
      expect(capturedRequests).toHaveLength(1);
    });

    it("reports concurrency_exceeded for selected items over per-agent capacity", async () => {
      items = [
        workItem("active-agent-a", "in-progress", {
          assigned_agent_id: "agent-a",
          linked_run_id: "run-active-agent-a",
        }),
        workItem("ready-agent-a", "todo", {
          assigned_agent_id: "agent-a",
        }),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["ready-agent-a"],
        workflowId: "implement-work-item",
        maxConcurrentPerAgent: 1,
      });

      expect(result.dispatched).toHaveLength(0);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          workItemId: "ready-agent-a",
          reason: "concurrency_exceeded",
        }),
      ]);
      expect(capturedRequests).toHaveLength(0);
    });

    it("does not count terminal linked runs on same-agent items against selected dispatch capacity", async () => {
      items = [
        workItem("stale-same-agent", "in-progress", {
          assigned_agent_id: "agent-a",
          linked_run_id: "run-stale-same-agent",
        }),
        workItem("ready-agent-a", "todo", {
          assigned_agent_id: "agent-a",
        }),
      ];
      statuses.set("run-stale-same-agent", {
        run_id: "run-stale-same-agent",
        workflow_id: "implement-work-item",
        status: "FAILED",
        updated_at: now.toISOString(),
        metadata: { correlation_id: "corr-stale" },
      });

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["ready-agent-a"],
        workflowId: "implement-work-item",
        maxConcurrentPerAgent: 1,
      });

      expect(result.reconciled).toEqual([
        {
          workItemId: "stale-same-agent",
          runId: "run-stale-same-agent",
          status: "FAILED",
        },
      ]);
      expect(result.dispatched).toEqual([
        expect.objectContaining({
          workItemId: "ready-agent-a",
          idempotent: false,
          mutationConfirmed: true,
        }),
      ]);
      expect(result.skipped).toEqual([]);
      expect(capturedRequests).toHaveLength(1);
    });

    it("reports not_dispatchable_status for selected non-todo items", async () => {
      items = [workItem("blocked-item", "blocked")];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["blocked-item"],
        workflowId: "implement-work-item",
      });

      expect(result.dispatched).toHaveLength(0);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          workItemId: "blocked-item",
          reason: "not_dispatchable_status",
          status: "blocked",
        }),
      ]);
      expect(capturedRequests).toHaveLength(0);
    });

    it("reports every requested id when all selected ids are missing", async () => {
      items = [];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["missing-1", "missing-2"],
        workflowId: "implement-work-item",
      });

      expect(result.dispatched).toHaveLength(0);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          workItemId: "missing-1",
          reason: "work_item_not_found",
        }),
        expect.objectContaining({
          workItemId: "missing-2",
          reason: "work_item_not_found",
        }),
      ]);
      expect(capturedRequests).toHaveLength(0);
    });

    it("returns per-item results with dispatched and skipped", async () => {
      items = [
        workItem("ready-item-1", "todo", { priority: "p0" }),
        workItem("ready-item-2", "todo", { priority: "p1" }),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["ready-item-1", "nonexistent-item", "ready-item-2"],
        workflowId: "implement-work-item",
      });

      expect(
        result.dispatched.map((d: { workItemId: string }) => d.workItemId),
      ).toEqual(["ready-item-1", "ready-item-2"]);
      expect(result.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workItemId: "nonexistent-item",
            reason: "work_item_not_found",
          }),
        ]),
      );
      expect(capturedRequests).toHaveLength(2);
    });

    it("does not sort candidates by priority order", async () => {
      items = [
        workItem("low-priority-first", "todo", { priority: "p3" }),
        workItem("high-priority-second", "todo", { priority: "p0" }),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["high-priority-second", "low-priority-first"],
        workflowId: "implement-work-item",
      });

      expect(
        result.dispatched.map((d: { workItemId: string }) => d.workItemId),
      ).toEqual(["high-priority-second", "low-priority-first"]);
      expect(capturedRequests[0].input.contextId).toBe("high-priority-second");
      expect(capturedRequests[1].input.contextId).toBe("low-priority-first");
    });
  });

  it("skips a todo item whose target_files overlap an in-flight item", async () => {
    items = [
      workItem("active", "in-progress", {
        linked_run_id: "run-active",
        execution_config: planFixture("apps/api/src/foo.service.ts"),
      }),
      workItem("candidate", "todo", {
        linked_run_id: null,
        execution_config: planFixture("apps/api/src/foo.service.ts"),
      }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
    });

    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        workItemId: "candidate",
        reason: "target_files_contention_detected",
      }),
    );
  });

  it("dispatches a todo item when target_files do not overlap", async () => {
    items = [
      workItem("active", "in-progress", {
        linked_run_id: "run-active",
        execution_config: planFixture("apps/api/src/foo.service.ts"),
      }),
      workItem("candidate", "todo", {
        linked_run_id: null,
        execution_config: planFixture("apps/web/src/bar.component.tsx"),
      }),
    ];

    const result = await service.dispatchReadyWorkItems({
      project_id: "project-1",
      workflowId: "implement-work-item",
    });

    expect(result.dispatched).toContainEqual(
      expect.objectContaining({ workItemId: "candidate" }),
    );
  });

  describe("dispatchSelectedWorkItems (selected-path resilience)", () => {
    it("skips later selected todo items that share a claimed target branch", async () => {
      items = [
        workItem("first-branch-work", "todo", {
          execution_config: { targetBranch: "feature/shared-branch" },
        }),
        workItem("second-branch-work", "todo", {
          execution_config: { targetBranch: "feature/shared-branch" },
        }),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["first-branch-work", "second-branch-work"],
        workflowId: "implement-work-item",
      });

      expect(result.dispatched).toEqual([
        expect.objectContaining({
          workItemId: "first-branch-work",
          idempotent: false,
        }),
      ]);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          workItemId: "second-branch-work",
          reason: "target_branch_already_dispatched",
        }),
      ]);
      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0].input.contextId).toBe("first-branch-work");
      expect(capturedRequests[0].metadata.idempotency_key).toBe(
        "kanban:dispatch:project-1:first-branch-work",
      );
      expect(
        items.find((item) => item.id === "second-branch-work"),
      ).toMatchObject({
        status: "todo",
        linked_run_id: null,
        current_execution_id: null,
      });
    });

    it("does not clear a newly linked run when selected-dispatch reconciliation races with relinking", async () => {
      const staleRunId = "run-stale-selected-link";
      items = [
        workItem("selected-relinked-work", "in-progress", {
          linked_run_id: staleRunId,
          current_execution_id: staleRunId,
        }),
      ];
      statuses.set(staleRunId, {
        run_id: staleRunId,
        workflow_id: "implement-work-item",
        status: "FAILED",
        updated_at: now.toISOString(),
        metadata: { correlation_id: "corr-stale-selected-link" },
      });
      repository.clearRunLinksIfMatches.mockImplementationOnce(
        (project_id: string, workItemId: string, runId: string) => {
          const index = items.findIndex(
            (item) => item.project_id === project_id && item.id === workItemId,
          );
          expect(runId).toBe(staleRunId);
          items[index] = {
            ...items[index],
            linked_run_id: "run-new-selected-link",
            current_execution_id: "run-new-selected-link",
          };
          return Promise.resolve(false);
        },
      );

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["selected-relinked-work"],
        workflowId: "implement-work-item",
      });

      expect(repository.clearRunLinksIfMatches).toHaveBeenCalledWith(
        "project-1",
        "selected-relinked-work",
        staleRunId,
        "FAILED",
      );
      expect(repository.save).not.toHaveBeenCalled();
      expect(result.reconciled).toEqual([]);
      expect(result.dispatched).toEqual([
        expect.objectContaining({
          workItemId: "selected-relinked-work",
          runId: "run-new-selected-link",
          linkedRunId: "run-new-selected-link",
          currentExecutionId: "run-new-selected-link",
          status: "in-progress",
          idempotent: true,
          mutationConfirmed: true,
        }),
      ]);
      expect(result.skipped).toEqual([]);
      expect(items[0]).toMatchObject({
        linked_run_id: "run-new-selected-link",
        current_execution_id: "run-new-selected-link",
      });
    });

    it("skips new selected todo items when project WIP capacity is full", async () => {
      items = [
        workItem("active-work", "in-progress", {
          linked_run_id: "run-active-work",
        }),
        workItem("selected-todo", "todo"),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["selected-todo"],
        workflowId: "implement-work-item",
        maxActivePerProject: 1,
      });

      expect(result.dispatched).toEqual([]);
      expect(result.skipped).toContainEqual(
        expect.objectContaining({
          workItemId: "selected-todo",
          reason: "project_wip_limit_reached",
        }),
      );
      expect(capturedRequests).toHaveLength(0);
    });

    it("returns idempotent selected linked items even when project WIP capacity is full", async () => {
      items = [
        workItem("already-linked-work", "in-progress", {
          linked_run_id: "run-already-linked-work",
          current_execution_id: "run-already-linked-work",
        }),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["already-linked-work"],
        workflowId: "implement-work-item",
        maxActivePerProject: 1,
      });

      expect(result.dispatched).toContainEqual(
        expect.objectContaining({
          workItemId: "already-linked-work",
          idempotent: true,
        }),
      );
      expect(result.skipped).toEqual([]);
      expect(capturedRequests).toHaveLength(0);
    });

    it("returns active linked selected items as idempotent dispatch results", async () => {
      items = [
        workItem("already-linked-work", "in-progress", {
          linked_run_id: "run-already-linked-work",
          current_execution_id: "execution-already-linked-work",
        }),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["already-linked-work"],
        workflowId: "implement-work-item",
      });

      expect(capturedRequests).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.dispatched).toEqual([
        {
          workItemId: "already-linked-work",
          runId: "run-already-linked-work",
          linkedRunId: "run-already-linked-work",
          currentExecutionId: "execution-already-linked-work",
          status: "in-progress",
          idempotent: true,
          mutationConfirmed: true,
        },
      ]);
    });

    it("skips selected dispatch when an in-review item owns the selected target branch", async () => {
      items = [
        workItem("review-owner", "in-review", {
          linked_run_id: null,
          current_execution_id: null,
          execution_config: { targetBranch: "feature/automation-improvements" },
        }),
        workItem("selected-todo", "todo", {
          execution_config: { targetBranch: "feature/automation-improvements" },
        }),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["selected-todo"],
        workflowId: "implement-work-item",
        requestedBy: "test",
      });

      expect(result.dispatched).toEqual([]);
      expect(result.skipped).toContainEqual(
        expect.objectContaining({
          workItemId: "selected-todo",
          reason: "target_branch_already_dispatched",
          detail: expect.stringContaining("feature/automation-improvements"),
        }),
      );
    });

    it("reconciles stale terminal runs before evaluating branch ownership", async () => {
      items = [
        workItem("stale-owner", "done", {
          linked_run_id: "stale-run",
          current_execution_id: null,
          execution_config: { targetBranch: "feature/automation-improvements" },
        }),
        workItem("selected-todo", "todo", {
          execution_config: { targetBranch: "feature/automation-improvements" },
        }),
      ];

      statuses.set("stale-run", {
        run_id: "stale-run",
        workflow_id: "implement-work-item",
        status: "FAILED",
        updated_at: now.toISOString(),
        metadata: { correlation_id: "corr-stale" },
      });

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["selected-todo"],
        workflowId: "implement-work-item",
        requestedBy: "test",
      });

      expect(result.reconciled).toEqual([
        { workItemId: "stale-owner", runId: "stale-run", status: "FAILED" },
      ]);
      expect(result.dispatched).toContainEqual(
        expect.objectContaining({ workItemId: "selected-todo" }),
      );
    });

    it("does not block selected dispatch for a done item on the same target branch", async () => {
      items = [
        workItem("done-owner", "done", {
          linked_run_id: null,
          current_execution_id: null,
          execution_config: { targetBranch: "feature/automation-improvements" },
        }),
        workItem("selected-todo", "todo", {
          execution_config: { targetBranch: "feature/automation-improvements" },
        }),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["selected-todo"],
        workflowId: "implement-work-item",
        requestedBy: "test",
      });

      expect(result.dispatched).toContainEqual(
        expect.objectContaining({ workItemId: "selected-todo" }),
      );
    });

    it("reconciles stale conflicting branch claims before selected dispatch", async () => {
      const staleRunId = "run-stale-branch-claim";
      items = [
        workItem("stale-branch-claim", "in-progress", {
          assigned_agent_id: "other-agent",
          linked_run_id: staleRunId,
          current_execution_id: staleRunId,
          execution_config: { targetBranch: "feature/shared-branch" },
        }),
        workItem("selected-branch-work", "todo", {
          assigned_agent_id: "selected-agent",
          execution_config: { targetBranch: "feature/shared-branch" },
        }),
      ];
      statuses.set(staleRunId, {
        run_id: staleRunId,
        workflow_id: "implement-work-item",
        status: "FAILED",
        updated_at: now.toISOString(),
        metadata: { correlation_id: "corr-stale-branch-claim" },
      });

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["selected-branch-work"],
        workflowId: "implement-work-item",
      });

      expect(repository.clearRunLinksIfMatches).toHaveBeenCalledWith(
        "project-1",
        "stale-branch-claim",
        staleRunId,
        "FAILED",
      );
      expect(result.reconciled).toEqual([
        {
          workItemId: "stale-branch-claim",
          runId: staleRunId,
          status: "FAILED",
        },
      ]);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          workItemId: "selected-branch-work",
          reason: "target_branch_already_dispatched",
        }),
      ]);
      expect(result.dispatched).toEqual([]);
      expect(capturedRequests).toHaveLength(0);
      expect(items[0]).toMatchObject({
        linked_run_id: null,
        current_execution_id: null,
      });
    });

    it("skips selected items whose dependencies are not done", async () => {
      items = [
        workItem("blocked-selected-work", "todo"),
        workItem("unfinished-dependency", "in-progress"),
      ];
      dependencies = [
        {
          work_item_id: "blocked-selected-work",
          depends_on_work_item_id: "unfinished-dependency",
        },
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["blocked-selected-work"],
        workflowId: "implement-work-item",
      });

      expect(result.dispatched).toEqual([]);
      expect(result.skipped).toContainEqual(
        expect.objectContaining({
          workItemId: "blocked-selected-work",
          reason: "dependencies_not_ready",
        }),
      );
      expect(capturedRequests).toHaveLength(0);
    });

    it("continues dispatching later selected items when one launch fails", async () => {
      items = [
        workItem("launch-fails", "todo"),
        workItem("launch-succeeds", "todo"),
      ];
      coreClient.requestWorkflowRun = vi
        .fn()
        .mockRejectedValueOnce(new Error("core unavailable"))
        .mockImplementationOnce((request: WorkflowRunRequestV1) => {
          capturedRequests.push(request);
          return Promise.resolve(accepted("launch-succeeds"));
        });

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["launch-fails", "launch-succeeds"],
        workflowId: "implement-work-item",
      });

      expect(result.dispatched).toContainEqual(
        expect.objectContaining({ workItemId: "launch-succeeds" }),
      );
      expect(result.skipped).toContainEqual(
        expect.objectContaining({
          workItemId: "launch-fails",
          reason: "dispatch_failed",
          detail: "core unavailable",
        }),
      );
    });

    it("keeps accepted runs claimed when local confirmation fails", async () => {
      items = [
        workItem("accepted-link-fails", "todo", {
          execution_config: { targetBranch: "feature/shared-branch" },
        }),
        workItem("same-branch-replacement", "todo", {
          execution_config: { targetBranch: "feature/shared-branch" },
        }),
        workItem("different-branch-replacement", "todo", {
          execution_config: { targetBranch: "feature/different-branch" },
        }),
      ];
      // The race-safe conditional link persists first; the subsequent
      // status-projection save is what fails. The link is the "claim" that
      // must survive so the dispatched run is not re-launched on the next
      // cycle — the work item's status projection stays at "todo" because
      // the status save never landed.
      repository.save.mockRejectedValueOnce(new Error("database write failed"));

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: [
          "accepted-link-fails",
          "same-branch-replacement",
          "different-branch-replacement",
        ],
        workflowId: "implement-work-item",
        slots: 1,
      });

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0].input.contextId).toBe("accepted-link-fails");
      expect(result.dispatched).toEqual([]);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          workItemId: "accepted-link-fails",
          reason: "dispatch_failed",
          detail: "database write failed",
        }),
        expect.objectContaining({
          workItemId: "same-branch-replacement",
          reason: "dispatch_slot_limit_reached",
        }),
        expect.objectContaining({
          workItemId: "different-branch-replacement",
          reason: "dispatch_slot_limit_reached",
        }),
      ]);
      expect(repository.linkRunIfUnlinked).toHaveBeenCalledWith({
        project_id: "project-1",
        workItemId: "accepted-link-fails",
        runId: "run-accepted-link-fails",
      });
      expect(items[0]).toMatchObject({
        status: "todo",
        linked_run_id: "run-accepted-link-fails",
        current_execution_id: "run-accepted-link-fails",
      });
    });

    it("resets selected in-progress items when provision worktree runs fail", async () => {
      items = [
        workItem("provision-failed-work", "in-progress", {
          linked_run_id: "run-provision-failed-work",
          current_execution_id: "run-provision-failed-work",
        }),
      ];
      statuses.set("run-provision-failed-work", {
        run_id: "run-provision-failed-work",
        workflow_id: "implement-work-item",
        status: "FAILED",
        current_step_id: "provision_worktree",
        updated_at: now.toISOString(),
        metadata: { correlation_id: "corr-provision-failed-work" },
      });

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["provision-failed-work"],
        workflowId: "implement-work-item",
      });

      expect(updateWorkItemStatus).toHaveBeenCalledWith(
        "project-1",
        "provision-failed-work",
        "todo",
      );
      expect(result.reconciled).toEqual([
        {
          workItemId: "provision-failed-work",
          runId: "run-provision-failed-work",
          status: "FAILED",
        },
      ]);
      expect(result.dispatched).toContainEqual(
        expect.objectContaining({
          workItemId: "provision-failed-work",
          runId: "run-provision-failed-work",
        }),
      );
    });

    it("dispatches no more selected items than the slot limit", async () => {
      items = [
        workItem("slot-one", "todo"),
        workItem("slot-two", "todo"),
        workItem("slot-three", "todo"),
      ];

      const result = await service.dispatchSelectedWorkItems({
        projectId: "project-1",
        workItemIds: ["slot-one", "slot-two", "slot-three"],
        workflowId: "implement-work-item",
        slots: 2,
      });

      expect(result.dispatched.map((item) => item.workItemId)).toEqual([
        "slot-one",
        "slot-two",
      ]);
      expect(result.skipped).toContainEqual(
        expect.objectContaining({
          workItemId: "slot-three",
          reason: "dispatch_slot_limit_reached",
        }),
      );
      expect(capturedRequests).toHaveLength(2);
    });

    it("unit-level: exercises dispatchWorkItems directly with selected-mode options", async () => {
      // Verifies the unified core can be invoked directly (bypassing the
      // DispatchService facade) with the option bundle that the
      // dispatch-selected-work-items free function uses. Keeps unit-level
      // coverage of the core's selected-path behaviour independent of
      // the NestJS-injected service.
      items = [
        workItem("unit-direct-selected", "todo"),
        workItem("unit-direct-other", "todo"),
      ];

      const unitDeps = {
        coreClient,
        requestContext: {
          getRequestId: () => "corr-unit-selected",
          getCausationId: () => "cause-unit-selected",
        } as unknown as BaseRequestContextService,
        workItems: repository,
      };

      const result = await dispatchWorkItems(unitDeps, {
        projectId: "project-1",
        workflowId: "implement-work-item",
        requestedBy: "unit-test",
        selectedWorkItemIds: ["unit-direct-selected", "unit-direct-other"],
        reconcileRunStatus: true,
        reconcileOrphans: false,
        checkTargetFileContention: false,
        partialFailure: true,
        slots: 1,
        maxActivePerProject: 3,
        capacitySkipReason: "concurrency_exceeded",
        causationIdPrefix: "kanban:dispatch:selected",
        releaseBranchOnFailure: true,
      });

      expect(result.dispatched.map((entry) => entry.workItemId)).toEqual([
        "unit-direct-selected",
      ]);
      expect(result.skipped).toContainEqual(
        expect.objectContaining({
          workItemId: "unit-direct-other",
          reason: "dispatch_slot_limit_reached",
        }),
      );
      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0].input.contextId).toBe("unit-direct-selected");
      expect(capturedRequests[0].metadata.idempotency_key).toBe(
        "kanban:dispatch:project-1:unit-direct-selected",
      );
    });
  });

  function workItem(
    id: string,
    status: string,
    overrides: Partial<WorkItemFixture> = {},
  ): WorkItemFixture {
    return {
      id,
      project_id: "project-1",
      title: id,
      status,
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      token_spend: 0,
      current_execution_id: null,
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      linked_run_id: null,
      description: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    };
  }
});
