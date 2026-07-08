import { beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  WorkflowRunAcceptedV1,
  WorkflowRunRequestV1,
} from "@nexus/core";
import { BaseRequestContextService } from "@nexus/core";
import { CoreRunProjectionService } from "../core/core-run-projection.service";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { ProjectService } from "../project/project.service";
import {
  KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
} from "../retrospectives/kanban-retrospective-failure-threshold.types";
import { KanbanRetrospectiveService } from "../retrospectives/kanban-retrospective.service";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import { WorkItemService } from "../work-item/work-item.service";
import { OrchestrationLeaseService } from "./control-plane/orchestration-lease.service";
import { HumanDecisionResolutionPolicyService } from "./human-decision-resolution-policy.service";
import { OrchestrationService } from "./orchestration.service";
import { OrchestrationActionRequestsService } from "./orchestration-action-requests.service";
import {
  ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE,
  OrchestrationCycleDecisionService,
} from "./orchestration-cycle-decision.service";
import { OrchestrationObservabilityService } from "./orchestration-observability.service";
import { OrchestrationRunRequestService } from "./orchestration-run-request.service";
import { OrchestrationStateLifecycleService } from "./orchestration-state-lifecycle.service";
import { ProjectStrategicStateService } from "./strategic/project-strategic-state.service";

describe("OrchestrationService", () => {
  let service: OrchestrationService;
  let capturedRequests: WorkflowRunRequestV1[];
  const byProject = new Map<
    string,
    {
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
  >();

  function requireProjectState(projectId: string) {
    const state = byProject.get(projectId);
    if (!state) {
      throw new Error(`expected orchestration state for ${projectId}`);
    }
    return state;
  }

  const orchestrationRepository = {
    save: vi.fn(
      (input: {
        project_id: string;
        goals: string;
        mode: string;
        status: string;
        linked_run_id: string | null;
        decision_log?: unknown[] | null;
        action_requests?: unknown[] | null;
        metadata?: Record<string, unknown> | null;
      }) => {
        const existing = byProject.get(input.project_id);
        const next = {
          ...input,
          project_id: input.project_id,
          goals: input.goals,
          mode: input.mode,
          status: input.status,
          linked_run_id: input.linked_run_id,
          decision_log: input.decision_log,
          action_requests: input.action_requests,
          metadata: input.metadata,
          updated_at: new Date(),
          created_at: existing?.created_at ?? new Date(),
        };
        byProject.set(input.project_id, next);
        return Promise.resolve(next);
      },
    ),
    findByproject_id: vi.fn((project_id: string) =>
      Promise.resolve(byProject.get(project_id) ?? null),
    ),
    findByLinkedRunId: vi.fn((linked_run_id: string) => {
      for (const state of byProject.values()) {
        if (state.linked_run_id === linked_run_id) {
          return Promise.resolve(state);
        }
      }

      return Promise.resolve(null);
    }),
    findByStatus: vi.fn((status: string) =>
      Promise.resolve(
        [...byProject.values()].filter((state) => state.status === status),
      ),
    ),
    clearLinkedRunIfMatches: vi.fn(
      (
        project_id: string,
        linked_run_id: string,
        metadataPatch: Record<string, unknown>,
      ) => {
        const existing = byProject.get(project_id);
        if (!existing || existing.linked_run_id !== linked_run_id) {
          return Promise.resolve(false);
        }

        byProject.set(project_id, {
          ...existing,
          linked_run_id: null,
          metadata: {
            ...(existing.metadata ?? {}),
            ...metadataPatch,
          },
          updated_at: new Date(),
        });
        return Promise.resolve(true);
      },
    ),
    findAll: vi.fn(() => Promise.resolve([...byProject.values()])),
    updateMode: vi.fn((project_id: string, mode: string) => {
      const existing = byProject.get(project_id);
      if (existing) {
        byProject.set(project_id, {
          ...existing,
          mode,
          updated_at: new Date(),
        });
      }
      return Promise.resolve();
    }),
  };

  const acceptedResponse: WorkflowRunAcceptedV1 = {
    run_id: "run-orch-1",
    workflow_id: "project-orchestration-flow",
    status: "accepted",
    accepted_at: "2026-04-13T00:00:00.000Z",
    metadata: { correlation_id: "corr-orch-1" },
  };

  const projectService = {
    get: vi.fn(),
  };

  const workItems = {
    findByproject_id: vi.fn(() => Promise.resolve([])),
    findDependenciesByWorkItemIds: vi.fn(() => Promise.resolve([])),
  };

  const coreRunProjections = {
    hasActiveProjectWorkflowRun: vi.fn(() => Promise.resolve(false)),
  };

  const mockHumanDecisionPolicyService = {
    selectPolicy: vi.fn(() => "ask_when_uncertain"),
  };

  const retrospectiveService = {
    runForCompletion: vi.fn(() =>
      Promise.resolve({
        status: "skipped",
        reason: "no_delta",
        runId: "retro-1",
      }),
    ),
  };

  const failureThresholdService = {
    checkFailureThreshold: vi.fn(() => Promise.resolve(undefined)),
    resetConsecutiveFailureCount: vi.fn(() => Promise.resolve(undefined)),
  };

  const kanbanSettings = {
    getNumber: vi.fn(() => Promise.resolve(1)),
  };

  const leaseService = {
    hasActiveCycleLease: vi.fn(() => Promise.resolve(false)),
  };

  it("emits concrete orchestration service provider metadata", () => {
    const paramTypes = Reflect.getMetadata(
      "design:paramtypes",
      OrchestrationService,
    ) as unknown[];

    expect(paramTypes[7]).toBe(KanbanRetrospectiveService);
    // The failure-threshold service is consumed through the
    // IKanbanRetrospectiveFailureThresholdService interface, which is
    // erased at runtime, so the emitted design:paramtypes entry is the
    // generic Object marker.
    expect(paramTypes[8]).toBe(Object);
    expect(paramTypes[9]).toBe(KanbanSettingsService);
    expect(paramTypes[10]).toBe(OrchestrationLeaseService);

    // Slots 13-17 hold the 5 @Injectable() helper services promoted in
    // the M1 refactor. The constructor exposes 18 parameters (indices
    // 0-17), so the helpers land at slots 13-17. Reordering, dropping,
    // or re-injecting any of these manually would silently
    // re-introduce non-DI wiring, so the exact order must remain
    // locked.
    expect(paramTypes[13]).toBe(OrchestrationCycleDecisionService);
    expect(paramTypes[14]).toBe(OrchestrationActionRequestsService);
    expect(paramTypes[15]).toBe(OrchestrationObservabilityService);
    expect(paramTypes[16]).toBe(OrchestrationStateLifecycleService);
    expect(paramTypes[17]).toBe(OrchestrationRunRequestService);
  });

  beforeEach(() => {
    capturedRequests = [];
    byProject.clear();
    vi.clearAllMocks();

    projectService.get.mockResolvedValue({
      id: "project-1",
      basePath: null,
      repositoryUrl: null,
    });

    const requestContext = {
      getRequestId: () => "corr-kanban-orchestration",
      getCausationId: () => "cause-kanban-orchestration",
    } as unknown as BaseRequestContextService;

    const cycleDecisionService = new OrchestrationCycleDecisionService(
      workItems as never,
      retrospectiveService as never,
      failureThresholdService,
      vi.fn() as never,
    );
    const actionRequestsService = new OrchestrationActionRequestsService(
      requestContext,
      orchestrationRepository as never,
      { updateStatus: vi.fn() } as never,
    );
    const observabilityService = new OrchestrationObservabilityService(
      workItems as never,
    );
    const stateLifecycleService = new OrchestrationStateLifecycleService();
    const runRequestService = new OrchestrationRunRequestService();

    service = new OrchestrationService(
      {
        requestWorkflowRun: (
          request: WorkflowRunRequestV1,
        ): Promise<WorkflowRunAcceptedV1> => {
          capturedRequests.push(request);
          return Promise.resolve(acceptedResponse);
        },
      },
      coreRunProjections as never,
      requestContext,
      orchestrationRepository as never,
      projectService as never,
      workItems as never,
      mockHumanDecisionPolicyService as never,
      retrospectiveService as never,
      failureThresholdService,
      kanbanSettings as never,
      leaseService as never,
      { buildStrategicState: vi.fn() } as never,
      { updateStatus: vi.fn() } as never,
      cycleDecisionService,
      actionRequestsService,
      observabilityService,
      stateLifecycleService,
      runRequestService,
    );
  });

  it("starts orchestration through core with deterministic idempotency key", async () => {
    const state = await service.start("project-1", {
      goals: "Ship EPIC-091",
      workflowId: "project-orchestration-flow",
      requestedBy: "orchestrator-user",
    });

    expect(capturedRequests.length).toBe(1);
    const request = capturedRequests[0];
    expect(request.workflow_id).toBe("project_orchestration_cycle_ceo");
    expect(request.metadata.idempotency_key).toBe(
      "kanban:orchestration:start:project-1",
    );
    expect(request.metadata.correlation_id).toBe("corr-kanban-orchestration");
    expect(request.metadata.causation_id).toBe("cause-kanban-orchestration");
    expect(request.metadata.requested_by).toBe("orchestrator-user");
    expect(request.context).toEqual({
      scopeId: null,
      contextId: "project-1",
      contextType: "kanban.project",
      scopeNodeId: null,
      scopePath: null,
    });
    expect(state).toMatchObject({
      id: "project-1",
      project_id: "project-1",
      status: "orchestrating",
      orchestrationMode: "supervised",
      currentWorkflowRunId: "run-orch-1",
      goals: "Ship EPIC-091",
    });
  });

  it("reports an active cycle when the lease service has an active lease", async () => {
    leaseService.hasActiveCycleLease.mockResolvedValueOnce(true);
    await expect(service.isCycleActive("project-1")).resolves.toBe(true);
    expect(leaseService.hasActiveCycleLease).toHaveBeenCalledWith("project-1");
  });

  it("reports no active cycle when the lease service has no active lease", async () => {
    leaseService.hasActiveCycleLease.mockResolvedValueOnce(false);
    await expect(service.isCycleActive("project-1")).resolves.toBe(false);
  });

  it.each(["blocked", "pause", "complete"])(
    "reports %s cycle decisions as suppressing automatic wakeups",
    async (decision) => {
      byProject.set("project-1", {
        project_id: "project-1",
        goals: "Ship EPIC-091",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: null,
        metadata: { cycle_decision: decision },
        created_at: new Date(),
        updated_at: new Date(),
      });

      await expect(
        service.getAutoWakeSuppressionState("project-1"),
      ).resolves.toEqual({ suppressed: true, decision });
    },
  );

  it.each([
    { decision: "blocked", entry: { cycleDecision: "blocked" } },
    { decision: "pause", entry: { decision: "pause" } },
    { decision: "complete", entry: { actions: ["complete"] } },
  ])(
    "reports decision-log-only $decision decisions as suppressing automatic wakeups",
    async ({ decision, entry }) => {
      byProject.set("project-1", {
        project_id: "project-1",
        goals: "Ship EPIC-091",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: null,
        decision_log: [
          {
            type: "cycle_decision",
            timestamp: new Date().toISOString(),
            reasoning: "Stop automatic wakeup",
            ...entry,
          },
        ],
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      });

      await expect(
        service.getAutoWakeSuppressionState("project-1"),
      ).resolves.toEqual({ suppressed: true, decision });
    },
  );

  it("reports missing orchestration state as not suppressing automatic wakeups", async () => {
    await expect(
      service.getAutoWakeSuppressionState("missing-project"),
    ).resolves.toEqual({ suppressed: false });
  });

  it("reports non-stop cycle decisions as not suppressing automatic wakeups", async () => {
    byProject.set("project-1", {
      project_id: "project-1",
      goals: "Ship EPIC-091",
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: null,
      metadata: { cycle_decision: "repeat" },
      created_at: new Date(),
      updated_at: new Date(),
    });

    await expect(
      service.getAutoWakeSuppressionState("project-1"),
    ).resolves.toEqual({ suppressed: false });
  });

  it("preserves stale wakeup metadata when a later non-stale wakeup is recorded", async () => {
    const staleWakeupAt = new Date("2026-05-14T12:00:00.000Z").getTime();
    const lifecycleWakeupAt = new Date("2026-05-14T12:01:01.000Z").getTime();
    byProject.set("project-1", {
      project_id: "project-1",
      goals: "Ship EPIC-091",
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const dateNow = vi.spyOn(Date, "now").mockReturnValue(staleWakeupAt);
    await service.recordWakeup("project-1", {
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    dateNow.mockReturnValue(lifecycleWakeupAt);
    await service.recordWakeup("project-1", {
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });
    dateNow.mockRestore();

    await expect(service.getWakeupCooldownState("project-1")).resolves.toEqual({
      lastWakeupAt: "2026-05-14T12:01:01.000Z",
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
      lastStaleWakeupAt: "2026-05-14T12:00:00.000Z",
      lastStaleSource: "orchestration_continuation_reconciler",
      lastStaleReason: "stale_reconciler",
    });
  });

  it("migrates legacy stale wakeup metadata before recording a later non-stale wakeup", async () => {
    byProject.set("project-1", {
      project_id: "project-1",
      goals: "Ship EPIC-091",
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: null,
      metadata: {
        lastWakeup: {
          lastWakeupAt: "2026-05-14T12:00:00.000Z",
          source: "orchestration_continuation_reconciler",
          reason: "stale_reconciler",
        },
      },
      created_at: new Date(),
      updated_at: new Date(),
    });

    const dateNow = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-05-14T12:01:01.000Z").getTime());
    await service.recordWakeup("project-1", {
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });
    dateNow.mockRestore();

    await expect(service.getWakeupCooldownState("project-1")).resolves.toEqual({
      lastWakeupAt: "2026-05-14T12:01:01.000Z",
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
      lastStaleWakeupAt: "2026-05-14T12:00:00.000Z",
      lastStaleSource: "orchestration_continuation_reconciler",
      lastStaleReason: "stale_reconciler",
    });
  });

  it("migrates legacy stale wakeup metadata when existing stale wakeup metadata is partial", async () => {
    byProject.set("project-1", {
      project_id: "project-1",
      goals: "Ship EPIC-091",
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: null,
      metadata: {
        lastWakeup: {
          lastWakeupAt: "2026-05-14T12:00:00.000Z",
          source: "orchestration_continuation_reconciler",
          reason: "stale_reconciler",
        },
        lastStaleWakeup: {
          source: "orchestration_continuation_reconciler",
        },
      },
      created_at: new Date(),
      updated_at: new Date(),
    });

    const dateNow = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-05-14T12:01:01.000Z").getTime());
    await service.recordWakeup("project-1", {
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });
    dateNow.mockRestore();

    await expect(service.getWakeupCooldownState("project-1")).resolves.toEqual({
      lastWakeupAt: "2026-05-14T12:01:01.000Z",
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
      lastStaleWakeupAt: "2026-05-14T12:00:00.000Z",
      lastStaleSource: "orchestration_continuation_reconciler",
      lastStaleReason: "stale_reconciler",
    });
  });

  it("includes orchestrationId in startup workflow run input for context propagation", async () => {
    await service.start("project-orch-context", {
      goals: "Verify orchestration context propagation",
      workflowId: "project-orchestration-flow",
    });

    expect(capturedRequests.length).toBe(1);
    const request = capturedRequests[0];

    // The startup run request input should include orchestrationId for context propagation
    expect(request.input).toBeDefined();
    expect(typeof request.input).toBe("object");
    const input = request.input;

    // orchestrationId should be present as a stable identifier
    expect(input.orchestrationId).toBeDefined();
    expect(typeof input.orchestrationId).toBe("string");
    expect(input.orchestrationId).toBeTruthy();
  });

  it("exposes persisted probe results on orchestration state", async () => {
    byProject.set("project-with-probes", {
      project_id: "project-with-probes",
      goals: "Investigate imported repository",
      mode: "supervised",
      status: "orchestrating",
      linked_run_id: null,
      decision_log: [],
      action_requests: [],
      metadata: {
        probe_results: {
          "web-ui": {
            outcome: "success",
            result: { inferred_status: "implemented" },
          },
        },
      },
      created_at: new Date("2026-05-07T17:00:00.000Z"),
      updated_at: new Date("2026-05-07T18:00:00.000Z"),
    });

    const state = await service.get("project-with-probes");

    expect(state.probe_results).toEqual({
      "web-ui": {
        outcome: "success",
        result: { inferred_status: "implemented" },
      },
    });
  });

  it("includes factual startup context in workflow run input and persists it in metadata", async () => {
    await service.start("project-routing", {
      goals: "Test routing context",
      workflowId: "project-orchestration-flow",
      sourceContext: { sourceType: "github", sourceId: "repo-1" },
      readinessContext: { isReady: true, readinessReason: "complete" },
      startupHints: { preferredRouteId: "bootstrap" },
    });

    expect(capturedRequests.length).toBe(1);
    const request = capturedRequests[0];
    expect(request.input.sourceContext).toEqual({
      sourceType: "github",
      sourceId: "repo-1",
    });
    expect(request.input.readinessContext).toEqual({
      isReady: true,
      readinessReason: "complete",
    });
    expect(request.input.startupHints).toEqual({
      preferredRouteId: "bootstrap",
    });

    const persisted = byProject.get("project-routing");
    expect(persisted?.metadata).toEqual({
      sourceContext: { sourceType: "github", sourceId: "repo-1" },
      readinessContext: { isReady: true, readinessReason: "complete" },
      startupHints: { preferredRouteId: "bootstrap" },
    });
    expect(persisted?.metadata).not.toHaveProperty("selectedRoute");
    expect(persisted?.metadata).not.toHaveProperty("selectedRuleId");
  });

  describe("findOrchestratingStates", () => {
    it("returns all states in orchestrating status", async () => {
      await orchestrationRepository.save({
        project_id: "project-orchestrating",
        goals: "Continue autonomous work",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: "run-1",
        decision_log: [],
        action_requests: [],
      });
      await orchestrationRepository.save({
        project_id: "project-paused",
        goals: "Wait for resume",
        mode: "autonomous",
        status: "paused",
        linked_run_id: null,
        decision_log: [],
        action_requests: [],
      });

      const states = await service.findOrchestratingStates();

      expect(orchestrationRepository.findByStatus).toHaveBeenCalledWith(
        "orchestrating",
      );
      expect(states).toHaveLength(1);
      expect(states.at(0)?.project_id).toBe("project-orchestrating");
      expect(states.at(0)?.linked_run_id).toBe("run-1");
    });

    it("returns empty array when no orchestrating states exist", async () => {
      await orchestrationRepository.save({
        project_id: "project-completed",
        goals: "Nothing pending",
        mode: "autonomous",
        status: "completed",
        linked_run_id: null,
        decision_log: [],
        action_requests: [],
      });

      const states = await service.findOrchestratingStates();

      expect(states).toEqual([]);
    });

    it("excludes orchestrating states whose latest cycle decision is blocked", async () => {
      await orchestrationRepository.save({
        project_id: "project-blocked",
        goals: "Blocked project",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: null,
        decision_log: [],
        action_requests: [],
        metadata: {
          cycle_decision: "blocked",
          cycle_decision_recorded_at: new Date().toISOString(),
        },
      });

      const states = await service.findOrchestratingStates();

      expect(states.map((state) => state.project_id)).not.toContain(
        "project-blocked",
      );
    });

    it("includes orchestrating states whose latest cycle decision is repeat", async () => {
      await orchestrationRepository.save({
        project_id: "project-repeat",
        goals: "Repeat project",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: null,
        decision_log: [],
        action_requests: [],
        metadata: {
          cycle_decision: "repeat",
          cycle_decision_recorded_at: new Date().toISOString(),
        },
      });

      const states = await service.findOrchestratingStates();

      expect(states.map((state) => state.project_id)).toContain(
        "project-repeat",
      );
    });

    it("exposes all orchestrating states for continuation cleanup, including blocked decisions", async () => {
      await orchestrationRepository.save({
        project_id: "project-blocked-cleanup",
        goals: "Blocked project still needs linked-run cleanup",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: null,
        decision_log: [],
        action_requests: [],
        metadata: {
          cycle_decision: "blocked",
          cycle_decision_recorded_at: new Date().toISOString(),
        },
      });
      await orchestrationRepository.save({
        project_id: "project-repeat-cleanup",
        goals: "Repeat project",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: null,
        decision_log: [],
        action_requests: [],
        metadata: {
          cycle_decision: "repeat",
          cycle_decision_recorded_at: new Date().toISOString(),
        },
      });

      const cleanupStates =
        await service.findOrchestratingStatesForContinuationCleanup();

      expect(cleanupStates.map((state) => state.project_id)).toEqual([
        "project-blocked-cleanup",
        "project-repeat-cleanup",
      ]);
      await expect(service.findOrchestratingStates()).resolves.toEqual([
        expect.objectContaining({ project_id: "project-repeat-cleanup" }),
      ]);
    });

    it("finds orchestration state by linked workflow run", async () => {
      await orchestrationRepository.save({
        project_id: "project-1",
        goals: "Link a workflow run",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: "run-1",
        metadata: {},
      });

      const result = await service.findByLinkedWorkflowRun("run-1");

      expect(result?.project_id).toBe("project-1");
    });

    it("returns null when no orchestration is linked to the workflow run", async () => {
      const result = await service.findByLinkedWorkflowRun("missing-run");

      expect(result).toBeNull();
    });
  });

  describe("reconcileLinkedWorkflowRun", () => {
    it("clears linked_run_id when the linked workflow reaches a terminal status", async () => {
      await orchestrationRepository.save({
        project_id: "project-1",
        goals: "Resolve linked workflow terminal state",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: "run-1",
        metadata: { existing_metadata_field: "preserved" },
      });

      const result = await service.reconcileLinkedWorkflowRun("project-1", {
        workflowRunId: "run-1",
        status: "COMPLETED",
      });

      expect(result).toEqual({ cleared: true });

      const state = await orchestrationRepository.findByproject_id("project-1");
      expect(state?.linked_run_id).toBeNull();
      expect(state?.status).toBe("orchestrating");
      expect(state?.metadata).toMatchObject({
        existing_metadata_field: "preserved",
        last_terminal_run_id: "run-1",
        last_terminal_run_status: "COMPLETED",
      });
      expect(typeof state?.metadata?.last_terminal_run_recorded_at).toBe(
        "string",
      );
    });

    it("does not clear linked_run_id for non-matching terminal runs", async () => {
      await orchestrationRepository.save({
        project_id: "project-1",
        goals: "Ignore non-matching linked workflow event",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: "run-1",
        metadata: {},
      });

      const result = await service.reconcileLinkedWorkflowRun("project-1", {
        workflowRunId: "run-2",
        status: "COMPLETED",
      });

      expect(result).toEqual({ cleared: false });

      const state = await orchestrationRepository.findByproject_id("project-1");
      expect(state?.linked_run_id).toBe("run-1");
    });

    it("does not clear a newly linked workflow when a stale terminal event races with relinking", async () => {
      await orchestrationRepository.save({
        project_id: "project-1",
        goals: "Ignore stale linked workflow event after relink",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: "run-1",
        metadata: {},
      });

      orchestrationRepository.clearLinkedRunIfMatches.mockImplementationOnce(
        (
          project_id: string,
          linked_run_id: string,
          metadataPatch: Record<string, unknown>,
        ) => {
          const existing = byProject.get(project_id);
          if (existing) {
            byProject.set(project_id, {
              ...existing,
              linked_run_id: "run-2",
              updated_at: new Date(),
            });
          }

          const current = byProject.get(project_id);
          if (!current || current.linked_run_id !== linked_run_id) {
            return Promise.resolve(false);
          }

          byProject.set(project_id, {
            ...current,
            linked_run_id: null,
            metadata: {
              ...(current.metadata ?? {}),
              ...metadataPatch,
            },
            updated_at: new Date(),
          });
          return Promise.resolve(true);
        },
      );

      const result = await service.reconcileLinkedWorkflowRun("project-1", {
        workflowRunId: "run-1",
        status: "COMPLETED",
      });

      expect(result).toEqual({ cleared: false });

      const state = await orchestrationRepository.findByproject_id("project-1");
      expect(state?.linked_run_id).toBe("run-2");
      expect(state?.metadata).toEqual({});
    });

    it("preserves concurrent metadata changes while clearing a matching linked workflow", async () => {
      await orchestrationRepository.save({
        project_id: "project-1",
        goals: "Preserve concurrent metadata while clearing linked run",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: "run-1",
        metadata: { existing_metadata_field: "preserved" },
      });

      orchestrationRepository.clearLinkedRunIfMatches.mockImplementationOnce(
        (
          project_id: string,
          linked_run_id: string,
          metadataPatch: Record<string, unknown>,
        ) => {
          const existing = byProject.get(project_id);
          if (existing) {
            byProject.set(project_id, {
              ...existing,
              metadata: {
                ...(existing.metadata ?? {}),
                concurrent_metadata_field: "still-present",
              },
              updated_at: new Date(),
            });
          }

          const current = byProject.get(project_id);
          if (!current || current.linked_run_id !== linked_run_id) {
            return Promise.resolve(false);
          }

          byProject.set(project_id, {
            ...current,
            linked_run_id: null,
            metadata: {
              ...(current.metadata ?? {}),
              ...metadataPatch,
            },
            updated_at: new Date(),
          });
          return Promise.resolve(true);
        },
      );

      const result = await service.reconcileLinkedWorkflowRun("project-1", {
        workflowRunId: "run-1",
        status: "COMPLETED",
      });

      expect(result).toEqual({ cleared: true });

      const state = await orchestrationRepository.findByproject_id("project-1");
      expect(state?.linked_run_id).toBeNull();
      expect(state?.metadata).toMatchObject({
        existing_metadata_field: "preserved",
        concurrent_metadata_field: "still-present",
        last_terminal_run_id: "run-1",
        last_terminal_run_status: "COMPLETED",
      });
    });
  });

  it("includes project basePath and repositoryUrl in workflow run input for imported projects", async () => {
    projectService.get.mockResolvedValue({
      id: "project-1",
      basePath: "/data/repos/project-1",
      repositoryUrl: "https://github.com/example/project-1",
      sourceType: "import_remote",
    });

    await service.start("project-1", {
      goals: "Ship EPIC-091",
      workflowId: "project-orchestration-flow",
      requestedBy: "orchestrator-user",
    });

    expect(capturedRequests.length).toBe(1);
    const request = capturedRequests[0];
    expect(request.input.basePath).toBe("/data/repos/project-1");
    expect(request.input.repositoryUrl).toBe(
      "https://github.com/example/project-1",
    );
    expect(request.input.scopeId).toBe("project-1");
    expect(request.input.goals).toBe("Ship EPIC-091");
  });

  it("includes mode-derived human decision policy in workflow run input", async () => {
    mockHumanDecisionPolicyService.selectPolicy.mockReturnValueOnce(
      "decide_without_approval",
    );

    await service.start("project-1", {
      goals: "Ship EPIC-091",
      workflowId: "project-orchestration-flow",
      requestedBy: "orchestrator-user",
      orchestrationMode: "autonomous",
    });

    expect(capturedRequests.length).toBe(1);
    const request = capturedRequests[0];
    expect(mockHumanDecisionPolicyService.selectPolicy).toHaveBeenCalledWith({
      orchestrationMode: "autonomous",
    });
    expect(request.input.orchestrationMode).toBe("autonomous");
    expect(request.input.humanDecisionPolicy).toBe("decide_without_approval");
  });

  describe("startup context contract guard", () => {
    it("preserves full project discovery start input shape in trigger payload", async () => {
      mockHumanDecisionPolicyService.selectPolicy.mockReturnValueOnce(
        "decide_without_approval",
      );

      projectService.get.mockResolvedValue({
        id: "project-discovery-full",
        basePath: "/data/repos/project-discovery-full",
        repositoryUrl: "https://github.com/example/project-discovery-full",
        sourceType: "import_remote",
      });

      await service.start("project-discovery-full", {
        goals: "Discover and spec web-ui",
        workflowId: "project-orchestration-flow",
        requestedBy: "ceo-agent",
        orchestrationMode: "autonomous",
        sourceContext: {
          sourceType: "github",
          sourceId: "github-repo-123",
          metadata: { cloneUrl: "https://github.com/example/repo" },
        },
        readinessContext: {
          isReady: true,
          readinessReason: "specs_complete",
          metadata: { lastCheckedAt: "2026-05-11T00:00:00.000Z" },
        },
        startupHints: {
          preferredRouteId: "imported_repo_synthesis",
          metadata: { priority: "high" },
        },
      });

      expect(capturedRequests.length).toBe(1);
      const request = capturedRequests[0];

      expect(Object.keys(request.input).sort()).toEqual([
        "basePath",
        "goals",
        "humanDecisionPolicy",
        "orchestrationId",
        "orchestrationMode",
        "projectId",
        "readinessContext",
        "repositoryUrl",
        "scopeId",
        "sourceContext",
        "startupHints",
      ]);

      // scopeId / project id
      expect(request.input.scopeId).toBe("project-discovery-full");
      expect(request.input.projectId).toBe("project-discovery-full");

      // goals
      expect(request.input.goals).toBe("Discover and spec web-ui");

      // selected orchestration mode
      expect(request.input.orchestrationMode).toBe("autonomous");

      // derived human decision policy
      expect(request.input.humanDecisionPolicy).toBe("decide_without_approval");

      expect(request.input).not.toHaveProperty("selectedRoute");
      expect(request.input).not.toHaveProperty("selectedRuleId");
      expect(request.input).not.toHaveProperty("kickoffContext");

      // source context
      expect(request.input.sourceContext).toEqual({
        sourceType: "github",
        sourceId: "github-repo-123",
        metadata: { cloneUrl: "https://github.com/example/repo" },
      });

      // readiness context
      expect(request.input.readinessContext).toEqual({
        isReady: true,
        readinessReason: "specs_complete",
        metadata: { lastCheckedAt: "2026-05-11T00:00:00.000Z" },
      });

      // startup hints
      expect(request.input.startupHints).toEqual({
        preferredRouteId: "imported_repo_synthesis",
        metadata: { priority: "high" },
      });

      // base path / repository URL when present on project
      expect(request.input.basePath).toBe("/data/repos/project-discovery-full");
      expect(request.input.repositoryUrl).toBe(
        "https://github.com/example/project-discovery-full",
      );

      // startup always enters the orchestration cycle workflow.
      expect(request.workflow_id).toBe("project_orchestration_cycle_ceo");

      // launch source
      expect(request.launch_source).toBe("kanban_orchestration");

      // correlation and causation identifiers in metadata
      expect(request.metadata.correlation_id).toBe("corr-kanban-orchestration");
      expect(request.metadata.causation_id).toBe("cause-kanban-orchestration");

      // persisted metadata keeps factual startup context only.
      const persisted = byProject.get("project-discovery-full");
      expect(persisted?.metadata).toMatchObject({
        sourceContext: {
          sourceType: "github",
          sourceId: "github-repo-123",
          metadata: { cloneUrl: "https://github.com/example/repo" },
        },
        readinessContext: {
          isReady: true,
          readinessReason: "specs_complete",
          metadata: { lastCheckedAt: "2026-05-11T00:00:00.000Z" },
        },
        startupHints: {
          preferredRouteId: "imported_repo_synthesis",
          metadata: { priority: "high" },
        },
      });
      expect(persisted?.metadata).not.toHaveProperty("selectedRoute");
      expect(persisted?.metadata).not.toHaveProperty("selectedRuleId");
      expect(persisted?.metadata).not.toHaveProperty("kickoffContext");
    });

    it("preserves default supervised mode and derived policy when mode is omitted", async () => {
      mockHumanDecisionPolicyService.selectPolicy.mockReturnValueOnce(
        "ask_when_uncertain",
      );

      await service.start("project-discovery-default-mode", {
        goals: "Default mode test",
        workflowId: "project-orchestration-flow",
      });

      expect(capturedRequests.length).toBe(1);
      const request = capturedRequests[0];

      expect(request.input.orchestrationMode).toBe("supervised");
      expect(request.input.humanDecisionPolicy).toBe("ask_when_uncertain");

      const persisted = byProject.get("project-discovery-default-mode");
      expect(persisted?.metadata).not.toHaveProperty("selectedRoute");
      expect(persisted?.metadata).not.toHaveProperty("selectedRuleId");
    });

    it("includes basePath and repositoryUrl only when project has them", async () => {
      await service.start("project-no-path", {
        goals: "No path project",
        workflowId: "project-orchestration-flow",
      });

      expect(capturedRequests.length).toBe(1);
      const request = capturedRequests[0];
      expect(request.input.basePath).toBeUndefined();
      expect(request.input.repositoryUrl).toBeUndefined();
    });
  });

  it("includes project basePath and repositoryUrl in workflow run input for imported projects", async () => {
    await service.start("project-existing", {
      goals: "Initial goal",
      workflowId: "project-orchestration-flow",
      requestedBy: "orchestrator-user",
    });

    orchestrationRepository.save.mockImplementationOnce((input) => {
      const existing = byProject.get(input.project_id);
      const updatedAt = new Date("2026-04-13T01:00:00.000Z");
      byProject.set(input.project_id, {
        ...existing,
        ...input,
        created_at: existing?.created_at ?? updatedAt,
        updated_at: updatedAt,
      });

      return {
        ...input,
        updated_at: updatedAt,
      } as never;
    });

    await expect(
      service.start("project-existing", {
        goals: "Updated goal",
        workflowId: "project-orchestration-flow",
        requestedBy: "orchestrator-user",
      }),
    ).resolves.toMatchObject({
      project_id: "project-existing",
      goals: "Updated goal",
      currentWorkflowRunId: "run-orch-1",
      updated_at: "2026-04-13T01:00:00.000Z",
    });

    expect(capturedRequests.at(-1)?.workflow_id).toBe(
      "project_orchestration_cycle_ceo",
    );
    expect(capturedRequests.at(-1)?.input).not.toHaveProperty("selectedRoute");
    expect(capturedRequests.at(-1)?.input).not.toHaveProperty("selectedRuleId");
  });

  it("updates orchestration status transitions in memory", async () => {
    await service.start("project-2", {
      goals: "Initial goal",
      workflowId: "project-orchestration-flow",
      requestedBy: "orchestrator-user",
    });

    const paused = await service.pause("project-2");
    const resumed = await service.resume("project-2");
    const completed = await service.complete("project-2");

    expect(paused.status).toBe("paused");
    expect(resumed.status).toBe("orchestrating");
    expect(completed.status).toBe("completed");
  });

  it("records diagnostics and decision log entries in kanban state", async () => {
    await service.start("project-3", {
      goals: "Ship diagnostics",
      workflowId: "project-orchestration-flow",
    });

    await service.recordDecision("project-3", {
      type: "dispatch_selection",
      reasoning: "Two ready items selected",
      actions: ["dispatch_start_work_items"],
      executionStatus: "executed",
    });

    const diagnostics = await service.getDiagnostics("project-3");

    expect({ ...diagnostics, lastDecision: undefined }).toEqual({
      project_id: "project-3",
      blocked: false,
      reasons: [],
      currentBlockedReason: null,
      decisionCount: 1,
      decisionHistory: [
        expect.objectContaining({
          type: "dispatch_selection",
          reasoning: "Two ready items selected",
          executionStatus: "executed",
        }),
      ],
      pendingActionRequestCount: 0,
      dispatch_capacity: {
        maxActive: 1,
        activeCount: 0,
        availableSlots: 1,
        projectAvailableSlots: 1,
        agentCapacityEnabled: false,
        configuredAgentCount: 0,
        idleAgentCount: 0,
        agentAvailableSlots: 0,
      },
      lastDecision: undefined,
    });
    expect(diagnostics.lastDecision?.type).toBe("dispatch_selection");
    expect(diagnostics.lastDecision?.reasoning).toBe(
      "Two ready items selected",
    );
  });

  it("includes dispatch capacity diagnostics from Kanban settings and work items", async () => {
    await service.start("project-capacity-diagnostics", {
      goals: "Ship diagnostics",
      workflowId: "project-orchestration-flow",
    });
    kanbanSettings.getNumber.mockResolvedValueOnce(1);
    workItems.findByproject_id.mockResolvedValueOnce([
      {
        id: "active",
        status: "in-progress",
        linked_run_id: "run-active",
        current_execution_id: "run-active",
      } as never,
      {
        id: "todo",
        status: "todo",
        linked_run_id: null,
        current_execution_id: null,
      } as never,
    ]);

    const diagnostics = await service.getDiagnostics(
      "project-capacity-diagnostics",
    );

    expect(diagnostics.dispatch_capacity).toEqual({
      maxActive: 1,
      activeCount: 1,
      availableSlots: 0,
      projectAvailableSlots: 0,
      agentCapacityEnabled: false,
      configuredAgentCount: 0,
      idleAgentCount: 0,
      agentAvailableSlots: 0,
    });
  });

  it("includes target_branch_blocked diagnostics when todo work shares an active branch owner", async () => {
    await service.start("project-branch-diagnostics", {
      goals: "Ship diagnostics",
      workflowId: "project-orchestration-flow",
    });
    workItems.findByproject_id.mockResolvedValueOnce([
      {
        id: "standing-order",
        title: "Standing Order",
        status: "in-review",
        execution_config: { targetBranch: "feature/automation-improvements" },
      } as never,
      {
        id: "heartbeat",
        title: "Heartbeat Polling",
        status: "todo",
        execution_config: { targetBranch: "feature/automation-improvements" },
      } as never,
    ]);

    const result = await service.getDiagnostics("project-branch-diagnostics");

    expect(result.reasons).toContainEqual(
      expect.objectContaining({
        code: "target_branch_blocked",
        message: expect.stringContaining("feature/automation-improvements"),
      }),
    );
  });

  it("summarizes recent observed orchestration activity without recommendations", async () => {
    await service.start("project-activity", {
      goals: "Summarize activity",
      workflowId: "project-orchestration-flow",
    });
    const persisted = byProject.get("project-activity");
    expect(persisted).toBeDefined();
    if (!persisted) {
      throw new Error("missing persisted orchestration fixture");
    }
    persisted.decision_log = [
      {
        timestamp: "2026-05-11T00:00:00.000Z",
        type: "cycle_decision",
        reasoning: "Paused for human input",
        actions: ["pause"],
        executionStatus: "queued_for_approval",
      },
      {
        timestamp: "2026-05-13T00:00:00.000Z",
        type: "dispatch_selection",
        reasoning: "Dispatch work item",
        recommendation: "Do not expose this recommendation",
        actions: ["dispatch_start_work_items"],
        executionStatus: "executed",
      },
    ];
    persisted.action_requests = [
      {
        id: "request-1",
        project_id: "project-activity",
        action: "invoke_agent_workflow",
        payload: null,
        workflowRunId: null,
        modeAtRequest: "supervised",
        requestedBy: null,
        status: "pending",
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        executedAt: null,
        errorMessage: null,
        correlationId: "corr-1",
        created_at: "2026-05-12T00:00:00.000Z",
        updated_at: "2026-05-12T00:00:00.000Z",
      },
      {
        id: "request-2",
        project_id: "project-activity",
        action: "dispatch_start_work_items",
        payload: null,
        workflowRunId: null,
        modeAtRequest: "supervised",
        requestedBy: null,
        status: "executed",
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        executedAt: null,
        errorMessage: null,
        correlationId: "corr-2",
        created_at: "2026-05-10T00:00:00.000Z",
        updated_at: "2026-05-10T00:00:00.000Z",
      },
    ];

    const summary = await service.getActivitySummary("project-activity", {
      limit: 3,
    });

    expect(summary).toEqual({
      totalActionCount: 4,
      recent: [
        {
          kind: "decision",
          timestamp: "2026-05-13T00:00:00.000Z",
          summary: "Dispatch work item",
          status: "executed",
        },
        {
          kind: "action_request",
          timestamp: "2026-05-12T00:00:00.000Z",
          summary: "invoke_agent_workflow",
          status: "pending",
        },
        {
          kind: "decision",
          timestamp: "2026-05-11T00:00:00.000Z",
          summary: "Paused for human input",
          status: "queued_for_approval",
        },
      ],
    });
    expect(summary).not.toHaveProperty("readyForDispatch");
    expect(summary).not.toHaveProperty("recommendedWorkflowId");
    expect(summary).not.toHaveProperty("selectedRoute");
    expect(summary).not.toHaveProperty("selectedRuleId");
  });

  it("queues, rejects, and refuses approval of rejected action requests", async () => {
    await service.start("project-4", {
      goals: "Require approval",
      workflowId: "project-orchestration-flow",
    });

    const request = await service.requestAction("project-4", {
      action: "invoke_agent_workflow",
      payload: { workflowId: "dangerous-flow" },
      requestedBy: "ceo-agent",
    });
    const rejected = await service.rejectActionRequest(
      "project-4",
      request.id,
      {
        rejectedBy: "human-reviewer",
        reason: "Not enough context",
      },
    );

    await expect(
      service.approveActionRequest("project-4", request.id, {
        approvedBy: "human-reviewer",
      }),
    ).rejects.toThrow("Cannot approve action request");
    expect(rejected).toEqual(
      expect.objectContaining({
        id: request.id,
        status: "rejected",
        rejectedBy: "human-reviewer",
        rejectionReason: "Not enough context",
      }),
    );
    expect(capturedRequests).toHaveLength(1);
  });

  it("lists pending project action requests", async () => {
    await service.start("project-5", {
      goals: "Require approval",
      workflowId: "project-orchestration-flow",
    });
    const pending = await service.requestAction("project-5", {
      action: "invoke_agent_workflow",
    });
    const rejected = await service.requestAction("project-5", {
      action: "dispatch_start_work_items",
    });
    await service.rejectActionRequest("project-5", rejected.id, {
      rejectedBy: "human-reviewer",
    });

    await expect(
      service.listProjectActionRequests("project-5", "pending"),
    ).resolves.toEqual([pending]);
  });

  it("lists action requests across projects by status", async () => {
    await service.start("project-6", {
      goals: "Require approval",
      workflowId: "project-orchestration-flow",
    });
    await service.start("project-7", {
      goals: "Require another approval",
      workflowId: "project-orchestration-flow",
    });
    const pending = await service.requestAction("project-6", {
      action: "invoke_agent_workflow",
    });
    const rejected = await service.requestAction("project-7", {
      action: "dispatch_start_work_items",
    });
    await service.rejectActionRequest("project-7", rejected.id, {
      rejectedBy: "human-reviewer",
    });

    await expect(service.listActionRequests("pending")).resolves.toEqual([
      expect.objectContaining({ id: pending.id, projectName: null }),
    ]);
    await expect(service.listActionRequests("fulfilled")).resolves.toEqual([
      expect.objectContaining({ id: rejected.id, status: "rejected" }),
    ]);
  });

  it("surfaces blocked import hydration in diagnostics", async () => {
    await service.start("project-blocked-hydration-diag", {
      goals: "Import with blocked hydration",
      workflowId: "project-orchestration-flow",
    });

    await service.recordDecision("project-blocked-hydration-diag", {
      type: "cycle_decision",
      reasoning: "Hydration output blocked cycle continuation",
      actions: ["blocked"],
      cycleDecision: "blocked",
      executionStatus: "failed",
    });

    const existing = requireProjectState("project-blocked-hydration-diag");
    byProject.set("project-blocked-hydration-diag", {
      ...existing,
      metadata: {
        ...(existing.metadata as Record<string, unknown>),
        blocked_stage: "imported_repo_hydration",
        blocked_reason: "invalid_probe_results",
        ready_for_cycle: false,
      },
    });

    const diagnostics = await service.getDiagnostics(
      "project-blocked-hydration-diag",
    );

    expect(diagnostics.blocked).toBe(true);
    expect(diagnostics.currentBlockedReason).toEqual(
      expect.objectContaining({
        code: "import_hydration_blocked",
        message: expect.stringContaining("invalid_probe_results"),
      }),
    );
    expect(diagnostics.decisionHistory).toEqual([
      expect.objectContaining({
        type: "cycle_decision",
        reasoning: "Hydration output blocked cycle continuation",
        cycleDecision: "blocked",
      }),
    ]);
    expect(diagnostics.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "import_hydration_blocked",
          message: expect.stringContaining("invalid_probe_results"),
        }),
      ]),
    );
  });

  it("preserves blocked import hydration context when restarting through the cycle workflow", async () => {
    await service.start("project-blocked-hydration-route", {
      goals: "Import with blocked hydration",
      workflowId: "project-orchestration-flow",
      sourceContext: {
        sourceType: "github",
        sourceId: "repo-blocked-hydration",
      },
    });

    const existing = requireProjectState("project-blocked-hydration-route");
    byProject.set("project-blocked-hydration-route", {
      ...existing,
      metadata: {
        ...(existing.metadata as Record<string, unknown>),
        blocked_stage: "imported_repo_hydration",
        blocked_reason: "invalid_probe_results",
        ready_for_cycle: false,
      },
    });

    await service.start("project-blocked-hydration-route", {
      goals: "Recover blocked hydration",
      workflowId: "project-orchestration-flow",
    });

    expect(capturedRequests.at(-1)?.workflow_id).toBe(
      "project_orchestration_cycle_ceo",
    );
    expect(capturedRequests.at(-1)?.input).not.toHaveProperty("selectedRoute");
    expect(capturedRequests.at(-1)?.input).not.toHaveProperty("selectedRuleId");
    expect(byProject.get("project-blocked-hydration-route")?.metadata).toEqual(
      expect.objectContaining({
        blocked_stage: "imported_repo_hydration",
        blocked_reason: "invalid_probe_results",
        ready_for_cycle: false,
      }),
    );
  });

  describe("recordImportHydrationBlocked", () => {
    it("records blocked metadata and makes getDiagnostics report blocked with reason", async () => {
      await service.start("project-record-blocked", {
        goals: "Record blocked import hydration",
        workflowId: "project-orchestration-flow",
      });

      await service.recordImportHydrationBlocked("project-record-blocked", {
        blocked_stage: "imported_repo_hydration",
        blocked_reason: "invalid_probe_results",
        ready_for_cycle: false,
        hydration_summary: {
          ok: false,
          status: "blocked",
          reason: "invalid_probe_results",
        },
        child_run_id: "child-run-42",
      });

      const diagnostics = await service.getDiagnostics(
        "project-record-blocked",
      );

      expect(diagnostics.blocked).toBe(true);
      expect(diagnostics.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "import_hydration_blocked",
            message: expect.stringContaining("invalid_probe_results"),
          }),
        ]),
      );

      const persisted = requireProjectState("project-record-blocked");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.blocked_stage).toBe("imported_repo_hydration");
      expect(metadata.blocked_reason).toBe("invalid_probe_results");
      expect(metadata.ready_for_cycle).toBe(false);
      expect(metadata.hydration_summary).toEqual({
        ok: false,
        status: "blocked",
        reason: "invalid_probe_results",
      });
      expect(metadata.child_run_id).toBe("child-run-42");
    });

    it("preserves existing metadata when recording blocked state", async () => {
      await service.start("project-record-blocked-preserve", {
        goals: "Preserve metadata",
        workflowId: "project-orchestration-flow",
        sourceContext: { sourceType: "github", sourceId: "repo-1" },
      });

      await service.recordImportHydrationBlocked(
        "project-record-blocked-preserve",
        {
          blocked_stage: "imported_repo_hydration",
          blocked_reason: "unknown",
          ready_for_cycle: false,
        },
      );

      const persisted = requireProjectState("project-record-blocked-preserve");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.sourceContext).toEqual({
        sourceType: "github",
        sourceId: "repo-1",
      });
      expect(metadata.blocked_stage).toBe("imported_repo_hydration");
    });

    it("does not change workflow run status", async () => {
      await service.start("project-record-blocked-status", {
        goals: "Keep status",
        workflowId: "project-orchestration-flow",
      });

      await service.recordImportHydrationBlocked(
        "project-record-blocked-status",
        {
          blocked_stage: "imported_repo_hydration",
          blocked_reason: "unknown",
          ready_for_cycle: false,
        },
      );

      const persisted = requireProjectState("project-record-blocked-status");
      expect(persisted.status).toBe("orchestrating");
    });

    it("uses hydration summary reason when blocked_reason is blank or unknown", async () => {
      await service.start("project-hydration-reason-fallback", {
        goals: "Use hydration summary reason",
        workflowId: "project-orchestration-flow",
      });

      await service.recordImportHydrationBlocked(
        "project-hydration-reason-fallback",
        {
          blocked_stage: "imported_repo_hydration",
          blocked_reason: "",
          ready_for_cycle: false,
          hydration_summary: {
            ok: false,
            status: "blocked",
            reason: "26 probe artifacts require human decisions",
          },
          child_run_id: "child-1",
        },
      );

      const persisted = requireProjectState(
        "project-hydration-reason-fallback",
      );
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.blocked_reason).toBe(
        "26 probe artifacts require human decisions",
      );
    });

    it("normalizes unknown and blank blocked_reason values as missing", async () => {
      await service.start("project-normalize-unknown", {
        goals: "Normalize unknown",
        workflowId: "project-orchestration-flow",
      });

      await service.recordImportHydrationBlocked("project-normalize-unknown", {
        blocked_stage: "imported_repo_hydration",
        blocked_reason: "  Unknown  ",
        ready_for_cycle: false,
        hydration_summary: {
          ok: false,
          status: "blocked",
          reason: "missing probe artifacts",
        },
      });

      const persisted = requireProjectState("project-normalize-unknown");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.blocked_reason).toBe("missing probe artifacts");
    });

    it("falls back to stage message when both blocked_reason and hydration_summary reason are missing", async () => {
      await service.start("project-stage-fallback", {
        goals: "Stage fallback",
        workflowId: "project-orchestration-flow",
      });

      await service.recordImportHydrationBlocked("project-stage-fallback", {
        blocked_stage: "imported_repo_hydration",
        blocked_reason: "",
        ready_for_cycle: false,
      });

      const persisted = requireProjectState("project-stage-fallback");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.blocked_reason).toBe(
        "imported_repo_hydration blocked orchestration continuation",
      );
    });
  });

  describe("clearImportHydrationBlocked", () => {
    it("clears blocked diagnostic after successful hydration", async () => {
      await service.start("project-clear-blocked", {
        goals: "Clear blocked after success",
        workflowId: "project-orchestration-flow",
      });

      await service.recordImportHydrationBlocked("project-clear-blocked", {
        blocked_stage: "imported_repo_hydration",
        blocked_reason: "invalid_probe_results",
        ready_for_cycle: false,
      });

      let diagnostics = await service.getDiagnostics("project-clear-blocked");
      expect(diagnostics.blocked).toBe(true);
      expect(diagnostics.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "import_hydration_blocked" }),
        ]),
      );

      await service.clearImportHydrationBlocked("project-clear-blocked", {
        cleared_stage: "imported_repo_hydration",
        ready_for_cycle: true,
      });

      diagnostics = await service.getDiagnostics("project-clear-blocked");
      expect(diagnostics.blocked).toBe(false);
      expect(diagnostics.reasons).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "import_hydration_blocked" }),
        ]),
      );
    });

    it("continues through the cycle workflow after clearing blocked state", async () => {
      await service.start("project-clear-route", {
        goals: "Clear blocked routing",
        workflowId: "project-orchestration-flow",
        sourceContext: {
          sourceType: "github",
          sourceId: "repo-clear-route",
        },
      });

      await service.recordImportHydrationBlocked("project-clear-route", {
        blocked_stage: "imported_repo_hydration",
        blocked_reason: "unknown",
        ready_for_cycle: false,
      });

      await service.clearImportHydrationBlocked("project-clear-route", {
        cleared_stage: "imported_repo_hydration",
        ready_for_cycle: true,
      });

      await service.start("project-clear-route", {
        goals: "Recover cleared hydration",
        workflowId: "project-orchestration-flow",
      });

      expect(capturedRequests.at(-1)?.workflow_id).toBe(
        "project_orchestration_cycle_ceo",
      );
      expect(capturedRequests.at(-1)?.input).not.toHaveProperty(
        "selectedRoute",
      );
      expect(capturedRequests.at(-1)?.input).not.toHaveProperty(
        "selectedRuleId",
      );
    });

    it("preserves existing metadata when clearing blocked state", async () => {
      await service.start("project-clear-preserve", {
        goals: "Clear and preserve",
        workflowId: "project-orchestration-flow",
        sourceContext: { sourceType: "github", sourceId: "repo-1" },
      });

      await service.recordImportHydrationBlocked("project-clear-preserve", {
        blocked_stage: "imported_repo_hydration",
        blocked_reason: "unknown",
        ready_for_cycle: false,
      });

      await service.clearImportHydrationBlocked("project-clear-preserve", {
        cleared_stage: "imported_repo_hydration",
        ready_for_cycle: true,
      });

      const persisted = requireProjectState("project-clear-preserve");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.sourceContext).toEqual({
        sourceType: "github",
        sourceId: "repo-1",
      });
      expect(metadata.blocked_stage).toBeUndefined();
      expect(metadata.blocked_reason).toBeUndefined();
    });

    it("does not change workflow run status when clearing blocked state", async () => {
      await service.start("project-clear-status", {
        goals: "Keep status on clear",
        workflowId: "project-orchestration-flow",
      });

      await service.recordImportHydrationBlocked("project-clear-status", {
        blocked_stage: "imported_repo_hydration",
        blocked_reason: "unknown",
        ready_for_cycle: false,
      });

      await service.clearImportHydrationBlocked("project-clear-status", {
        cleared_stage: "imported_repo_hydration",
        ready_for_cycle: true,
      });

      const persisted = requireProjectState("project-clear-status");
      expect(persisted.status).toBe("orchestrating");
    });

    it("relaunches imported discovery on the hydration recovery route", async () => {
      projectService.get.mockResolvedValue({
        id: "project-recover-imported-hydration",
        basePath: "/data/repos/project-1",
        repositoryUrl: "https://github.com/example/project-1",
      });

      await service.start("project-recover-imported-hydration", {
        goals: "Recover imported hydration",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
        sourceContext: {
          sourceType: "import_remote",
          sourceId: "repo-recover-1",
        },
        readinessContext: {
          isReady: true,
          readinessReason: "probe_artifacts_available",
        },
        startupHints: {
          preferredRouteId: "imported-repo-bootstrap",
        },
      });

      await service.recordImportHydrationBlocked(
        "project-recover-imported-hydration",
        {
          blocked_stage: "imported_repo_hydration",
          blocked_reason: "All 16 specs blocked pending human review",
          ready_for_cycle: false,
          child_run_id: "hydration-run-1",
        },
      );
      await service.recordCycleDecision("project-recover-imported-hydration", {
        decision: "blocked",
        reason: "All 16 specs blocked pending human review",
        idempotencyKey:
          "cycle-blocked-project-recover-imported-hydration-run-1",
      });

      const result = await service.recoverImportedHydration(
        "project-recover-imported-hydration",
      );

      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests.at(-1)).toMatchObject({
        workflow_id: "project_discovery_ceo",
        launch_source: "kanban_orchestration_recovery",
        input: {
          scopeId: "project-recover-imported-hydration",
          projectId: "project-recover-imported-hydration",
          scope_id: "project-recover-imported-hydration",
          orchestrationId: "project-recover-imported-hydration",
          goals: "Recover imported hydration",
          orchestrationMode: "autonomous",
          humanDecisionPolicy: "ask_when_uncertain",
          selectedRoute: "imported-repo-synthesis-and-hydration",
          selectedRuleId: "imported_repo_hydration_recovery",
          basePath: "/data/repos/project-1",
          repositoryUrl: "https://github.com/example/project-1",
          sourceContext: {
            sourceType: "import_remote",
            sourceId: "repo-recover-1",
          },
          readinessContext: {
            isReady: true,
            readinessReason: "probe_artifacts_available",
          },
          startupHints: {
            preferredRouteId: "imported-repo-bootstrap",
          },
        },
      });
      expect(result.currentWorkflowRunId).toBe("run-orch-1");

      const persisted = requireProjectState(
        "project-recover-imported-hydration",
      );
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.blocked_stage).toBeUndefined();
      expect(metadata.blocked_reason).toBeUndefined();
      expect(metadata.cycle_decision).toBeUndefined();
      expect(metadata.sourceContext).toEqual({
        sourceType: "import_remote",
        sourceId: "repo-recover-1",
      });
    });

    it("allows imported hydration recovery when blocked metadata exists but startup source context is missing", async () => {
      projectService.get.mockResolvedValue({
        id: "project-recover-imported-hydration-metadata-only",
        basePath: "/data/repos/project-2",
        repositoryUrl: "https://github.com/example/project-2",
      });

      await service.start("project-recover-imported-hydration-metadata-only", {
        goals: "Recover import hydration from persisted blocked state",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      const persistedBefore = requireProjectState(
        "project-recover-imported-hydration-metadata-only",
      );
      persistedBefore.metadata = {};

      await service.recordImportHydrationBlocked(
        "project-recover-imported-hydration-metadata-only",
        {
          blocked_stage: "imported_repo_hydration",
          blocked_reason: "All specs blocked pending human review",
          ready_for_cycle: false,
        },
      );

      await expect(
        service.recoverImportedHydration(
          "project-recover-imported-hydration-metadata-only",
        ),
      ).resolves.toMatchObject({
        currentWorkflowRunId: "run-orch-1",
        orchestrationMode: "autonomous",
      });

      expect(capturedRequests.at(-1)).toMatchObject({
        workflow_id: "project_discovery_ceo",
        input: {
          selectedRoute: "imported-repo-synthesis-and-hydration",
          basePath: "/data/repos/project-2",
          repositoryUrl: "https://github.com/example/project-2",
        },
      });
    });

    it("preserves timestamps when persistence save returns a partial relinked record", async () => {
      projectService.get.mockResolvedValue({
        id: "project-recover-imported-hydration-partial-save",
        basePath: "/data/repos/project-3",
        repositoryUrl: "https://github.com/example/project-3",
      });

      await service.start("project-recover-imported-hydration-partial-save", {
        goals:
          "Recover import hydration with partial persistence save response",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
        sourceContext: {
          sourceType: "import_remote",
          sourceId: "repo-recover-3",
        },
      });

      await service.recordImportHydrationBlocked(
        "project-recover-imported-hydration-partial-save",
        {
          blocked_stage: "imported_repo_hydration",
          blocked_reason: "All specs blocked pending human review",
          ready_for_cycle: false,
        },
      );

      const originalSave = orchestrationRepository.save.getMockImplementation();
      if (!originalSave) {
        throw new Error("missing orchestration save mock implementation");
      }
      let saveCallCount = 0;
      orchestrationRepository.save.mockImplementation((input) => {
        saveCallCount += 1;
        if (saveCallCount === 3) {
          const existing = byProject.get(input.project_id);
          const next = {
            project_id: input.project_id,
            goals: input.goals,
            mode: input.mode,
            status: input.status,
            linked_run_id: input.linked_run_id,
            decision_log: input.decision_log,
            action_requests: input.action_requests,
            metadata: input.metadata,
            updated_at: existing?.updated_at ?? new Date(),
            created_at: existing?.created_at ?? new Date(),
          };
          byProject.set(input.project_id, next);

          return Promise.resolve({
            project_id: input.project_id,
            goals: input.goals,
            mode: input.mode,
            status: input.status,
            linked_run_id: input.linked_run_id,
            decision_log: input.decision_log,
            action_requests: input.action_requests,
            metadata: input.metadata,
          } as never);
        }

        return originalSave(input);
      });

      await expect(
        service.recoverImportedHydration(
          "project-recover-imported-hydration-partial-save",
        ),
      ).resolves.toMatchObject({
        currentWorkflowRunId: "run-orch-1",
      });

      expect(saveCallCount).toBe(3);
      orchestrationRepository.save.mockImplementation(originalSave);
    });
  });

  describe("recordCycleDecision", () => {
    it("persists repeat decision in metadata and decision log", async () => {
      await service.start("project-cycle-repeat", {
        goals: "Cycle decision test",
        workflowId: "project-orchestration-flow",
      });

      const result = await service.recordCycleDecision("project-cycle-repeat", {
        decision: "repeat",
        reason: "3 spec(s) remain for implementation",
      });

      expect(result).toMatchObject({
        decision: "repeat",
        reason: "3 spec(s) remain for implementation",
        persisted: true,
      });

      const persisted = requireProjectState("project-cycle-repeat");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("repeat");
      expect(metadata.cycle_decision_reason).toBe(
        "3 spec(s) remain for implementation",
      );
      expect(metadata.cycle_decision_recorded_at).toBeTypeOf("string");

      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        type: "cycle_decision",
        reasoning: "3 spec(s) remain for implementation",
        actions: ["repeat"],
      });
    });

    it("persists pause decision in metadata and decision log", async () => {
      await service.start("project-cycle-pause", {
        goals: "Cycle pause test",
        workflowId: "project-orchestration-flow",
      });

      const result = await service.recordCycleDecision("project-cycle-pause", {
        decision: "pause",
        reason: "Human requested pause",
      });

      expect(result).toMatchObject({
        decision: "pause",
        persisted: true,
      });

      const persisted = requireProjectState("project-cycle-pause");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("pause");
      expect(metadata.cycle_decision_reason).toBe("Human requested pause");
      expect(metadata.cycle_decision_recorded_at).toBeTypeOf("string");

      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        type: "cycle_decision",
        reasoning: "Human requested pause",
        actions: ["pause"],
      });
    });

    it("persists complete decision in metadata and decision log", async () => {
      await service.start("project-cycle-complete", {
        goals: "Cycle complete test",
        workflowId: "project-orchestration-flow",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-complete",
        {
          decision: "complete",
          reason: "All specs resolved",
        },
      );

      expect(result).toMatchObject({
        decision: "complete",
        persisted: true,
      });

      const persisted = requireProjectState("project-cycle-complete");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("complete");
      expect(metadata.cycle_decision_reason).toBe("All specs resolved");
      expect(metadata.cycle_decision_recorded_at).toBeTypeOf("string");

      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        type: "cycle_decision",
        reasoning: "All specs resolved",
        actions: ["complete"],
      });
    });

    it("runs completion retrospectives after persisting an effective complete decision", async () => {
      await service.start("project-cycle-complete-retro", {
        goals: "Cycle complete retrospective test",
        workflowId: "project-orchestration-flow",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-complete-retro",
        {
          decision: "complete",
          reason: "All specs resolved",
          idempotencyKey: "cycle-complete-project-cycle-complete-retro-run-1",
        },
      );

      expect(result).toMatchObject({
        decision: "complete",
        persisted: true,
      });
      expect(retrospectiveService.runForCompletion).toHaveBeenCalledWith({
        project_id: "project-cycle-complete-retro",
        orchestration_id: "project-cycle-complete-retro",
        trigger_revision_marker:
          "cycle-complete-project-cycle-complete-retro-run-1",
        cycle_decision: "complete",
        trigger_details: {
          decision_idempotency_key:
            "cycle-complete-project-cycle-complete-retro-run-1",
        },
      });
      expect(
        orchestrationRepository.save.mock.invocationCallOrder.at(-1),
      ).toBeLessThan(
        retrospectiveService.runForCompletion.mock.invocationCallOrder[0],
      );
    });

    it.each(["repeat", "pause", "blocked"] as const)(
      "does not run completion retrospectives for %s decisions",
      async (decision) => {
        await service.start(`project-cycle-${decision}-no-retro`, {
          goals: "Cycle non-complete retrospective test",
          workflowId: "project-orchestration-flow",
        });

        await service.recordCycleDecision(
          `project-cycle-${decision}-no-retro`,
          {
            decision,
            reason: "Not complete",
            idempotencyKey: `cycle-${decision}-no-retro-run-1`,
          },
        );

        expect(retrospectiveService.runForCompletion).not.toHaveBeenCalled();
      },
    );

    it("keeps the persisted complete decision when retrospective execution fails", async () => {
      const loggerError = vi
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      retrospectiveService.runForCompletion.mockRejectedValueOnce(
        new Error("retrospective failed"),
      );
      await service.start("project-cycle-complete-retro-failure", {
        goals: "Cycle complete retrospective failure test",
        workflowId: "project-orchestration-flow",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-complete-retro-failure",
        {
          decision: "complete",
          reason: "All specs resolved",
          idempotencyKey: "cycle-complete-retro-failure-run-1",
        },
      );

      expect(result).toMatchObject({
        decision: "complete",
        persisted: true,
      });
      expect(
        byProject.get("project-cycle-complete-retro-failure")?.metadata,
      ).toMatchObject({ cycle_decision: "complete" });
      expect(loggerError).toHaveBeenCalledWith(
        "Completion retrospective failed for project project-cycle-complete-retro-failure: retrospective failed",
      );
    });

    it.each([
      { sourceContext: { sourceType: "import_remote" } },
      { sourceContext: { source_type: "import_remote" } },
    ])(
      "records blocked instead of complete when goals exist but no work items exist for imported repo metadata %#",
      async (metadata) => {
        orchestrationRepository.findByproject_id.mockResolvedValueOnce({
          project_id: "project-1",
          goals: "Goal A\nGoal B",
          mode: "autonomous",
          status: "orchestrating",
          linked_run_id: null,
          decision_log: [],
          action_requests: [],
          metadata,
          created_at: new Date(),
          updated_at: new Date(),
        });
        const result = await service.recordCycleDecision("project-1", {
          decision: "complete",
          reason: "bootstrap lifecycle complete",
          idempotencyKey: "key-1",
        });

        expect(result.decision).toBe("blocked");
        expect(orchestrationRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              cycle_decision: "blocked",
            }),
          }),
        );
      },
    );

    it.each(["repeat", "pause"] as const)(
      "does not convert %s to blocked for imported repo context with zero work items",
      async (decision) => {
        orchestrationRepository.findByproject_id.mockResolvedValueOnce({
          project_id: "project-1",
          goals: "Goal A\nGoal B",
          mode: "autonomous",
          status: "orchestrating",
          linked_run_id: null,
          decision_log: [],
          action_requests: [],
          metadata: { sourceContext: { sourceType: "import_remote" } },
          created_at: new Date(),
          updated_at: new Date(),
        });
        const result = await service.recordCycleDecision("project-1", {
          decision,
          reason: "cycle decision",
          idempotencyKey: `key-${decision}`,
        });

        expect(result.decision).toBe(decision);
        expect(orchestrationRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              cycle_decision: decision,
            }),
          }),
        );
      },
    );

    it("does not block complete with zero work items when metadata lacks explicit import_remote source", async () => {
      orchestrationRepository.findByproject_id.mockResolvedValueOnce({
        project_id: "project-1",
        goals: "Goal A\nGoal B",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: null,
        decision_log: [],
        action_requests: [],
        metadata: {
          sourceContext: { sourceType: "github" },
          repositoryUrl: "https://github.com/example/project-1",
          basePath: "/data/repos/project-1",
        },
        created_at: new Date(),
        updated_at: new Date(),
      });
      const result = await service.recordCycleDecision("project-1", {
        decision: "complete",
        reason: "all done",
        idempotencyKey: "key-normal-complete",
      });

      expect(result.decision).toBe("complete");
      expect(orchestrationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            cycle_decision: "complete",
          }),
        }),
      );
    });

    it("does not block complete for imported repo context when work items exist", async () => {
      orchestrationRepository.findByproject_id.mockResolvedValueOnce({
        project_id: "project-1",
        goals: "Goal A\nGoal B",
        mode: "autonomous",
        status: "orchestrating",
        linked_run_id: null,
        decision_log: [],
        action_requests: [],
        metadata: { sourceContext: { sourceType: "import_remote" } },
        created_at: new Date(),
        updated_at: new Date(),
      });
      workItems.findByproject_id.mockResolvedValueOnce([
        { id: "work-item-1" } as never,
      ]);

      const result = await service.recordCycleDecision("project-1", {
        decision: "complete",
        reason: "all imported repo work is done",
        idempotencyKey: "key-imported-complete-with-work",
      });

      expect(result.decision).toBe("complete");
      expect(orchestrationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            cycle_decision: "complete",
          }),
        }),
      );
    });

    it("persists blocked decision in metadata and decision log", async () => {
      await service.start("project-cycle-blocked", {
        goals: "Cycle blocked test",
        workflowId: "project-orchestration-flow",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-blocked",
        {
          decision: "blocked",
          reason: "1 spec(s) require human decision",
        },
      );

      expect(result).toMatchObject({
        decision: "blocked",
        persisted: true,
      });

      const persisted = requireProjectState("project-cycle-blocked");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("blocked");
      expect(metadata.cycle_decision_reason).toBe(
        "1 spec(s) require human decision",
      );
      expect(metadata.cycle_decision_recorded_at).toBeTypeOf("string");

      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        type: "cycle_decision",
        reasoning: "1 spec(s) require human decision",
        actions: ["blocked"],
      });
    });

    it("clears persisted cycle decision metadata while preserving an auditable decision log", async () => {
      await service.start("project-cycle-clear-decision", {
        goals: "Cycle clear test",
        workflowId: "project-orchestration-flow",
      });

      await service.recordImportHydrationBlocked(
        "project-cycle-clear-decision",
        {
          blocked_stage: "imported_repo_hydration",
          blocked_reason: "probe_failed",
          ready_for_cycle: false,
          child_run_id: "child-run-1",
        },
      );
      await service.recordCycleDecision("project-cycle-clear-decision", {
        decision: "blocked",
        reason: "No dispatchable work",
        idempotencyKey: "cycle-blocked-project-cycle-clear-decision-run-1",
      });

      await service.clearCycleDecision("project-cycle-clear-decision", {
        reason: "Ready work was restored",
      });

      const persisted = requireProjectState("project-cycle-clear-decision");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBeUndefined();
      expect(metadata.cycle_decision_reason).toBeUndefined();
      expect(metadata.cycle_decision_recorded_at).toBeUndefined();
      expect(metadata.cycle_decision_idempotency_key).toBeUndefined();
      expect(metadata.blocked_stage).toBe("imported_repo_hydration");
      expect(metadata.blocked_reason).toBe("probe_failed");
      expect(metadata.ready_for_cycle).toBe(false);
      expect(metadata.child_run_id).toBe("child-run-1");

      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(2);
      expect(log[0]).toMatchObject({
        type: "cycle_decision",
        cycleDecision: "blocked",
        idempotencyKey: "cycle-blocked-project-cycle-clear-decision-run-1",
      });
      expect(log[1]).toMatchObject({
        type: "cycle_decision_cleared",
        reason: "Ready work was restored",
        previousDecision: "blocked",
      });
      expect(log[1].timestamp).toBeTypeOf("string");

      const publicState = await service.get("project-cycle-clear-decision");
      expect(publicState.decisionLog).toEqual([
        expect.objectContaining({
          type: "cycle_decision",
          reasoning: "No dispatchable work",
          actions: ["blocked"],
          cycleDecision: "blocked",
        }),
        expect.objectContaining({
          type: "cycle_decision_cleared",
          reasoning: "Ready work was restored",
          actions: ["clear_cycle_decision"],
        }),
      ]);
    });

    it("clears autonomous default cycle decision metadata", async () => {
      await service.start("project-cycle-clear-autonomous-default", {
        goals: "Cycle clear autonomous default test",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      await service.recordCycleDecision(
        "project-cycle-clear-autonomous-default",
        {
          reason: "Autonomous cycle with ready work",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );
      const beforeClear = requireProjectState(
        "project-cycle-clear-autonomous-default",
      );
      expect(
        (beforeClear.metadata as Record<string, unknown>)
          .cycle_decision_autonomous_default,
      ).toBe(true);

      await service.clearCycleDecision(
        "project-cycle-clear-autonomous-default",
        { reason: "Operator reset stale autonomous default" },
      );

      const afterClear = requireProjectState(
        "project-cycle-clear-autonomous-default",
      );
      const metadata = afterClear.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBeUndefined();
      expect(metadata.cycle_decision_autonomous_default).toBeUndefined();
    });

    it("downgrades blocked to repeat when dispatchable todo work remains", async () => {
      await service.start("project-cycle-blocked-ready-work", {
        goals: "Ship the project",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });
      workItems.findByproject_id.mockResolvedValueOnce([
        { id: "todo-1", status: "todo", linked_run_id: null } as never,
      ]);

      const result = await service.recordCycleDecision(
        "project-cycle-blocked-ready-work",
        {
          decision: "blocked",
          reason: "No work available",
        },
      );

      expect(result).toMatchObject({
        decision: "repeat",
        reason:
          "Rejected blocked decision: dispatchable todo work remains. Original reason: No work available",
        persisted: true,
      });

      const persisted = requireProjectState("project-cycle-blocked-ready-work");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("repeat");
      expect(metadata.cycle_decision_reason).toBe(
        "Rejected blocked decision: dispatchable todo work remains. Original reason: No work available",
      );
    });

    it("allows blocked decision when remaining todo is blocked by an active target branch owner", async () => {
      await service.start("project-cycle-branch-conflicted", {
        goals: "Ship the project",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });
      workItems.findByproject_id.mockResolvedValueOnce([
        {
          id: "standing-order",
          status: "in-review",
          linked_run_id: null,
          current_execution_id: null,
          execution_config: { targetBranch: "feature/automation-improvements" },
        } as never,
        {
          id: "heartbeat-polling",
          status: "todo",
          linked_run_id: null,
          current_execution_id: null,
          execution_config: { targetBranch: "feature/automation-improvements" },
        } as never,
      ]);
      workItems.findDependenciesByWorkItemIds.mockResolvedValueOnce([]);

      const result = await service.recordCycleDecision(
        "project-cycle-branch-conflicted",
        {
          decision: "blocked",
          reason: "Only todo is branch-conflicted",
        },
      );

      expect(result.decision).toBe("blocked");
      expect(result.reason).toBe("Only todo is branch-conflicted");
    });

    it("still downgrades blocked to repeat when branch-unique todo work remains", async () => {
      await service.start("project-cycle-branch-unique", {
        goals: "Ship the project",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });
      workItems.findByproject_id.mockResolvedValueOnce([
        {
          id: "unique-todo",
          status: "todo",
          linked_run_id: null,
          current_execution_id: null,
          execution_config: { targetBranch: "feature/unique" },
        } as never,
      ]);
      workItems.findDependenciesByWorkItemIds.mockResolvedValueOnce([]);

      const result = await service.recordCycleDecision(
        "project-cycle-branch-unique",
        {
          decision: "blocked",
          reason: "Incorrect block",
        },
      );

      expect(result.decision).toBe("repeat");
      expect(result.reason).toContain("Rejected blocked decision");
    });

    it("allows blocked when todo work is dependency-blocked", async () => {
      await service.start("project-cycle-blocked-dependency", {
        goals: "Ship the project",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });
      workItems.findByproject_id.mockResolvedValueOnce([
        {
          id: "blocked-dependency",
          status: "blocked",
          linked_run_id: null,
        } as never,
        {
          id: "todo-1",
          status: "todo",
          linked_run_id: null,
          dependencyIds: ["blocked-dependency"],
        } as never,
      ]);

      const result = await service.recordCycleDecision(
        "project-cycle-blocked-dependency",
        {
          decision: "blocked",
          reason: "Dependencies blocked",
        },
      );

      expect(result).toMatchObject({
        decision: "blocked",
        reason: "Dependencies blocked",
        persisted: true,
      });
    });

    it("allows blocked when dependency rows block plain todo work", async () => {
      await service.start("project-cycle-blocked-dependency-row", {
        goals: "Ship the project",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });
      workItems.findByproject_id.mockResolvedValueOnce([
        {
          id: "blocked-dependency",
          status: "blocked",
          linked_run_id: null,
        } as never,
        { id: "todo-1", status: "todo", linked_run_id: null } as never,
      ]);
      workItems.findDependenciesByWorkItemIds.mockResolvedValueOnce([
        {
          work_item_id: "todo-1",
          depends_on_work_item_id: "blocked-dependency",
        } as never,
      ]);

      const result = await service.recordCycleDecision(
        "project-cycle-blocked-dependency-row",
        {
          decision: "blocked",
          reason: "Dependencies blocked",
        },
      );

      expect(result).toMatchObject({
        decision: "blocked",
        reason: "Dependencies blocked",
        persisted: true,
      });
      expect(workItems.findDependenciesByWorkItemIds).toHaveBeenCalledWith([
        "blocked-dependency",
        "todo-1",
      ]);
    });

    it.each(["pause", "complete"] as const)(
      "downgrades %s to repeat when dispatchable todo work remains",
      async (decision) => {
        await service.start(`project-cycle-${decision}-ready-work`, {
          goals: "Ship the project",
          workflowId: "project-orchestration-flow",
          orchestrationMode: "autonomous",
        });
        workItems.findByproject_id.mockResolvedValueOnce([
          {
            id: "done-dependency",
            status: "done",
            linked_run_id: null,
          } as never,
          {
            id: "todo-1",
            status: "todo",
            linked_run_id: null,
            dependency_ids: ["done-dependency"],
          } as never,
        ]);

        const result = await service.recordCycleDecision(
          `project-cycle-${decision}-ready-work`,
          {
            decision,
            reason: "No more orchestration needed",
          },
        );

        expect(result).toMatchObject({
          decision: "repeat",
          reason: `Rejected ${decision} decision: dispatchable todo work remains. Original reason: No more orchestration needed`,
          persisted: true,
        });
      },
    );

    it("defaults to repeat when autonomous, decision omitted, and ready work remains", async () => {
      await service.start("project-cycle-auto-default", {
        goals: "Autonomous default",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-auto-default",
        {
          reason: "autonomous cycle with ready work",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );

      expect(result).toMatchObject({
        decision: "repeat",
        reason: "autonomous cycle with ready work",
        persisted: true,
        duplicate: false,
      });

      const persisted = requireProjectState("project-cycle-auto-default");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("repeat");
      expect(metadata.cycle_decision_autonomous_default).toBe(true);

      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        type: "cycle_decision",
        actions: ["repeat"],
      });
    });

    it("autonomous default repeat is skipped when an explicit stop decision already exists", async () => {
      await service.start("project-cycle-explicit-stop", {
        goals: "Explicit stop blocks default",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      await service.recordCycleDecision("project-cycle-explicit-stop", {
        decision: "pause",
        reason: "Human requested pause",
      });

      const beforeAutoDefault = requireProjectState(
        "project-cycle-explicit-stop",
      );
      const logBefore = beforeAutoDefault.decision_log as Array<
        Record<string, unknown>
      >;
      expect(logBefore).toHaveLength(1);

      const result = await service.recordCycleDecision(
        "project-cycle-explicit-stop",
        {
          reason: "autonomous cycle with ready work",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );

      expect(result).toMatchObject({
        decision: "repeat",
        persisted: false,
        duplicate: false,
        skipped: true,
      });

      const afterAutoDefault = requireProjectState(
        "project-cycle-explicit-stop",
      );
      const metadataAfter = afterAutoDefault.metadata as Record<
        string,
        unknown
      >;
      expect(metadataAfter.cycle_decision).toBe("pause");

      const logAfter = afterAutoDefault.decision_log as Array<
        Record<string, unknown>
      >;
      expect(logAfter).toHaveLength(1);
    });

    it("autonomous default repeat resumes after an explicit stop decision is cleared", async () => {
      await service.start("project-cycle-cleared-explicit-stop", {
        goals: "Cleared explicit stop resumes default",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      await service.recordCycleDecision("project-cycle-cleared-explicit-stop", {
        decision: "pause",
        reason: "Human requested pause",
      });

      await service.clearCycleDecision("project-cycle-cleared-explicit-stop", {
        reason: "Human cleared pause",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-cleared-explicit-stop",
        {
          reason: "autonomous cycle with ready work",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );

      expect(result).toMatchObject({
        decision: "repeat",
        reason: "autonomous cycle with ready work",
        persisted: true,
        duplicate: false,
      });

      const persisted = byProject.get("project-cycle-cleared-explicit-stop");
      expect(persisted).toBeDefined();
      if (!persisted) throw new Error("expected persisted orchestration state");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("repeat");
      expect(metadata.cycle_decision_autonomous_default).toBe(true);

      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(3);
      expect(log[0]).toMatchObject({ cycleDecision: "pause" });
      expect(log[1]).toMatchObject({ type: "cycle_decision_cleared" });
      expect(log[2]).toMatchObject({
        cycleDecision: "repeat",
        autonomousDefault: true,
      });
    });

    it("explicit decision clears autonomous_default flag", async () => {
      await service.start("project-cycle-clear-flag", {
        goals: "Clear flag",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      await service.recordCycleDecision("project-cycle-clear-flag", {
        reason: "autonomous cycle",
        autonomousDefault: true,
        readyWorkRemaining: true,
      });

      const afterDefault = requireProjectState("project-cycle-clear-flag");
      const metaAfterDefault = afterDefault.metadata as Record<string, unknown>;
      expect(metaAfterDefault.cycle_decision_autonomous_default).toBe(true);

      await service.recordCycleDecision("project-cycle-clear-flag", {
        decision: "pause",
        reason: "Explicit stop",
      });

      const afterExplicit = requireProjectState("project-cycle-clear-flag");
      const metaAfterExplicit = afterExplicit.metadata as Record<
        string,
        unknown
      >;
      expect(metaAfterExplicit.cycle_decision).toBe("pause");
      expect(
        metaAfterExplicit.cycle_decision_autonomous_default,
      ).toBeUndefined();
    });

    it("autonomous default does not fire when readyWorkRemaining is false", async () => {
      await service.start("project-cycle-no-ready-work", {
        goals: "No ready work",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-no-ready-work",
        {
          reason: "no ready work",
          autonomousDefault: true,
          readyWorkRemaining: false,
        },
      );

      expect(result).toMatchObject({
        persisted: false,
        skipped: true,
      });

      const persisted = requireProjectState("project-cycle-no-ready-work");
      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(0);
    });

    it("autonomous default does not fire in supervised mode", async () => {
      await service.start("project-cycle-supervised", {
        goals: "Supervised mode",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "supervised",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-supervised",
        {
          reason: "supervised cycle",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );

      expect(result).toMatchObject({
        persisted: false,
        skipped: true,
      });

      const persisted = requireProjectState("project-cycle-supervised");
      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(0);
    });

    it("autonomous default repeat can follow a previous autonomous default repeat", async () => {
      await service.start("project-cycle-chained-defaults", {
        goals: "Chained defaults",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      const first = await service.recordCycleDecision(
        "project-cycle-chained-defaults",
        {
          reason: "cycle 1 ready work",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );
      expect(first).toMatchObject({ decision: "repeat", persisted: true });

      const second = await service.recordCycleDecision(
        "project-cycle-chained-defaults",
        {
          reason: "cycle 2 ready work",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );
      expect(second).toMatchObject({ decision: "repeat", persisted: true });

      const persisted = requireProjectState("project-cycle-chained-defaults");
      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(2);
      expect(log[0]).toMatchObject({ actions: ["repeat"] });
      expect(log[1]).toMatchObject({ actions: ["repeat"] });
    });

    it("explicit repeat resumes autonomous defaults after a historical explicit stop", async () => {
      await service.start("project-cycle-historical-stop", {
        goals: "Historical stop blocks default",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      await service.recordCycleDecision("project-cycle-historical-stop", {
        decision: "pause",
        reason: "Human requested pause",
      });

      await service.recordCycleDecision("project-cycle-historical-stop", {
        decision: "repeat",
        reason: "Human resumed explicitly",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-historical-stop",
        {
          reason: "autonomous cycle with ready work",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );

      expect(result).toMatchObject({
        decision: "repeat",
        persisted: true,
        duplicate: false,
      });

      const persisted = requireProjectState("project-cycle-historical-stop");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("repeat");
      expect(metadata.cycle_decision_reason).toBe(
        "autonomous cycle with ready work",
      );

      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(3);
      expect(log[0]).toMatchObject({ cycleDecision: "pause" });
      expect(log[1]).toMatchObject({ cycleDecision: "repeat" });
      expect(log[2]).toMatchObject({
        cycleDecision: "repeat",
        autonomousDefault: true,
      });
    });

    it("autonomous default repeat is skipped when only an autonomous repeat followed a historical explicit stop", async () => {
      await service.start("project-cycle-auto-overwrite-stop", {
        goals: "Autonomous overwrite still blocked",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      await service.recordCycleDecision("project-cycle-auto-overwrite-stop", {
        decision: "pause",
        reason: "Human requested pause",
      });

      const persistedBeforeReplay = requireProjectState(
        "project-cycle-auto-overwrite-stop",
      );
      persistedBeforeReplay.metadata = {
        ...(persistedBeforeReplay.metadata ?? {}),
        cycle_decision: "repeat",
        cycle_decision_reason: "Previous autonomous default",
        cycle_decision_autonomous_default: true,
      };
      persistedBeforeReplay.decision_log = [
        ...(persistedBeforeReplay.decision_log ?? []),
        {
          timestamp: "2026-05-09T00:00:00.000Z",
          type: "cycle_decision",
          reasoning: "Previous autonomous default",
          actions: ["repeat"],
          cycleDecision: "repeat",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      ];

      const result = await service.recordCycleDecision(
        "project-cycle-auto-overwrite-stop",
        {
          reason: "autonomous cycle with ready work",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );

      expect(result).toMatchObject({
        decision: "repeat",
        persisted: false,
        duplicate: false,
        skipped: true,
      });

      const persistedAfterReplay = requireProjectState(
        "project-cycle-auto-overwrite-stop",
      );
      const metadata = persistedAfterReplay.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("repeat");
      expect(metadata.cycle_decision_reason).toBe(
        "Previous autonomous default",
      );

      const log = persistedAfterReplay.decision_log as Array<
        Record<string, unknown>
      >;
      expect(log).toHaveLength(2);
      expect(log[0]).toMatchObject({ cycleDecision: "pause" });
      expect(log[1]).toMatchObject({
        cycleDecision: "repeat",
        autonomousDefault: true,
      });
    });

    it("autonomous default explicit-stop scan tolerates legacy decision log entries", async () => {
      await service.start("project-cycle-legacy-stop", {
        goals: "Legacy stop blocks default",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      const persistedBeforeReplay = requireProjectState(
        "project-cycle-legacy-stop",
      );
      persistedBeforeReplay.decision_log = [
        null,
        {
          timestamp: "2026-05-09T00:00:00.000Z",
          type: "cycle_decision",
          reasoning: "malformed legacy entry",
        },
        {
          timestamp: "2026-05-09T00:00:01.000Z",
          type: "cycle_decision",
          reasoning: "legacy pause",
          actions: ["pause"],
        },
      ];

      const result = await service.recordCycleDecision(
        "project-cycle-legacy-stop",
        {
          reason: "autonomous cycle with ready work",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );

      expect(result).toMatchObject({
        decision: "repeat",
        persisted: false,
        duplicate: false,
        skipped: true,
      });

      const log = requireProjectState("project-cycle-legacy-stop")
        .decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(3);
    });

    it("duplicate replay returns legacy actions-only idempotency decision", async () => {
      await service.start("project-cycle-legacy-idempotency", {
        goals: "Legacy idempotency replay",
        workflowId: "project-orchestration-flow",
      });

      const persistedBeforeReplay = requireProjectState(
        "project-cycle-legacy-idempotency",
      );
      persistedBeforeReplay.metadata = {
        ...(persistedBeforeReplay.metadata ?? {}),
        cycle_decision: "pause",
        cycle_decision_reason: "Later pause",
      };
      persistedBeforeReplay.decision_log = [
        null,
        {
          timestamp: "2026-05-09T00:00:00.000Z",
          type: "cycle_decision",
          reasoning: "Legacy repeat",
          actions: ["repeat"],
          cycleDecision: "invalid-cycle-decision",
          idempotencyKey: "legacy-repeat-key",
        },
      ];

      const result = await service.recordCycleDecision(
        "project-cycle-legacy-idempotency",
        {
          decision: "pause",
          reason: "Drifted replay",
          idempotencyKey: "legacy-repeat-key",
        },
      );

      expect(result).toMatchObject({
        decision: "repeat",
        reason: "Legacy repeat",
        persisted: false,
        duplicate: true,
      });

      const persistedAfterReplay = requireProjectState(
        "project-cycle-legacy-idempotency",
      );
      const metadata = persistedAfterReplay.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("pause");

      const log = persistedAfterReplay.decision_log as Array<Record<
        string,
        unknown
      > | null>;
      expect(log).toHaveLength(2);
    });

    it("duplicate replay ignores malformed metadata decision and reason", async () => {
      await service.start("project-cycle-malformed-metadata-idempotency", {
        goals: "Malformed metadata idempotency replay",
        workflowId: "project-orchestration-flow",
      });

      const persistedBeforeReplay = requireProjectState(
        "project-cycle-malformed-metadata-idempotency",
      );
      persistedBeforeReplay.metadata = {
        ...(persistedBeforeReplay.metadata ?? {}),
        cycle_decision: "invalid-cycle-decision",
        cycle_decision_reason: 123,
        cycle_decision_idempotency_key: "malformed-metadata-key",
      };

      const result = await service.recordCycleDecision(
        "project-cycle-malformed-metadata-idempotency",
        {
          decision: "complete",
          reason: "Fallback request reason",
          idempotencyKey: "malformed-metadata-key",
        },
      );

      expect(result).toMatchObject({
        decision: "complete",
        reason: "Fallback request reason",
        persisted: false,
        duplicate: true,
      });

      const persistedAfterReplay = requireProjectState(
        "project-cycle-malformed-metadata-idempotency",
      );
      const log = persistedAfterReplay.decision_log as Array<
        Record<string, unknown>
      >;
      expect(log).toHaveLength(0);
    });

    it("filters malformed decision log entries from public orchestration state", async () => {
      await service.start("project-cycle-public-log", {
        goals: "Public decision log filtering",
        workflowId: "project-orchestration-flow",
      });

      const persisted = requireProjectState("project-cycle-public-log");
      persisted.decision_log = [
        null,
        {
          timestamp: "2026-05-09T00:00:00.000Z",
          type: "cycle_decision",
          reasoning: 123,
          actions: ["repeat"],
        },
        {
          timestamp: "2026-05-09T00:00:01.000Z",
          type: "cycle_decision",
          reasoning: "Ready work remains",
          actions: ["repeat"],
          cycleDecision: "invalid-cycle-decision",
          idempotencyKey: 123,
          autonomousDefault: "true",
          readyWorkRemaining: true,
        },
      ];

      const publicState = await service.get("project-cycle-public-log");

      expect(publicState.decisionLog).toEqual([
        {
          timestamp: "2026-05-09T00:00:01.000Z",
          type: "cycle_decision",
          reasoning: "Ready work remains",
          actions: ["repeat"],
          cycleDecision: "repeat",
          readyWorkRemaining: true,
        },
      ]);
    });

    it("rejects duplicate repeat decisions with the same idempotency key", async () => {
      await service.start("project-cycle-dedupe", {
        goals: "Dedup test",
        workflowId: "project-orchestration-flow",
      });

      const first = await service.recordCycleDecision("project-cycle-dedupe", {
        decision: "repeat",
        reason: "Work remains",
        idempotencyKey: "cycle-repeat-project-cycle-dedupe-run-1",
      });

      expect(first).toMatchObject({ persisted: true, duplicate: false });

      const second = await service.recordCycleDecision("project-cycle-dedupe", {
        decision: "repeat",
        reason: "Work remains",
        idempotencyKey: "cycle-repeat-project-cycle-dedupe-run-1",
      });

      expect(second).toMatchObject({ persisted: false, duplicate: true });

      const persisted = requireProjectState("project-cycle-dedupe");
      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(1);
    });

    it("allows different idempotency keys for repeat decisions", async () => {
      await service.start("project-cycle-diff-key", {
        goals: "Different key test",
        workflowId: "project-orchestration-flow",
      });

      const first = await service.recordCycleDecision(
        "project-cycle-diff-key",
        {
          decision: "repeat",
          reason: "Cycle 1 work remains",
          idempotencyKey: "cycle-repeat-project-cycle-diff-key-run-1",
        },
      );

      expect(first).toMatchObject({ persisted: true, duplicate: false });

      const second = await service.recordCycleDecision(
        "project-cycle-diff-key",
        {
          decision: "repeat",
          reason: "Cycle 2 work remains",
          idempotencyKey: "cycle-repeat-project-cycle-diff-key-run-2",
        },
      );

      expect(second).toMatchObject({ persisted: true, duplicate: false });

      const persisted = requireProjectState("project-cycle-diff-key");
      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(2);
    });

    it("persists optional idempotency key in metadata", async () => {
      await service.start("project-cycle-idem-key", {
        goals: "Idempotency key persist",
        workflowId: "project-orchestration-flow",
      });

      await service.recordCycleDecision("project-cycle-idem-key", {
        decision: "repeat",
        reason: "Work remains",
        idempotencyKey: "cycle-key-abc",
      });

      const persisted = requireProjectState("project-cycle-idem-key");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision_idempotency_key).toBe("cycle-key-abc");
    });

    it("omitted decision without autonomous default does not persist repeat", async () => {
      await service.start("project-cycle-no-default", {
        goals: "No default",
        workflowId: "project-orchestration-flow",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-no-default",
        {
          reason: "no decision provided and not autonomous default",
        },
      );

      expect(result).toMatchObject({
        persisted: false,
        skipped: true,
      });

      const persisted = requireProjectState("project-cycle-no-default");
      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(0);
    });

    it("omitted decision with autonomousDefault but readyWorkRemaining undefined does not persist repeat", async () => {
      await service.start("project-cycle-missing-ready", {
        goals: "Missing ready signal",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      const result = await service.recordCycleDecision(
        "project-cycle-missing-ready",
        {
          reason: "autonomous default without ready signal",
          autonomousDefault: true,
        },
      );

      expect(result).toMatchObject({
        persisted: false,
        skipped: true,
      });

      const persisted = requireProjectState("project-cycle-missing-ready");
      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(0);
    });

    it("repeat idempotency key reused after another decision/key is still duplicate", async () => {
      await service.start("project-cycle-historical-dedupe", {
        goals: "Historical dedup",
        workflowId: "project-orchestration-flow",
      });

      await service.recordCycleDecision("project-cycle-historical-dedupe", {
        decision: "repeat",
        reason: "Cycle 1",
        idempotencyKey: "key-cycle-1",
      });

      await service.recordCycleDecision("project-cycle-historical-dedupe", {
        decision: "repeat",
        reason: "Cycle 2",
        idempotencyKey: "key-cycle-2",
      });

      const logAfterTwo = requireProjectState("project-cycle-historical-dedupe")
        .decision_log as Array<Record<string, unknown>>;
      expect(logAfterTwo).toHaveLength(2);

      const replayFirst = await service.recordCycleDecision(
        "project-cycle-historical-dedupe",
        {
          decision: "repeat",
          reason: "Cycle 1 again",
          idempotencyKey: "key-cycle-1",
        },
      );

      expect(replayFirst).toMatchObject({ persisted: false, duplicate: true });

      const logAfterReplay = requireProjectState(
        "project-cycle-historical-dedupe",
      ).decision_log as Array<Record<string, unknown>>;
      expect(logAfterReplay).toHaveLength(2);
    });

    it("autonomous default idempotency replay remains duplicate after explicit stop", async () => {
      await service.start("project-cycle-auto-replay", {
        goals: "Autonomous replay dedup",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      const first = await service.recordCycleDecision(
        "project-cycle-auto-replay",
        {
          reason: "Ready work remains",
          autonomousDefault: true,
          readyWorkRemaining: true,
          idempotencyKey: "auto-repeat-key-1",
        },
      );
      expect(first).toMatchObject({ decision: "repeat", persisted: true });

      await service.recordCycleDecision("project-cycle-auto-replay", {
        decision: "pause",
        reason: "Human stop",
      });

      const replay = await service.recordCycleDecision(
        "project-cycle-auto-replay",
        {
          reason: "Ready work remains replay",
          autonomousDefault: true,
          readyWorkRemaining: true,
          idempotencyKey: "auto-repeat-key-1",
        },
      );

      expect(replay).toMatchObject({
        decision: "repeat",
        reason: "Ready work remains",
        persisted: false,
        duplicate: true,
      });

      const persisted = requireProjectState("project-cycle-auto-replay");
      const metadata = persisted.metadata as Record<string, unknown>;
      expect(metadata.cycle_decision).toBe("pause");
      expect(metadata.cycle_decision_reason).toBe("Human stop");

      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(2);
      expect(log[0]).toMatchObject({ cycleDecision: "repeat" });
      expect(log[1]).toMatchObject({ cycleDecision: "pause" });
    });

    it("cycle decision log entry includes typed cycleDecision and idempotency fields", async () => {
      await service.start("project-cycle-typed-log", {
        goals: "Typed log entry",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      await service.recordCycleDecision("project-cycle-typed-log", {
        decision: "repeat",
        reason: "Work remains",
        idempotencyKey: "typed-key-1",
      });

      const persisted = requireProjectState("project-cycle-typed-log");
      const log = persisted.decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        type: "cycle_decision",
        cycleDecision: "repeat",
        idempotencyKey: "typed-key-1",
      });

      await service.recordCycleDecision("project-cycle-typed-log", {
        reason: "autonomous default",
        autonomousDefault: true,
        readyWorkRemaining: true,
      });

      const logAfterAuto = requireProjectState("project-cycle-typed-log")
        .decision_log as Array<Record<string, unknown>>;
      expect(logAfterAuto).toHaveLength(2);
      expect(logAfterAuto[1]).toMatchObject({
        type: "cycle_decision",
        cycleDecision: "repeat",
        autonomousDefault: true,
        readyWorkRemaining: true,
      });
    });

    it("explicit pause cannot be marked as autonomous default and cannot be overridden by later autonomous repeat", async () => {
      await service.start("project-cycle-pause-no-override", {
        goals: "Pause not overridable",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      await service.recordCycleDecision("project-cycle-pause-no-override", {
        decision: "pause",
        reason: "Human stop",
        autonomousDefault: true,
      });

      const afterPause = requireProjectState("project-cycle-pause-no-override");
      const metaAfterPause = afterPause.metadata as Record<string, unknown>;
      expect(metaAfterPause.cycle_decision).toBe("pause");
      expect(metaAfterPause.cycle_decision_autonomous_default).toBeUndefined();

      const logAfterPause = afterPause.decision_log as Array<
        Record<string, unknown>
      >;
      expect(logAfterPause).toHaveLength(1);
      expect(logAfterPause[0].autonomousDefault).toBeUndefined();

      const result = await service.recordCycleDecision(
        "project-cycle-pause-no-override",
        {
          reason: "autonomous repeat after pause",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );

      expect(result).toMatchObject({ persisted: false, skipped: true });

      const afterAutoRetry = requireProjectState(
        "project-cycle-pause-no-override",
      );
      const metaAfterRetry = afterAutoRetry.metadata as Record<string, unknown>;
      expect(metaAfterRetry.cycle_decision).toBe("pause");
      const logAfterRetry = afterAutoRetry.decision_log as Array<
        Record<string, unknown>
      >;
      expect(logAfterRetry).toHaveLength(1);
    });

    it("explicit complete cannot be marked as autonomous default and cannot be overridden by later autonomous repeat", async () => {
      await service.start("project-cycle-complete-no-override", {
        goals: "Complete not overridable",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      await service.recordCycleDecision("project-cycle-complete-no-override", {
        decision: "complete",
        reason: "All done",
        autonomousDefault: true,
      });

      const meta = requireProjectState("project-cycle-complete-no-override")
        .metadata as Record<string, unknown>;
      expect(meta.cycle_decision).toBe("complete");
      expect(meta.cycle_decision_autonomous_default).toBeUndefined();

      const result = await service.recordCycleDecision(
        "project-cycle-complete-no-override",
        {
          reason: "autonomous repeat after complete",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );

      expect(result).toMatchObject({ persisted: false, skipped: true });
    });

    it("explicit blocked cannot be marked as autonomous default and cannot be overridden by later autonomous repeat", async () => {
      await service.start("project-cycle-blocked-no-override", {
        goals: "Blocked not overridable",
        workflowId: "project-orchestration-flow",
        orchestrationMode: "autonomous",
      });

      await service.recordCycleDecision("project-cycle-blocked-no-override", {
        decision: "blocked",
        reason: "Needs human",
        autonomousDefault: true,
      });

      const meta = requireProjectState("project-cycle-blocked-no-override")
        .metadata as Record<string, unknown>;
      expect(meta.cycle_decision).toBe("blocked");
      expect(meta.cycle_decision_autonomous_default).toBeUndefined();

      const result = await service.recordCycleDecision(
        "project-cycle-blocked-no-override",
        {
          reason: "autonomous repeat after blocked",
          autonomousDefault: true,
          readyWorkRemaining: true,
        },
      );

      expect(result).toMatchObject({ persisted: false, skipped: true });
    });

    it("explicit repeat does not set autonomous default flag", async () => {
      await service.start("project-cycle-repeat-no-auto-flag", {
        goals: "Repeat no auto flag",
        workflowId: "project-orchestration-flow",
      });

      await service.recordCycleDecision("project-cycle-repeat-no-auto-flag", {
        decision: "repeat",
        reason: "Explicit repeat",
        autonomousDefault: true,
      });

      const meta = requireProjectState("project-cycle-repeat-no-auto-flag")
        .metadata as Record<string, unknown>;
      expect(meta.cycle_decision).toBe("repeat");
      expect(meta.cycle_decision_autonomous_default).toBeUndefined();
    });

    it("same idempotency key with different decision is still duplicate and does not mutate metadata", async () => {
      await service.start("project-cycle-key-drift", {
        goals: "Key drift dedup",
        workflowId: "project-orchestration-flow",
      });

      const first = await service.recordCycleDecision(
        "project-cycle-key-drift",
        {
          decision: "repeat",
          reason: "Work remains",
          idempotencyKey: "drift-key-1",
        },
      );
      expect(first).toMatchObject({
        decision: "repeat",
        persisted: true,
        duplicate: false,
      });

      const metaAfterFirst = requireProjectState("project-cycle-key-drift")
        .metadata as Record<string, unknown>;
      expect(metaAfterFirst.cycle_decision).toBe("repeat");

      const drifted = await service.recordCycleDecision(
        "project-cycle-key-drift",
        {
          decision: "pause",
          reason: "Should not persist",
          idempotencyKey: "drift-key-1",
        },
      );
      expect(drifted).toMatchObject({
        decision: "repeat",
        reason: "Work remains",
        persisted: false,
        duplicate: true,
      });

      const metaAfterDrift = requireProjectState("project-cycle-key-drift")
        .metadata as Record<string, unknown>;
      expect(metaAfterDrift.cycle_decision).toBe("repeat");
      expect(metaAfterDrift.cycle_decision_reason).toBe("Work remains");

      const log = requireProjectState("project-cycle-key-drift")
        .decision_log as Array<Record<string, unknown>>;
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ cycleDecision: "repeat" });
    });
  });

  it("detects blocked hydration from hydration_summary metadata shape", async () => {
    await service.start("project-hydration-summary-blocked", {
      goals: "Hydration summary blocked",
      workflowId: "project-orchestration-flow",
    });

    const existing = requireProjectState("project-hydration-summary-blocked");
    byProject.set("project-hydration-summary-blocked", {
      ...existing,
      metadata: {
        ...(existing.metadata as Record<string, unknown>),
        hydration_summary: {
          ok: false,
          status: "blocked",
          reason: "invalid_probe_results",
        },
      },
    });

    const diagnostics = await service.getDiagnostics(
      "project-hydration-summary-blocked",
    );

    expect(diagnostics.blocked).toBe(true);
    expect(diagnostics.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "import_hydration_blocked",
        }),
      ]),
    );
  });

  it("setModeMirror persists the derived mode without re-launching", async () => {
    byProject.set("proj-1", {
      project_id: "proj-1",
      goals: "Test mode mirror",
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await service.setModeMirror("proj-1", "supervised");

    expect(orchestrationRepository.updateMode).toHaveBeenCalledWith(
      "proj-1",
      "supervised",
    );
    // mirror must not start/stop runs:
    expect(capturedRequests).toHaveLength(0);
  });
});

describe("OrchestrationService — NestJS testing-module isolation", () => {
  // Small, deterministic proof point that the 5 helper services are
  // NestJS-injected providers: with `Test.createTestingModule`
  // overrides, real helper implementations are never instantiated and
  // the orchestrator's public surface still resolves through the DI
  // graph. A future refactor that drops any of these helpers from
  // `OrchestrationModule.providers` (or reverts to manual DI in the
  // orchestrator's constructor) will fail this test rather than
  // silently re-introduce the old pattern.
  it("resolves OrchestrationService with all 5 helper providers stubbed via NestJS DI", async () => {
    const observabilityStub = {
      recordWakeup: vi.fn().mockResolvedValue(undefined),
      getDiagnostics: vi.fn().mockResolvedValue(undefined),
      getActivitySummary: vi.fn().mockResolvedValue(undefined),
    };
    const cycleDecisionStub = {
      recordCycleDecision: vi.fn(),
      clearCycleDecision: vi.fn(),
    };
    const actionRequestsStub = {
      requestAction: vi.fn(),
      approveActionRequest: vi.fn(),
      rejectActionRequest: vi.fn(),
      listProjectActionRequests: vi.fn().mockResolvedValue([]),
      listActionRequests: vi.fn().mockResolvedValue([]),
    };
    const stateLifecycleStub = {
      getRecordMetadata: vi.fn((metadata: unknown) =>
        metadata && typeof metadata === "object" ? metadata : {},
      ),
      omitStartupRouteMetadata: vi.fn((metadata: Record<string, unknown>) => ({
        ...metadata,
      })),
      resolveStartupContext: vi.fn(() => ({
        sourceContext: undefined,
        readinessContext: undefined,
        startupHints: undefined,
      })),
      toProjectOrchestration: vi.fn((record: unknown) => record),
      recordImportHydrationBlocked: vi.fn().mockResolvedValue(undefined),
      reconcileLinkedWorkflowRun: vi.fn().mockResolvedValue({ cleared: false }),
    };
    const runRequestStub = {
      buildRunRequest: vi.fn().mockResolvedValue({
        workflow_id: "project_orchestration_cycle_ceo",
        input: {},
        metadata: {},
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrchestrationService,
        { provide: OrchestrationCycleDecisionService, useValue: cycleDecisionStub },
        { provide: OrchestrationActionRequestsService, useValue: actionRequestsStub },
        { provide: OrchestrationObservabilityService, useValue: observabilityStub },
        { provide: OrchestrationStateLifecycleService, useValue: stateLifecycleStub },
        { provide: OrchestrationRunRequestService, useValue: runRequestStub },
        { provide: ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE, useValue: vi.fn() },
        // The remaining 13 constructor slots require only structural
        // stubs to satisfy NestJS DI — recordWakeup never touches them.
        { provide: CoreWorkflowClientService, useValue: { requestWorkflowRun: vi.fn() } },
        { provide: CoreRunProjectionService, useValue: {} },
        { provide: BaseRequestContextService, useValue: { getRequestId: vi.fn(), getCausationId: vi.fn() } },
        { provide: KanbanOrchestrationRepository, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: KanbanWorkItemRepository, useValue: {} },
        { provide: HumanDecisionResolutionPolicyService, useValue: {} },
        { provide: KanbanRetrospectiveService, useValue: {} },
        { provide: KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE, useValue: {} },
        { provide: KanbanSettingsService, useValue: {} },
        { provide: OrchestrationLeaseService, useValue: {} },
        { provide: ProjectStrategicStateService, useValue: {} },
        { provide: WorkItemService, useValue: {} },
      ],
    }).compile();

    const service = moduleRef.get(OrchestrationService);

    await service.recordWakeup("project-iso-1", {
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
    });

    expect(observabilityStub.recordWakeup).toHaveBeenCalledTimes(1);
    expect(observabilityStub.recordWakeup).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-iso-1",
        input: {
          source: "core_lifecycle_stream",
          reason: "workflow_completed",
        },
      }),
    );
  });
});
