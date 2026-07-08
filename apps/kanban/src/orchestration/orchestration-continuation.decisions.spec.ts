import { NotFoundException } from "@nestjs/common";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { ProjectOrchestrationWakeupService } from "./project-orchestration-wakeup.service";
import { OrchestrationContinuationService } from "./orchestration-continuation.service";

interface MockOrchestrationService {
  recordCycleDecision: Mock;
  findOrchestratingStates: Mock;
  reconcileLinkedWorkflowRun: Mock;
  get: Mock;
}

interface MockDispatchService {
  requestOrchestrationCycle: Mock;
}

interface MockWorkItem {
  id: string;
  status: string;
  type?: string;
  parent_work_item_id?: string | null;
  linked_run_id?: string | null;
  current_execution_id?: string | null;
  execution_config?: Record<string, unknown> | null;
  executionConfig?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

interface MockWorkItemRepository {
  findByproject_id: Mock;
  findDependenciesByWorkItemIds: Mock;
}

interface MockWorkItemDependency {
  work_item_id: string;
  depends_on_work_item_id: string;
}

interface MockWorkItemService {
  updateStatus: Mock;
  updateWorkItem: Mock;
}

function createMockOrchestrationService(): MockOrchestrationService {
  return {
    recordCycleDecision: vi.fn().mockResolvedValue({
      decision: "blocked",
      persisted: true,
      duplicate: false,
      reason: "Blocked due to human-decision work items",
    }),
    findOrchestratingStates: vi.fn().mockResolvedValue([]),
    reconcileLinkedWorkflowRun: vi.fn().mockResolvedValue({ cleared: false }),
    get: vi
      .fn()
      .mockRejectedValue(
        new NotFoundException(
          "Orchestration state not found for project project-1",
        ),
      ),
  };
}

function createMockDispatchService(): MockDispatchService {
  return {
    requestOrchestrationCycle: vi.fn(),
  };
}

function createMockWorkItemRepository(
  items: MockWorkItem[],
  dependencies: MockWorkItemDependency[] = [],
): MockWorkItemRepository {
  return {
    findByproject_id: vi.fn().mockResolvedValue(items),
    findDependenciesByWorkItemIds: vi.fn((workItemIds: string[]) =>
      Promise.resolve(
        dependencies.filter((dependency) =>
          workItemIds.includes(dependency.work_item_id),
        ),
      ),
    ),
  };
}

function createMockWorkItemService(): MockWorkItemService {
  return {
    updateStatus: vi.fn().mockResolvedValue({}),
    updateWorkItem: vi.fn().mockResolvedValue({
      metadata: {
        sourceId: "imported-repo-bootstrap",
      },
    }),
  };
}

function createService({
  orchestration,
  dispatch,
  workItems,
  workItemService,
}: {
  orchestration: MockOrchestrationService;
  dispatch: MockDispatchService;
  workItems: MockWorkItemRepository;
  workItemService: MockWorkItemService;
}) {
  const service = new OrchestrationContinuationService(
    orchestration as never,
    dispatch as never,
    workItems as never,
    workItemService as never,
    { requestWakeup: vi.fn().mockResolvedValue({ emitted: true }) } as never,
    { getWorkflowRunStatus: vi.fn() },
  );

  return service;
}

describe("OrchestrationContinuationService - continuation decisions", () => {
  it("declares concrete wakeup service metadata for Nest dependency injection", () => {
    const dependencies = Reflect.getMetadata(
      "design:paramtypes",
      OrchestrationContinuationService,
    ) as unknown[];

    expect(dependencies[4]).toBe(ProjectOrchestrationWakeupService);
  });

  it("persists blocked when autonomous imported reconciliation leaves only human-decision blocked work", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "work-item-1",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:scope",
        },
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "import_hydration_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
      reason: expect.stringContaining("hard-blocked"),
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "blocked",
        reason: expect.stringContaining("hard-blocked"),
        idempotencyKey:
          "continuation:project-1:import_hydration_completed:run-1",
      }),
    );
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("records repeat and emits a cycle request when todo work remains", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "todo-1",
        status: "todo",
        metadata: {},
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: true,
      persisted: true,
      reason: expect.stringContaining("dispatchable work"),
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "repeat",
        reason: expect.stringContaining("dispatchable work"),
        idempotencyKey: "continuation:project-1:workflow_completed:run-1",
      }),
    );
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("records repeat when the only todo is blocked by an active target branch owner and backlog exists", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "standing-order",
        status: "in-review",
        linked_run_id: null,
        current_execution_id: null,
        execution_config: { targetBranch: "feature/automation-improvements" },
      },
      {
        id: "heartbeat-polling",
        status: "todo",
        linked_run_id: null,
        current_execution_id: null,
        execution_config: { targetBranch: "feature/automation-improvements" },
      },
      {
        id: "candidate-1",
        status: "backlog",
        linked_run_id: null,
        current_execution_id: null,
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: true,
      persisted: true,
      reason: expect.stringContaining("Board stewardship"),
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "repeat",
        reason: expect.stringContaining("target branch"),
      }),
    );
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("records repeat and requests a CEO cycle when target branch blocker has no backlog alternatives", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "standing-order",
        status: "in-review",
        linked_run_id: null,
        current_execution_id: null,
        execution_config: { targetBranch: "feature/automation-improvements" },
      },
      {
        id: "heartbeat-polling",
        status: "todo",
        linked_run_id: null,
        current_execution_id: null,
        execution_config: { targetBranch: "feature/automation-improvements" },
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-2",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: true,
      persisted: true,
      reason: expect.stringContaining("target branch"),
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "repeat",
        reason: expect.stringContaining("Board stewardship"),
      }),
    );
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("repeats and requests a CEO cycle when backlog exists but no todo is dispatchable", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository(
      [
        {
          id: "todo-1",
          status: "todo",
        },
        {
          id: "dependency-1",
          status: "blocked",
        },
        {
          id: "backlog-1",
          status: "backlog",
        },
      ],
      [
        {
          work_item_id: "todo-1",
          depends_on_work_item_id: "dependency-1",
        },
      ],
    );
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-3",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: true,
      persisted: true,
      reason: expect.stringContaining("backlog"),
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "repeat",
        reason: expect.stringContaining("backlog"),
      }),
    );

    expect(orchestration.recordCycleDecision).not.toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "blocked",
      }),
    );
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("does not emit board stewardship cycle requests for duplicate repeat decisions", async () => {
    const orchestration = createMockOrchestrationService();
    orchestration.recordCycleDecision = vi.fn().mockResolvedValue({
      decision: "repeat",
      persisted: false,
      duplicate: true,
      reason: "already handled",
    });
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "backlog-1",
        status: "backlog",
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-4",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: false,
      persisted: false,
      reason: expect.stringContaining("backlog"),
    });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("does not emit board stewardship cycle requests for skipped repeat decisions", async () => {
    const orchestration = createMockOrchestrationService();
    orchestration.recordCycleDecision = vi.fn().mockResolvedValue({
      decision: "repeat",
      persisted: true,
      duplicate: false,
      skipped: true,
      reason: "repeat skipped by orchestration service",
    });
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "backlog-1",
        status: "backlog",
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-5",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: false,
      persisted: true,
      reason: expect.stringContaining("backlog"),
    });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("does not emit cycle requests when cycle decision is duplicate", async () => {
    const orchestration = createMockOrchestrationService();
    orchestration.recordCycleDecision = vi.fn().mockResolvedValue({
      decision: "repeat",
      persisted: false,
      duplicate: true,
      reason: "already handled",
    });
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "todo-1",
        status: "todo",
        metadata: {},
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: false,
      persisted: false,
      reason: expect.stringContaining("dispatchable work"),
    });

    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("does not emit cycle requests when cycle decision is skipped", async () => {
    const orchestration = createMockOrchestrationService();
    orchestration.recordCycleDecision = vi.fn().mockResolvedValue({
      decision: "repeat",
      persisted: true,
      duplicate: false,
      skipped: true,
      reason: "repeat skipped by orchestration service",
    });
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "todo-1",
        status: "todo",
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: false,
      persisted: true,
      reason: expect.stringContaining("dispatchable work"),
    });

    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("omits idempotency key for runless poll reconciliation repeat decisions", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "todo-1",
        status: "todo",
        metadata: {},
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "poll_reconciliation",
    });

    const decisionInput = orchestration.recordCycleDecision.mock
      .calls[0]?.[1] as Record<string, unknown> | undefined;

    expect(decisionInput).toMatchObject({
      decision: "repeat",
      reason: expect.stringContaining("dispatchable work"),
    });
    expect(decisionInput).not.toHaveProperty("idempotencyKey");
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("does not repeat when todo work has unmet dependencies", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository(
      [
        {
          id: "blocked-todo",
          status: "todo",
        },
        {
          id: "dependency-1",
          status: "blocked",
        },
      ],
      [
        {
          work_item_id: "blocked-todo",
          depends_on_work_item_id: "dependency-1",
        },
      ],
    );
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "pause",
      emittedCycleRequest: false,
      persisted: false,
    });
    expect(orchestration.recordCycleDecision).not.toHaveBeenCalled();
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("does not repeat when todo work is already in flight with linked run", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "todo-inflight",
        status: "todo",
        linked_run_id: "run-1",
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "pause",
      emittedCycleRequest: false,
      persisted: false,
    });

    expect(orchestration.recordCycleDecision).not.toHaveBeenCalled();
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("does not repeat when todo work is already in flight with current execution id", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "todo-inflight",
        status: "todo",
        current_execution_id: "run-1",
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "pause",
      emittedCycleRequest: false,
      persisted: false,
    });

    expect(orchestration.recordCycleDecision).not.toHaveBeenCalled();
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("repeats when an in-flight todo exists alongside an unlinked todo", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "todo-inflight",
        status: "todo",
        linked_run_id: "run-1",
      },
      {
        id: "todo-ready",
        status: "todo",
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-2",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: true,
      persisted: true,
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "repeat",
        idempotencyKey: "continuation:project-1:workflow_completed:run-2",
      }),
    );
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("blocks when active items include hard blocker with :human_decision: source", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "work-item-1",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:scope",
        },
      },
      {
        id: "work-item-2",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:gap:other",
        },
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "manual_recovery_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
      reason: expect.stringContaining("hard-blocked"),
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "blocked",
        reason: expect.stringContaining("hard-blocked"),
      }),
    );
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("retires stale imported bootstrap after imported reconciliation publishes scoped items", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "bootstrap",
        status: "todo",
        metadata: {
          sourceId: "imported-repo-bootstrap",
        },
      },
      {
        id: "scope-1",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:scope-1",
          importedRepoReconciliation: true,
        },
      },
    ]);

    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "import_hydration_completed",
      workflowRunId: "run-1",
    });

    expect(workItemService.updateStatus).toHaveBeenCalledWith(
      "project-1",
      "bootstrap",
      "blocked",
    );
    expect(workItemService.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "bootstrap",
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceId: "imported-repo-bootstrap",
          retiredByImportedReconciliation: true,
          retiredReason: expect.stringContaining("reconciliation"),
          retiredAt: expect.any(String),
        }),
      }),
    );
    expect(result).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
    });
    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "blocked",
        reason: expect.stringContaining("hard-blocked"),
        idempotencyKey:
          "continuation:project-1:import_hydration_completed:run-1",
      }),
    );
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("keeps retirement idempotent when bootstrap is already retired", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "bootstrap",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo-bootstrap",
          retiredByImportedReconciliation: true,
        },
      },
      {
        id: "scope-1",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:scope-1",
          importedRepoReconciliation: true,
        },
      },
    ]);

    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "import_hydration_completed",
      workflowRunId: "run-1",
    });

    expect(workItemService.updateStatus).not.toHaveBeenCalled();
    expect(workItemService.updateWorkItem).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
    });
    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "blocked",
        reason: expect.stringContaining("hard-blocked"),
      }),
    );
  });

  it("autonomous imported feedback-only state does not record project-level blocked", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "feedback-1",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:gap:feedback",
          importedRepoReconciliation: true,
          feedbackNeeded: true,
          autonomousDecision: true,
        },
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: true,
      persisted: true,
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "repeat",
        reason: expect.stringContaining("feedback-needed"),
      }),
    );
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("autonomous imported feedback-only state can request another cycle", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "feedback-1",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:gap:feedback-a",
          importedRepoReconciliation: true,
          feedbackNeeded: true,
          autonomousDecision: true,
        },
      },
      {
        id: "feedback-2",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:gap:feedback-b",
          importedRepoReconciliation: true,
          feedbackNeeded: true,
          autonomousDecision: true,
        },
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result.decision).toBe("repeat");
    expect(result.emittedCycleRequest).toBe(true);
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("supervised imported feedback-only records a feedback-needed blocked reason", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "feedback-1",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:gap:feedback",
          importedRepoReconciliation: true,
          feedbackNeeded: true,
          autonomousDecision: true,
        },
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
      mode: "supervised",
    });

    expect(result).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
      reason: expect.stringContaining("feedback"),
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "blocked",
        reason: expect.stringContaining("feedback"),
      }),
    );
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("dispatchable todo wins over feedback-needed blocked items", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "todo-1",
        status: "todo",
        metadata: {},
      },
      {
        id: "feedback-1",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:gap:feedback",
          importedRepoReconciliation: true,
          feedbackNeeded: true,
          autonomousDecision: true,
        },
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "repeat",
      emittedCycleRequest: true,
      persisted: true,
    });

    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("generic blocked non-feedback item without :human_decision: source results in blocked, not pause", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "blocked-1",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:gap:security-audit",
          importedRepoReconciliation: true,
        },
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "blocked",
      }),
    );
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("ignores already retired bootstrap when checking dispatchability", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "bootstrap",
        status: "todo",
        metadata: {
          sourceId: "imported-repo-bootstrap",
          retiredByImportedReconciliation: true,
        },
      },
      {
        id: "done-1",
        status: "done",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:scope-1",
          importedRepoReconciliation: true,
        },
      },
    ]);

    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "import_hydration_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "pause",
      emittedCycleRequest: false,
      persisted: false,
    });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(workItemService.updateStatus).not.toHaveBeenCalled();
    expect(workItemService.updateWorkItem).not.toHaveBeenCalled();
  });

  it("propagates persistence error from mode lookup instead of defaulting to autonomous", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "feedback-1",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:gap:feedback",
          importedRepoReconciliation: true,
          feedbackNeeded: true,
        },
      },
    ]);
    orchestration.get.mockRejectedValue(new Error("connection refused"));
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    await expect(
      service.evaluateProjectContinuation({
        projectId: "project-1",
        trigger: "workflow_completed",
        workflowRunId: "run-1",
      }),
    ).rejects.toThrow("connection refused");

    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(orchestration.recordCycleDecision).not.toHaveBeenCalled();
  });

  it("records blocked zero-work-item bootstrap continuation instead of silent pause", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([]);

    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "poll_reconciliation",
      workflowRunId: undefined,
    });

    expect(result).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
      reason: expect.stringContaining("zero work items"),
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "blocked",
        reason: expect.stringContaining("zero work items after"),
      }),
    );
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("does not treat a todo story as dispatchable when its only child is already done (children-check must use the unfiltered sibling list)", async () => {
    // Regression for the "task 10" review finding: getActiveContinuationItems
    // excludes status==="done" items, so a done-only child would vanish from
    // the sibling list that isDispatchableWorkItem uses to detect
    // "has children" — falsely treating the parent story as childless/
    // dispatchable. The real dispatch loop (dispatch-work-items.core.ts)
    // never filters by status when computing childrenParentIds, so this
    // check must use the full unfiltered item list too.
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "story-1",
        status: "todo",
        type: "story",
      },
      {
        id: "child-1",
        status: "done",
        type: "task",
        parent_work_item_id: "story-1",
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "pause",
      emittedCycleRequest: false,
      persisted: false,
    });
    expect(orchestration.recordCycleDecision).not.toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        reason: expect.stringContaining("dispatchable work"),
      }),
    );
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("does not surface a target-branch blocker for a todo story whose only child is already done (branch-blocker children-check must use the unfiltered item list)", async () => {
    // Regression for the "task 10" review finding: findTargetBranchBlockers
    // was called with state.activeItems (status-filtered), so its own
    // internal filterDispatchableTodo call couldn't see the done child and
    // wrongly treated the parent story as a childless, genuinely-dispatchable
    // item contending for the target branch. With the fix it must be called
    // with the full unfiltered item list so the story is correctly excluded
    // as a container before branch-blocker evaluation ever runs.
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([
      {
        id: "standing-order",
        status: "in-review",
        linked_run_id: null,
        current_execution_id: null,
        execution_config: { targetBranch: "feature/automation-improvements" },
      },
      {
        id: "story-1",
        status: "todo",
        type: "story",
        execution_config: { targetBranch: "feature/automation-improvements" },
      },
      {
        id: "child-1",
        status: "done",
        type: "task",
        parent_work_item_id: "story-1",
      },
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });

    const result = await service.evaluateProjectContinuation({
      projectId: "project-1",
      trigger: "workflow_completed",
      workflowRunId: "run-1",
    });

    expect(result).toMatchObject({
      decision: "pause",
      emittedCycleRequest: false,
      persisted: false,
    });
    expect(orchestration.recordCycleDecision).not.toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        reason: expect.stringContaining("target branch"),
      }),
    );
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });
});
