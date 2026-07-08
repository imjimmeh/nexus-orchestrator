import { NotFoundException } from "@nestjs/common";
import { FailureClass } from "@nexus/core";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
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
  linked_run_id?: string | null;
  current_execution_id?: string | null;
  metadata?: Record<string, unknown>;
}

interface MockDependency {
  work_item_id: string;
  depends_on_work_item_id: string;
}

interface MockWorkItemRepository {
  findByproject_id: Mock;
  findDependenciesByWorkItemIds: Mock;
}

interface MockWorkItemService {
  updateStatus: Mock;
  updateWorkItem: Mock;
}

interface MockCoreWorkflowClientService {
  getWorkflowRunStatus: Mock;
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
  dependencies: MockDependency[] = [],
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

function createMockCoreWorkflowClient(
  statuses: Record<string, string> = {},
): MockCoreWorkflowClientService {
  return {
    getWorkflowRunStatus: vi.fn((runId: string) =>
      Promise.resolve({ status: statuses[runId] ?? "RUNNING" }),
    ),
  };
}

function createService({
  orchestration,
  dispatch,
  workItems,
  workItemService,
  coreWorkflowClient,
  wakeupService,
}: {
  orchestration: MockOrchestrationService;
  dispatch: MockDispatchService;
  workItems: MockWorkItemRepository;
  workItemService: MockWorkItemService;
  coreWorkflowClient?: MockCoreWorkflowClientService;
  wakeupService?: { requestWakeup: ReturnType<typeof vi.fn> };
}) {
  const client = coreWorkflowClient ?? createMockCoreWorkflowClient();
  const wakeup = wakeupService ?? {
    requestWakeup: vi.fn().mockResolvedValue({ emitted: true }),
  };
  const service = new OrchestrationContinuationService(
    orchestration as never,
    dispatch as never,
    workItems as never,
    workItemService as never,
    wakeup as never,
    client,
  );

  return service;
}

describe("OrchestrationContinuationService", () => {
  it("reconciles orchestrating states for poll fallback", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([]);

    orchestration.findOrchestratingStates.mockResolvedValue([
      {
        project_id: "project-1",
        linked_run_id: "run-1",
      } as never,
      {
        project_id: "project-2",
        linked_run_id: null,
      } as never,
    ]);

    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });
    const evaluateSpy = vi
      .spyOn(service, "evaluateProjectContinuation")
      .mockResolvedValue({
        decision: "pause",
        emittedCycleRequest: false,
        persisted: false,
        reason: "No dispatchable work",
      });

    const result = await service.reconcileStaleContinuations();

    expect(orchestration.findOrchestratingStates).toHaveBeenCalledWith();
    expect(evaluateSpy).toHaveBeenNthCalledWith(1, {
      projectId: "project-1",
      trigger: "poll_reconciliation",
      workflowRunId: "run-1",
    });
    expect(evaluateSpy).toHaveBeenNthCalledWith(2, {
      projectId: "project-2",
      trigger: "poll_reconciliation",
      workflowRunId: undefined,
    });
    expect(result).toEqual({ evaluated: 2 });
  });

  it("fails fast when a stale reconciliation evaluation fails", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([]);

    orchestration.findOrchestratingStates.mockResolvedValue([
      {
        project_id: "project-1",
        linked_run_id: "run-1",
      } as never,
    ]);
    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
    });
    vi.spyOn(service, "evaluateProjectContinuation").mockRejectedValue(
      new Error("evaluation failed"),
    );

    await expect(service.reconcileStaleContinuations()).rejects.toThrow(
      "evaluation failed",
    );
    expect(orchestration.findOrchestratingStates).toHaveBeenCalledWith();
  });

  it("reconciles stale terminal linked runs during poll fallback", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([]);
    const coreWorkflowClient = createMockCoreWorkflowClient({
      "run-1": "COMPLETED",
    });

    orchestration.findOrchestratingStates.mockResolvedValue([
      {
        project_id: "project-1",
        linked_run_id: "run-1",
      } as never,
    ]);

    orchestration.reconcileLinkedWorkflowRun.mockResolvedValue({
      cleared: true,
    });

    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
      coreWorkflowClient,
    });
    const evaluateSpy = vi
      .spyOn(service, "evaluateProjectContinuation")
      .mockResolvedValue({
        decision: "pause",
        emittedCycleRequest: false,
        persisted: false,
        reason: "No dispatchable work",
      });

    const result = await service.reconcileStaleContinuations();

    expect(coreWorkflowClient.getWorkflowRunStatus).toHaveBeenCalledWith(
      "run-1",
      "kanban-continuation-reconcile:project-1:run-1",
    );
    expect(orchestration.reconcileLinkedWorkflowRun).toHaveBeenCalledWith(
      "project-1",
      {
        workflowRunId: "run-1",
        status: "COMPLETED",
      },
    );
    expect(evaluateSpy).toHaveBeenNthCalledWith(1, {
      projectId: "project-1",
      trigger: "poll_reconciliation",
    });
    expect(result).toEqual({ evaluated: 1 });
  });

  it("retains stale workflowRunId when terminal-linked run is non-terminal", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([]);
    const coreWorkflowClient = createMockCoreWorkflowClient({
      "run-1": "RUNNING",
    });

    orchestration.findOrchestratingStates.mockResolvedValue([
      {
        project_id: "project-1",
        linked_run_id: "run-1",
      } as never,
    ]);

    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
      coreWorkflowClient,
    });
    const evaluateSpy = vi
      .spyOn(service, "evaluateProjectContinuation")
      .mockResolvedValue({
        decision: "pause",
        emittedCycleRequest: false,
        persisted: false,
        reason: "No dispatchable work",
      });

    const result = await service.reconcileStaleContinuations();

    expect(coreWorkflowClient.getWorkflowRunStatus).toHaveBeenCalledWith(
      "run-1",
      "kanban-continuation-reconcile:project-1:run-1",
    );
    expect(orchestration.reconcileLinkedWorkflowRun).not.toHaveBeenCalled();
    expect(evaluateSpy).toHaveBeenNthCalledWith(1, {
      projectId: "project-1",
      trigger: "poll_reconciliation",
      workflowRunId: "run-1",
    });
    expect(result).toEqual({ evaluated: 1 });
  });

  it("skips evaluation when terminal linked run is not cleared by reconcileLinkedWorkflowRun", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([]);
    const coreWorkflowClient = createMockCoreWorkflowClient({
      "run-1": "COMPLETED",
    });

    orchestration.findOrchestratingStates.mockResolvedValue([
      {
        project_id: "project-1",
        linked_run_id: "run-1",
      } as never,
    ]);

    orchestration.reconcileLinkedWorkflowRun.mockResolvedValue({
      cleared: false,
    });

    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
      coreWorkflowClient,
    });
    const evaluateSpy = vi
      .spyOn(service, "evaluateProjectContinuation")
      .mockResolvedValue({
        decision: "pause",
        emittedCycleRequest: false,
        persisted: false,
        reason: "No dispatchable work",
      });

    await service.reconcileStaleContinuations();

    expect(coreWorkflowClient.getWorkflowRunStatus).toHaveBeenCalledWith(
      "run-1",
      "kanban-continuation-reconcile:project-1:run-1",
    );
    expect(orchestration.reconcileLinkedWorkflowRun).toHaveBeenCalledWith(
      "project-1",
      {
        workflowRunId: "run-1",
        status: "COMPLETED",
      },
    );
    expect(evaluateSpy).not.toHaveBeenCalled();
  });

  it("passes consecutiveFailure: true to evaluateProjectContinuation when linked run has FAILED status", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([]);
    const coreWorkflowClient = createMockCoreWorkflowClient({
      "run-1": "FAILED",
    });

    orchestration.findOrchestratingStates.mockResolvedValue([
      {
        project_id: "project-1",
        linked_run_id: "run-1",
      } as never,
    ]);

    orchestration.reconcileLinkedWorkflowRun.mockResolvedValue({ cleared: true });

    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
      coreWorkflowClient,
    });
    const evaluateSpy = vi
      .spyOn(service, "evaluateProjectContinuation")
      .mockResolvedValue({
        decision: "pause",
        emittedCycleRequest: false,
        persisted: false,
        reason: "No dispatchable work",
      });

    await service.reconcileStaleContinuations();

    expect(coreWorkflowClient.getWorkflowRunStatus).toHaveBeenCalledWith(
      "run-1",
      "kanban-continuation-reconcile:project-1:run-1",
    );
    expect(orchestration.reconcileLinkedWorkflowRun).toHaveBeenCalledWith(
      "project-1",
      {
        workflowRunId: "run-1",
        status: "FAILED",
      },
    );
    expect(evaluateSpy).toHaveBeenNthCalledWith(1, {
      projectId: "project-1",
      trigger: "poll_reconciliation",
      consecutiveFailure: true,
      failureClass: FailureClass.SystemFailure,
    });
  });

  it("does not pass consecutiveFailure when linked run has COMPLETED status", async () => {
    const orchestration = createMockOrchestrationService();
    const dispatch = createMockDispatchService();
    const workItemService = createMockWorkItemService();
    const workItems = createMockWorkItemRepository([]);
    const coreWorkflowClient = createMockCoreWorkflowClient({
      "run-1": "COMPLETED",
    });

    orchestration.findOrchestratingStates.mockResolvedValue([
      {
        project_id: "project-1",
        linked_run_id: "run-1",
      } as never,
    ]);

    orchestration.reconcileLinkedWorkflowRun.mockResolvedValue({ cleared: true });

    const service = createService({
      orchestration,
      dispatch,
      workItems,
      workItemService,
      coreWorkflowClient,
    });
    const evaluateSpy = vi
      .spyOn(service, "evaluateProjectContinuation")
      .mockResolvedValue({
        decision: "pause",
        emittedCycleRequest: false,
        persisted: false,
        reason: "No dispatchable work",
      });

    await service.reconcileStaleContinuations();

    expect(coreWorkflowClient.getWorkflowRunStatus).toHaveBeenCalledWith(
      "run-1",
      "kanban-continuation-reconcile:project-1:run-1",
    );
    expect(orchestration.reconcileLinkedWorkflowRun).toHaveBeenCalledWith(
      "project-1",
      {
        workflowRunId: "run-1",
        status: "COMPLETED",
      },
    );
    expect(evaluateSpy).toHaveBeenNthCalledWith(1, {
      projectId: "project-1",
      trigger: "poll_reconciliation",
    });
  });
});
