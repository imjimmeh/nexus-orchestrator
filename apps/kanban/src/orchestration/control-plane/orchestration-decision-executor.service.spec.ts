import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestrationControlPlaneSchedulerService } from "./orchestration-control-plane-scheduler.service";
import { OrchestrationDecisionExecutorService } from "./orchestration-decision-executor.service";
import { OrchestrationLeaseService } from "./orchestration-lease.service";
import type { SchedulerDecision } from "./control-plane.types";

const validTransitionDecision = {
  action: "transition_work_item_status",
  lane: "implementation",
  intent_type: "implement_work_item",
  reason: "Work item is ready",
  work_item_ids: ["11111111-1111-4111-8111-111111111111"],
  target_status: "in_progress",
};

describe("OrchestrationDecisionExecutorService", () => {
  let scheduler: {
    createIntent: ReturnType<typeof vi.fn>;
    evaluateIntent: ReturnType<typeof vi.fn>;
    markIntentRunning: ReturnType<typeof vi.fn>;
    terminalizeIntent: ReturnType<typeof vi.fn>;
    completeIntent: ReturnType<typeof vi.fn>;
  };
  let leaseService: {
    acquireMutationLeases: ReturnType<typeof vi.fn>;
    releaseOwned: ReturnType<typeof vi.fn>;
  };
  let service: OrchestrationDecisionExecutorService;

  beforeEach(() => {
    scheduler = {
      createIntent: vi.fn().mockResolvedValue({ id: "intent-1" }),
      evaluateIntent: vi.fn().mockResolvedValue(buildSchedulerDecision()),
      markIntentRunning: vi.fn().mockResolvedValue(
        buildSchedulerDecision({
          status: "launchable",
          reason: "no_conflicts",
        }),
      ),
      completeIntent: vi.fn().mockResolvedValue(
        buildSchedulerDecision({
          status: "completed",
          reason: "direct_mutation_completed",
        }),
      ),
      terminalizeIntent: vi.fn().mockResolvedValue(
        buildSchedulerDecision({
          status: "blocked",
          reason: "lane_capacity_reached",
        }),
      ),
    };
    leaseService = {
      acquireMutationLeases: vi
        .fn()
        .mockResolvedValue({ acquired: true, leaseIds: ["lease-1"] }),
      releaseOwned: vi.fn().mockResolvedValue(undefined),
    };
    service = new OrchestrationDecisionExecutorService(
      scheduler as unknown as OrchestrationControlPlaneSchedulerService,
      leaseService as unknown as OrchestrationLeaseService,
    );
  });

  it("rejects invalid structured decisions before creating an intent", async () => {
    await expect(
      service.recordExecutableDecision({
        projectId: "project-1",
        requester: "project_orchestration_cycle_ceo",
        structuredDecision: { action: "dispatch_work_items" },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(scheduler.createIntent).not.toHaveBeenCalled();
    expect(scheduler.evaluateIntent).not.toHaveBeenCalled();
  });

  it("creates an intent from a structured dispatch decision and evaluates scheduler policy", async () => {
    const result = await service.recordExecutableDecision({
      projectId: "project-1",
      requester: "project_orchestration_cycle_ceo",
      structuredDecision: {
        action: "dispatch_work_items",
        lane: "dispatch",
        intent_type: "dispatch_candidates",
        reason: "Ready work can be dispatched",
        priority: 25,
        work_item_ids: ["11111111-1111-4111-8111-111111111111"],
        target_branch: "feature/ready-work",
        workflow_id: "work_item_in_progress_default",
        workflow_scope: "11111111-1111-4111-8111-111111111111",
        evidence: [{ kind: "tool_result", id: "project-state" }],
        metadata: { source: "test" },
      },
    });

    expect(scheduler.createIntent).toHaveBeenCalledWith({
      projectId: "project-1",
      lane: "dispatch",
      type: "dispatch_candidates",
      requester: "project_orchestration_cycle_ceo",
      reason: "Ready work can be dispatched",
      priority: 25,
      evidence: [{ kind: "tool_result", id: "project-state" }],
      resources: [
        { kind: "work_item", id: "11111111-1111-4111-8111-111111111111" },
      ],
      conflictKeys: [
        { kind: "work_item", value: "11111111-1111-4111-8111-111111111111" },
        { kind: "target_branch", value: "feature/ready-work" },
        {
          kind: "workflow_scope",
          value:
            "work_item_in_progress_default:11111111-1111-4111-8111-111111111111",
        },
      ],
      workflow: {
        workflowId: "work_item_in_progress_default",
        scope: "11111111-1111-4111-8111-111111111111",
      },
      idempotencyKey: expect.stringMatching(
        /^ceo-decision:project-1:[0-9a-f]{24}$/,
      ),
      metadata: { source: "test" },
    });
    expect(
      (scheduler.createIntent.mock.calls[0]?.[0] as { idempotencyKey: string })
        .idempotencyKey.length,
    ).toBeLessThanOrEqual(64);
    expect(scheduler.evaluateIntent).toHaveBeenCalledWith("intent-1", {
      maxActivePerLane: 4,
      requireFreshFactTypes: ["project_state_snapshot"],
      requireFreshFacts: [
        {
          factType: "project_state_snapshot",
          subjectKind: "project",
          subjectIds: [],
        },
      ],
    });
    expect(result).toEqual({
      structuredDecision: expect.objectContaining({
        action: "dispatch_work_items",
        priority: 25,
      }),
      intentId: "intent-1",
      schedulerDecision: buildSchedulerDecision(),
    });
  });

  it("uses strategy lane capacity and work-item fact requirements for status transitions", async () => {
    await service.recordExecutableDecision({
      projectId: "project-1",
      requester: "kanban.work_item_transition_status",
      structuredDecision: {
        action: "transition_work_item_status",
        lane: "strategy",
        intent_type: "validate_project_health",
        reason: "Promote work into todo",
        work_item_ids: ["22222222-2222-4222-8222-222222222222"],
        target_status: "todo",
      },
    });

    expect(scheduler.evaluateIntent).toHaveBeenCalledWith("intent-1", {
      maxActivePerLane: 1,
      requireFreshFactTypes: ["work_item_current_state"],
      requireFreshFacts: [
        {
          factType: "work_item_current_state",
          subjectKind: "work_item",
          subjectIds: ["22222222-2222-4222-8222-222222222222"],
        },
      ],
    });
  });

  it("allows record-only decisions without freshness requirements", async () => {
    await service.recordExecutableDecision({
      projectId: "project-1",
      requester: "project_orchestration_cycle_ceo",
      structuredDecision: {
        action: "record_only",
        lane: "strategy",
        intent_type: "validate_project_health",
        reason: "Decision recorded for audit only",
      },
    });

    expect(scheduler.evaluateIntent).toHaveBeenCalledWith("intent-1", {
      maxActivePerLane: 1,
      requireFreshFactTypes: [],
      requireFreshFacts: [],
    });
  });

  it("terminalizes direct mutations while preserving the original scheduler reason", async () => {
    scheduler.evaluateIntent.mockResolvedValue(
      buildSchedulerDecision({
        status: "deferred",
        reason: "lane_capacity_reached",
      }),
    );

    const result = await service.recordExecutableDecision({
      projectId: "project-1",
      requester: "kanban.work_item_transition_status",
      terminalizeNoLaunch: true,
      structuredDecision: {
        action: "transition_work_item_status",
        lane: "strategy",
        intent_type: "validate_project_health",
        reason: "Promote work into todo",
        work_item_ids: ["22222222-2222-4222-8222-222222222222"],
        target_status: "todo",
      },
    });

    expect(scheduler.terminalizeIntent).toHaveBeenCalledWith(
      "intent-1",
      "blocked",
      "lane_capacity_reached",
      expect.objectContaining({
        message: "Direct mutation not launchable: lane_capacity_reached",
        schedulerDecision: expect.objectContaining({
          status: "deferred",
          reason: "lane_capacity_reached",
        }),
      }),
    );
    expect(result.schedulerDecision).toMatchObject({
      status: "blocked",
      reason: "lane_capacity_reached",
    });
  });

  it("acquires a lease, executes the mutation, and releases the lease on success", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });

    const result = await service.executeDirectMutationDecision({
      projectId: "project-1",
      requester: "kanban.work_item_transition_status",
      failureMetadata: { workItemId: "work-item-1", status: "in-review" },
      structuredDecision: {
        action: "transition_work_item_status",
        lane: "strategy",
        intent_type: "validate_project_health",
        reason: "Transition work-item-1 to in-review",
        work_item_ids: ["22222222-2222-4222-8222-222222222222"],
        target_status: "in-review",
      },
      execute,
    });

    expect(result).toEqual({ ok: true });
    expect(leaseService.acquireMutationLeases).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        lane: "strategy",
      }),
    );
    expect(execute).toHaveBeenCalledAfter(leaseService.acquireMutationLeases);
    expect(leaseService.releaseOwned).toHaveBeenCalledWith(
      "project-1",
      expect.any(String),
    );
  });

  it("releases the lease even when execution throws", async () => {
    const error = new Error("transition failed");
    const execute = vi.fn().mockRejectedValue(error);

    await expect(
      service.executeDirectMutationDecision({
        projectId: "project-1",
        requester: "kanban.work_item_transition_status",
        failureMetadata: { workItemId: "work-item-1", status: "in-review" },
        structuredDecision: {
          action: "transition_work_item_status",
          lane: "strategy",
          intent_type: "validate_project_health",
          reason: "Transition work-item-1 to in-review",
          work_item_ids: ["22222222-2222-4222-8222-222222222222"],
          target_status: "in-review",
        },
        execute,
      }),
    ).rejects.toThrow(error);

    expect(leaseService.acquireMutationLeases).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        lane: "strategy",
      }),
    );
    expect(leaseService.releaseOwned).toHaveBeenCalledWith(
      "project-1",
      expect.any(String),
    );
  });

  it("throws when a scheduler decision is not launchable", () => {
    expect(() => {
      service.assertLaunchable({
        structuredDecision: {
          action: "dispatch_work_items",
          lane: "dispatch",
          intent_type: "dispatch_candidates",
          reason: "Ready work can be dispatched",
          priority: 0,
          work_item_ids: [],
          evidence: [],
          metadata: {},
        },
        intentId: "intent-1",
        schedulerDecision: buildSchedulerDecision({
          status: "blocked",
          reason: "conflict_key_active",
        }),
      });
    }).toThrow("Decision is not launchable: conflict_key_active");
  });

  it("includes missing fact types in the error when available", () => {
    expect(() => {
      service.assertLaunchable({
        structuredDecision: {
          action: "dispatch_work_items",
          lane: "dispatch",
          intent_type: "dispatch_candidates",
          reason: "Ready work can be dispatched",
          priority: 0,
          work_item_ids: [],
          evidence: [],
          metadata: {},
        },
        intentId: "intent-1",
        schedulerDecision: buildSchedulerDecision({
          status: "deferred",
          reason: "missing_fresh_fact",
          metadata: {
            missingFreshFactTypes: [
              "work_item_current_state",
              "project_state_snapshot",
            ],
          },
        }),
      });
    }).toThrow(
      "Decision is not launchable: missing_fresh_fact (missing fact types: work_item_current_state, project_state_snapshot)",
    );
  });

  it("does not throw for launchable scheduler decisions", () => {
    expect(() => {
      service.assertLaunchable({
        structuredDecision: {
          action: "dispatch_work_items",
          lane: "dispatch",
          intent_type: "dispatch_candidates",
          reason: "Ready work can be dispatched",
          priority: 0,
          work_item_ids: [],
          evidence: [],
          metadata: {},
        },
        intentId: "intent-1",
        schedulerDecision: buildSchedulerDecision(),
      });
    }).not.toThrow();
  });

  it("blocks the mutation with the real reason when the lease cannot be acquired", async () => {
    leaseService.acquireMutationLeases.mockResolvedValue({
      acquired: false,
      conflicts: [
        {
          conflictKey: { kind: "work_item", value: "wi-1" },
          heldByOwnerKind: "direct_mutation",
          heldByOwnerId: "other",
          expiresAt: new Date().toISOString(),
        },
      ],
    });

    await expect(
      service.executeDirectMutationDecision({
        projectId: "p1",
        requester: "kanban.work_item_transition_status",
        structuredDecision: validTransitionDecision,
        execute: vi.fn(),
      }),
    ).rejects.toThrow(/work_item:wi-1/);
  });

  it("throws a lane-capacity error naming the real holder", async () => {
    const leaseServiceStub = {
      acquireMutationLeases: vi.fn().mockResolvedValue({
        acquired: false,
        conflicts: [
          {
            conflictKey: {
              kind: "workflow_scope",
              value: "lane_capacity:strategy",
            },
            heldByOwnerKind: "cycle_request",
            heldByOwnerId: "core_lifecycle_stream:work_item_completed",
            expiresAt: "2026-06-22T13:52:01.000Z",
          },
        ],
      }),
      releaseOwned: vi.fn(),
    };
    // scheduler is unused on this path; pass a minimal stub.
    const executor = new OrchestrationDecisionExecutorService(
      {} as never,
      leaseServiceStub as never,
    );

    await expect(
      executor.executeDirectMutationDecision({
        projectId: "p1",
        requester: "kanban.work_item_transition_status",
        structuredDecision: {
          action: "transition_work_item_status",
          lane: "strategy",
          intent_type: "validate_project_health",
          reason:
            "Transition a9a08b37-0000-4000-8000-000000000000 to ready-to-merge",
          work_item_ids: ["a9a08b37-0000-4000-8000-000000000000"],
          target_status: "ready-to-merge",
          evidence: [{ kind: "tool_result", id: "x" }],
        },
        execute: () => Promise.resolve("unused"),
      }),
    ).rejects.toThrow(/lane_capacity_exhausted.*strategy.*cycle_request/s);
    expect(leaseServiceStub.releaseOwned).not.toHaveBeenCalled();
  });
});

function buildSchedulerDecision(
  overrides: Partial<SchedulerDecision> = {},
): SchedulerDecision {
  return {
    intentId: "intent-1",
    outcomeId: "outcome-1",
    status: "launchable",
    reason: "no_conflicts",
    conflictKeys: [],
    activeConflicts: [],
    metadata: null,
    ...overrides,
  };
}
