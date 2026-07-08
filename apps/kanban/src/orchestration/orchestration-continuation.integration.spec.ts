import { describe, expect, it, vi } from "vitest";
import { OrchestrationContinuationService } from "./orchestration-continuation.service";
import { OrchestrationService } from "./orchestration.service";
import { OrchestrationActionRequestsService } from "./orchestration-action-requests.service";
import { OrchestrationCycleDecisionService } from "./orchestration-cycle-decision.service";
import { OrchestrationObservabilityService } from "./orchestration-observability.service";
import { OrchestrationRunRequestService } from "./orchestration-run-request.service";
import { OrchestrationStateLifecycleService } from "./orchestration-state-lifecycle.service";

interface InMemoryOrchestrationRecord {
  project_id: string;
  goals: string;
  mode: string;
  status: string;
  linked_run_id: string | null;
  decision_log?: unknown[] | null;
  action_requests?: unknown[] | null;
  metadata?: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface MockWorkItem {
  id: string;
  status: string;
  metadata?: Record<string, unknown>;
}

function createOrchestrationRepository() {
  const states = new Map<string, InMemoryOrchestrationRecord>();

  return {
    repository: {
      save: vi.fn((input: InMemoryOrchestrationRecord) => {
        const existing = states.get(input.project_id);
        const next = {
          ...existing,
          ...input,
          decision_log: input.decision_log ?? existing?.decision_log ?? [],
          action_requests:
            input.action_requests ?? existing?.action_requests ?? [],
          metadata: input.metadata ?? existing?.metadata ?? null,
          created_at: existing?.created_at ?? input.created_at ?? new Date(),
          updated_at: new Date(),
        };

        states.set(input.project_id, next);
        return Promise.resolve(next);
      }),
      findByproject_id: vi.fn((projectId: string) =>
        Promise.resolve(states.get(projectId) ?? null),
      ),
      findByLinkedRunId: vi.fn((linkedRunId: string) => {
        for (const state of states.values()) {
          if (state.linked_run_id === linkedRunId) {
            return Promise.resolve(state);
          }
        }
        return Promise.resolve(null);
      }),
      clearLinkedRunIfMatches: vi.fn(
        (
          projectId: string,
          linkedRunId: string,
          metadataPatch: Record<string, unknown>,
        ) => {
          const existing = states.get(projectId);
          if (existing?.linked_run_id !== linkedRunId) {
            return Promise.resolve(false);
          }

          states.set(projectId, {
            ...existing,
            linked_run_id: null,
            metadata: {
              ...existing.metadata,
              ...metadataPatch,
            },
            updated_at: new Date(),
          });

          return Promise.resolve(true);
        },
      ),
    },
    states,
  };
}

function createWorkItemRepository(items: MockWorkItem[]) {
  return {
    findByproject_id: vi.fn().mockResolvedValue(items),
    findDependenciesByWorkItemIds: vi.fn().mockResolvedValue([]),
  };
}

function createWorkItemService() {
  return {
    updateStatus: vi.fn().mockResolvedValue({}),
    updateWorkItem: vi.fn().mockResolvedValue({}),
  };
}

function createDispatchService() {
  return {
    requestOrchestrationCycle: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Orchestration continuation integration", () => {
  it("clears terminal linked runs before persisting imported-repo blocked continuation", async () => {
    const orchestrationRepository = createOrchestrationRepository();
    const workItemService = createWorkItemService();
    const workItems = createWorkItemRepository([
      {
        id: "bootstrap",
        status: "todo",
        metadata: {
          sourceId: "imported-repo-bootstrap",
        },
      },
      ...Array.from({ length: 26 }, (_v, index) => ({
        id: `scope-${index + 1}`,
        status: "blocked",
        metadata: {
          sourceId: `imported-repo:project-1:human_decision:scope-${index + 1}`,
          importedRepoReconciliation: true,
        },
      })),
    ]);

    const dispatchService = createDispatchService();
    const requestContext = {
      getRequestId: () => "continuation-regression-request",
      getCausationId: () => "continuation-regression-causation",
    };

    const orchestrationService = new OrchestrationService(
      {
        requestWorkflowRun: vi.fn(),
      },
      {
        hasActiveProjectWorkflowRun: vi.fn().mockResolvedValue(false),
      } as never,
      requestContext,
      orchestrationRepository.repository as never,
      {
        get: vi.fn(),
      } as never,
      workItems as never,
      {
        selectPolicy: vi.fn(() => "ask_when_uncertain"),
      } as never,
      {
        runForCompletion: vi.fn(),
      } as never,
      { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
      { getNumber: vi.fn() } as never,
      { hasActiveCycleLease: vi.fn() } as never,
      { buildStrategicState: vi.fn() } as never,
      { updateStatus: vi.fn() } as never,
      new OrchestrationCycleDecisionService(
        workItems as never,
        { runForCompletion: vi.fn() } as never,
        { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
        vi.fn() as never,
      ),
      new OrchestrationActionRequestsService(
        { getRequestId: () => null },
        orchestrationRepository.repository as never,
        { updateStatus: vi.fn() } as never,
      ),
      new OrchestrationObservabilityService(workItems as never),
      new OrchestrationStateLifecycleService(),
      new OrchestrationRunRequestService(),
      vi.fn() as never,
    );

    await orchestrationRepository.repository.save({
      project_id: "project-1",
      goals: "Stabilize imported repository continuation",
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: "discovery-run-1",
      decision_log: [],
      action_requests: [],
      metadata: {},
      created_at: new Date("2026-05-09T00:00:00.000Z"),
      updated_at: new Date("2026-05-09T00:00:00.000Z"),
    });


    const continuationService = new OrchestrationContinuationService(
      orchestrationService,
      dispatchService as never,
      workItems as never,
      workItemService as never,
      {} as never,
      {
        getWorkflowRunStatus: vi.fn(),
      },
    );

    const reconcileResult =
      await orchestrationService.reconcileLinkedWorkflowRun("project-1", {
        workflowRunId: "discovery-run-1",
        status: "COMPLETED",
      });

    const clearedState =
      await orchestrationRepository.repository.findByproject_id("project-1");

    const continuationResult =
      await continuationService.evaluateProjectContinuation({
        projectId: "project-1",
        trigger: "workflow_completed",
        workflowRunId: "discovery-run-1",
      });

    expect(reconcileResult).toEqual({ cleared: true });
    expect(clearedState?.linked_run_id).toBeNull();
    expect(clearedState?.metadata).toMatchObject({
      last_terminal_run_id: "discovery-run-1",
      last_terminal_run_status: "COMPLETED",
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
          retiredReason: expect.stringContaining(
            "Imported repository reconciliation",
          ),
        }),
      }),
    );

    expect(continuationResult).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
      reason: expect.stringContaining("hard-blocked"),
    });

    const finalState =
      await orchestrationRepository.repository.findByproject_id("project-1");
    const decisionLog = finalState?.decision_log;
    expect(finalState?.metadata).toMatchObject({
      cycle_decision: "blocked",
    });
    expect(Array.isArray(decisionLog)).toBe(true);
    expect(decisionLog?.at(-1)).toMatchObject({
      type: "cycle_decision",
      cycleDecision: "blocked",
    });
    expect(dispatchService.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("resolves supervised mode from persisted orchestration state for feedback-only blocked items", async () => {
    const orchestrationRepository = createOrchestrationRepository();
    const workItemService = createWorkItemService();
    const workItems = createWorkItemRepository([
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

    const dispatchService = createDispatchService();
    const requestContext = {
      getRequestId: () => "mode-propagation-request",
      getCausationId: () => "mode-propagation-causation",
    };

    const orchestrationService = new OrchestrationService(
      {
        requestWorkflowRun: vi.fn(),
      },
      {
        hasActiveProjectWorkflowRun: vi.fn().mockResolvedValue(false),
      } as never,
      requestContext,
      orchestrationRepository.repository as never,
      {
        get: vi.fn(),
      } as never,
      workItems as never,
      {
        selectPolicy: vi.fn(() => "ask_when_uncertain"),
      } as never,
      {
        runForCompletion: vi.fn(),
      } as never,
      { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
      { getNumber: vi.fn() } as never,
      { hasActiveCycleLease: vi.fn() } as never,
      { buildStrategicState: vi.fn() } as never,
      { updateStatus: vi.fn() } as never,
      new OrchestrationCycleDecisionService(
        workItems as never,
        { runForCompletion: vi.fn() } as never,
        { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
        vi.fn() as never,
      ),
      new OrchestrationActionRequestsService(
        { getRequestId: () => null },
        orchestrationRepository.repository as never,
        { updateStatus: vi.fn() } as never,
      ),
      new OrchestrationObservabilityService(workItems as never),
      new OrchestrationStateLifecycleService(),
      new OrchestrationRunRequestService(),
      vi.fn() as never,
    );

    await orchestrationRepository.repository.save({
      project_id: "project-1",
      goals: "Test supervised mode propagation",
      mode: "supervised",
      status: "orchestrating",
      linked_run_id: null,
      decision_log: [],
      action_requests: [],
      metadata: {},
      created_at: new Date("2026-05-10T00:00:00.000Z"),
      updated_at: new Date("2026-05-10T00:00:00.000Z"),
    });

    const continuationService = new OrchestrationContinuationService(
      orchestrationService,
      dispatchService as never,
      workItems as never,
      workItemService as never,
      {} as never,
      {
        getWorkflowRunStatus: vi.fn(),
      },
    );

    const continuationResult =
      await continuationService.evaluateProjectContinuation({
        projectId: "project-1",
        trigger: "workflow_completed",
        workflowRunId: "run-1",
      });

    expect(continuationResult).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
      reason: expect.stringContaining("feedback"),
    });

    expect(dispatchService.requestOrchestrationCycle).not.toHaveBeenCalled();

    const finalState =
      await orchestrationRepository.repository.findByproject_id("project-1");
    expect(finalState?.metadata).toMatchObject({
      cycle_decision: "blocked",
    });
  });

  it("reconciles post-rerun parent linked run and persists blocked continuation", async () => {
    const orchestrationRepository = createOrchestrationRepository();
    const workItemService = createWorkItemService();
    const workItems = createWorkItemRepository([
      {
        id: "bootstrap",
        status: "todo",
        metadata: {
          sourceId: "imported-repo-bootstrap",
        },
      },
      ...Array.from({ length: 26 }, (_v, index) => ({
        id: `scope-${index + 1}`,
        status: "blocked",
        metadata: {
          sourceId: `imported-repo:project-1:human_decision:scope-${index + 1}`,
          importedRepoReconciliation: true,
        },
      })),
    ]);

    const dispatchService = createDispatchService();
    const requestContext = {
      getRequestId: () => "post-rerun-regression-request",
      getCausationId: () => "post-rerun-regression-causation",
    };

    const orchestrationService = new OrchestrationService(
      {
        requestWorkflowRun: vi.fn(),
      },
      {
        hasActiveProjectWorkflowRun: vi.fn().mockResolvedValue(false),
      } as never,
      requestContext,
      orchestrationRepository.repository as never,
      {
        get: vi.fn(),
      } as never,
      workItems as never,
      {
        selectPolicy: vi.fn(() => "ask_when_uncertain"),
      } as never,
      {
        runForCompletion: vi.fn(),
      } as never,
      { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
      { getNumber: vi.fn() } as never,
      { hasActiveCycleLease: vi.fn() } as never,
      { buildStrategicState: vi.fn() } as never,
      { updateStatus: vi.fn() } as never,
      new OrchestrationCycleDecisionService(
        workItems as never,
        { runForCompletion: vi.fn() } as never,
        { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
        vi.fn() as never,
      ),
      new OrchestrationActionRequestsService(
        { getRequestId: () => null },
        orchestrationRepository.repository as never,
        { updateStatus: vi.fn() } as never,
      ),
      new OrchestrationObservabilityService(workItems as never),
      new OrchestrationStateLifecycleService(),
      new OrchestrationRunRequestService(),
      vi.fn() as never,
    );

    await orchestrationRepository.repository.save({
      project_id: "project-1",
      goals: "Post-rerun continuation regression",
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: "parent-run-1",
      decision_log: [],
      action_requests: [],
      metadata: {},
      created_at: new Date("2026-05-10T00:00:00.000Z"),
      updated_at: new Date("2026-05-10T00:00:00.000Z"),
    });

    const continuationService = new OrchestrationContinuationService(
      orchestrationService,
      dispatchService as never,
      workItems as never,
      workItemService as never,
      {} as never,
      {
        getWorkflowRunStatus: vi.fn(),
      },
    );

    const linkedState =
      await orchestrationService.findByLinkedWorkflowRun("parent-run-1");
    expect(linkedState).not.toBeNull();
    expect(linkedState?.project_id).toBe("project-1");
    if (!linkedState) {
      throw new Error("expected linked orchestration state");
    }

    const reconcileResult =
      await orchestrationService.reconcileLinkedWorkflowRun(
        linkedState.project_id,
        {
          workflowRunId: "parent-run-1",
          status: "COMPLETED",
        },
      );

    const clearedState =
      await orchestrationRepository.repository.findByproject_id("project-1");

    expect(reconcileResult).toEqual({ cleared: true });
    expect(clearedState?.linked_run_id).toBeNull();
    expect(clearedState?.metadata).toMatchObject({
      last_terminal_run_id: "parent-run-1",
      last_terminal_run_status: "COMPLETED",
    });

    const continuationResult =
      await continuationService.evaluateProjectContinuation({
        projectId: "project-1",
        trigger: "workflow_completed",
        workflowRunId: "parent-run-1",
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
          retiredReason: expect.stringContaining(
            "Imported repository reconciliation",
          ),
        }),
      }),
    );
    expect(continuationResult).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
      reason: expect.stringContaining("hard-blocked"),
    });
    expect(continuationResult.reason).not.toBe("unknown");
    expect(continuationResult.reason).not.toBe("");

    const finalState =
      await orchestrationRepository.repository.findByproject_id("project-1");
    const decisionLog = finalState?.decision_log;
    expect(finalState?.metadata).toMatchObject({
      cycle_decision: "blocked",
    });
    expect(finalState?.metadata?.cycle_decision_reason).toBe(
      continuationResult.reason,
    );
    expect(finalState?.metadata?.cycle_decision_reason).not.toBe("unknown");
    expect(finalState?.metadata).not.toMatchObject({
      blocked_reason: "unknown",
    });
    expect(Array.isArray(decisionLog)).toBe(true);
    expect(decisionLog?.at(-1)).toMatchObject({
      type: "cycle_decision",
      cycleDecision: "blocked",
    });
    expect(dispatchService.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("records blocked decision for zero-work-item bootstrap continuation", async () => {
    const orchestrationRepository = createOrchestrationRepository();
    const workItemService = createWorkItemService();
    const workItems = createWorkItemRepository([]); // Empty project

    const dispatchService = createDispatchService();
    const requestContext = {
      getRequestId: () => "zero-work-request",
      getCausationId: () => "zero-work-causation",
    };

    const orchestrationService = new OrchestrationService(
      {
        requestWorkflowRun: vi.fn(),
      },
      {
        hasActiveProjectWorkflowRun: vi.fn().mockResolvedValue(false),
      } as never,
      requestContext,
      orchestrationRepository.repository as never,
      {
        get: vi.fn(),
      } as never,
      workItems as never,
      {
        selectPolicy: vi.fn(() => "ask_when_uncertain"),
      } as never,
      {
        runForCompletion: vi.fn(),
      } as never,
      { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
      { getNumber: vi.fn() } as never,
      { hasActiveCycleLease: vi.fn() } as never,
      { buildStrategicState: vi.fn() } as never,
      { updateStatus: vi.fn() } as never,
      new OrchestrationCycleDecisionService(
        workItems as never,
        { runForCompletion: vi.fn() } as never,
        { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
        vi.fn() as never,
      ),
      new OrchestrationActionRequestsService(
        { getRequestId: () => null },
        orchestrationRepository.repository as never,
        { updateStatus: vi.fn() } as never,
      ),
      new OrchestrationObservabilityService(workItems as never),
      new OrchestrationStateLifecycleService(),
      new OrchestrationRunRequestService(),
      vi.fn() as never,
    );

    // Setup: empty project with no work items (bootstrap produced nothing)
    await orchestrationRepository.repository.save({
      project_id: "project-1",
      goals: JSON.stringify(["discover specs from imported repo"]),
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: null,
      decision_log: [],
      action_requests: [],
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    const continuationService = new OrchestrationContinuationService(
      orchestrationService,
      dispatchService as never,
      workItems as never,
      workItemService as never,
      {} as never,
      {
        getWorkflowRunStatus: vi.fn(),
      },
    );

    const continuationResult =
      await continuationService.evaluateProjectContinuation({
        projectId: "project-1",
        trigger: "poll_reconciliation",
        workflowRunId: undefined,
      });

    expect(continuationResult).toMatchObject({
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: true,
    });

    expect(continuationResult.reason).toContain("zero work items");
    expect(continuationResult.reason).toContain("bootstrap");

    const finalState =
      await orchestrationRepository.repository.findByproject_id("project-1");
    expect(finalState?.metadata).toMatchObject({
      cycle_decision: "blocked",
    });
    expect(Array.isArray(finalState?.decision_log)).toBe(true);
    const decisionLogArr = finalState?.decision_log as unknown[];
    expect(decisionLogArr?.at(-1)).toMatchObject({
      type: "cycle_decision",
      cycleDecision: "blocked",
    });

    expect(dispatchService.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("distinguishes zero-work-item bootstrap from completed orchestration pause", async () => {
    // Test 1: Empty project (true bootstrap zero-work scenario)
    const bootstrapRepo = createOrchestrationRepository();
    const bootstrapWorkItems = createWorkItemRepository([]);
    const bootstrapDispatch = createDispatchService();

    const bootstrapOrchestrService = new OrchestrationService(
      { requestWorkflowRun: vi.fn() },
      {
        hasActiveProjectWorkflowRun: vi.fn().mockResolvedValue(false),
      } as never,
      {
        getRequestId: () => "bootstrap-req",
        getCausationId: () => "bootstrap-cause",
      },
      bootstrapRepo.repository as never,
      { get: vi.fn() } as never,
      bootstrapWorkItems as never,
      { selectPolicy: vi.fn(() => "ask_when_uncertain") } as never,
      { runForCompletion: vi.fn() } as never,
      { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
      { getNumber: vi.fn() } as never,
      { hasActiveCycleLease: vi.fn() } as never,
      { buildStrategicState: vi.fn() } as never,
      { updateStatus: vi.fn() } as never,
      new OrchestrationCycleDecisionService(
        bootstrapWorkItems as never,
        { runForCompletion: vi.fn() } as never,
        { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
        vi.fn() as never,
      ),
      new OrchestrationActionRequestsService(
        { getRequestId: () => null },
        bootstrapRepo.repository as never,
        { updateStatus: vi.fn() } as never,
      ),
      new OrchestrationObservabilityService(bootstrapWorkItems as never),
      new OrchestrationStateLifecycleService(),
      new OrchestrationRunRequestService(),
      vi.fn() as never,
    );

    await bootstrapRepo.repository.save({
      project_id: "project-bootstrap",
      goals: JSON.stringify(["discover specs"]),
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: null,
      decision_log: [],
      action_requests: [],
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    const bootstrapContinuation = new OrchestrationContinuationService(
      bootstrapOrchestrService,
      bootstrapDispatch as never,
      bootstrapWorkItems as never,
      createWorkItemService() as never,
      {} as never,
      { getWorkflowRunStatus: vi.fn() },
    );

    const bootstrapResult =
      await bootstrapContinuation.evaluateProjectContinuation({
        projectId: "project-bootstrap",
        trigger: "poll_reconciliation",
      });

    expect(bootstrapResult.decision).toBe("blocked");
    expect(bootstrapResult.persisted).toBe(true);
    expect(bootstrapResult.reason).toContain("zero work items");

    // Test 2: Project with all work items done (completed orchestration)
    const completedRepo = createOrchestrationRepository();
    const completedWorkItems = createWorkItemRepository([
      {
        id: "item-1",
        status: "done",
        metadata: { sourceId: "completed-work-1" },
      },
    ]);
    const completedDispatch = createDispatchService();

    const completedOrchestrService = new OrchestrationService(
      { requestWorkflowRun: vi.fn() },
      {
        hasActiveProjectWorkflowRun: vi.fn().mockResolvedValue(false),
      } as never,
      {
        getRequestId: () => "complete-req",
        getCausationId: () => "complete-cause",
      },
      completedRepo.repository as never,
      { get: vi.fn() } as never,
      completedWorkItems as never,
      { selectPolicy: vi.fn(() => "ask_when_uncertain") } as never,
      { runForCompletion: vi.fn() } as never,
      { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
      { getNumber: vi.fn() } as never,
      { hasActiveCycleLease: vi.fn() } as never,
      { buildStrategicState: vi.fn() } as never,
      { updateStatus: vi.fn() } as never,
      new OrchestrationCycleDecisionService(
        completedWorkItems as never,
        { runForCompletion: vi.fn() } as never,
        { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
        vi.fn() as never,
      ),
      new OrchestrationActionRequestsService(
        { getRequestId: () => null },
        completedRepo.repository as never,
        { updateStatus: vi.fn() } as never,
      ),
      new OrchestrationObservabilityService(completedWorkItems as never),
      new OrchestrationStateLifecycleService(),
      new OrchestrationRunRequestService(),
      vi.fn() as never,
    );

    await completedRepo.repository.save({
      project_id: "project-completed",
      goals: JSON.stringify(["complete project"]),
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: null,
      decision_log: [],
      action_requests: [],
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    const completedContinuation = new OrchestrationContinuationService(
      completedOrchestrService,
      completedDispatch as never,
      completedWorkItems as never,
      createWorkItemService() as never,
      {} as never,
      { getWorkflowRunStatus: vi.fn() },
    );

    const completedResult =
      await completedContinuation.evaluateProjectContinuation({
        projectId: "project-completed",
        trigger: "work_item_completed",
      });

    expect(completedResult.decision).toBe("pause");
    expect(completedResult.persisted).toBe(false);
    expect(completedResult.reason).not.toContain("zero work items");
  });
});
