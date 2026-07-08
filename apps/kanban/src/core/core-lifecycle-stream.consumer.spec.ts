import {
  CoreWorkflowRunEventEnvelopeV1Schema,
  CoreWorkflowStepEventEnvelopeV1Schema,
  FailureClass,
} from "@nexus/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreLifecycleStreamConsumerService } from "./core-lifecycle-stream.consumer";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { KanbanWorkItemRunCostRepository } from "../database/repositories/kanban-work-item-run-cost.repository";
import { OrchestrationRepairLaneService } from "../orchestration/control-plane/orchestration-repair-lane.service";
import { ProjectOrchestrationWakeupService } from "../orchestration/project-orchestration-wakeup.service";
import { OrchestrationLeaseService } from "../orchestration/control-plane/orchestration-lease.service";
import { CharterRegenEnqueuer } from "../project/charter-regen.enqueuer";
import { WorkItemRunLeaseService } from "../work-item/work-item-run-lease";
import { OrchestrationWakePolicyService } from "../orchestration/orchestration-wake-policy.service";

describe("CoreLifecycleStreamConsumerService", () => {
  const cursors = new Map<string, { stream_id: string; updated_at: Date }>();
  const deadLetters: unknown[] = [];
  const projectionService = {
    recordCoreLifecycleEvent: vi.fn(),
  };
  const dispatchService = {
    requestOrchestrationCycle: vi.fn().mockResolvedValue(undefined),
  };
  const orchestrationService = {
    reconcileLinkedWorkflowRun: vi.fn().mockResolvedValue({ cleared: true }),
    findByLinkedWorkflowRun: vi.fn(),
    updateSpecsReady: vi.fn().mockResolvedValue(undefined),
  };
  const workItems = {
    linkRunIfUnlinked: vi.fn().mockResolvedValue(false),
    clearRunLinksIfMatches: vi.fn().mockResolvedValue(true),
    recordExecutionStatus: vi.fn().mockResolvedValue(true),
    addTokenSpend: vi.fn().mockResolvedValue(true),
    addCostSpend: vi.fn().mockResolvedValue(true),
    findByProjectAndId: vi.fn().mockResolvedValue(null),
    findDependenciesByWorkItemIds: vi.fn().mockResolvedValue([]),
    findSubtasksByWorkItemIds: vi.fn().mockResolvedValue([]),
  };
  const workItemRunCosts = {
    recordAttempt: vi.fn().mockResolvedValue({ inserted: true }),
  };
  const realtimeGateway = {
    broadcastWorkItemUpdated: vi.fn(),
  };
  const realtimePublisher = {
    publish: vi.fn().mockResolvedValue(undefined),
  };
  const repairLane = {
    recordFailedWorkItemRun: vi.fn().mockResolvedValue(undefined),
  };
  const wakeupService = {
    requestWakeup: vi.fn().mockResolvedValue({ emitted: true }),
  };
  const wakePolicyService = {
    resolveForProject: vi.fn().mockResolvedValue("slot_freed"),
  };
  const leaseService = {
    releaseCycleLease: vi.fn().mockResolvedValue(undefined),
    heartbeatCycleLease: vi.fn().mockResolvedValue(undefined),
  };
  const charterRegen = {
    enqueue: vi.fn().mockResolvedValue(undefined),
  };
  const integrationEventRouter = {
    handles: vi.fn().mockReturnValue(false),
    route: vi.fn().mockResolvedValue(undefined),
  };
  /**
   * Permissive mock for the lifecycle-projection link lease. Defaults to
   * an unconditional acquire so existing assertions (link attempts,
   * dead-letter counts) keep passing without each test opting in to the
   * lease surface. Individual tests opt in to a denied acquire via
   * `workItemRunLease.acquireRunLease.mockResolvedValueOnce(...)`.
   */
  const workItemRunLease = {
    acquireRunLease: vi.fn(() =>
      Promise.resolve({ acquired: true, leaseIds: ["lease-1"] }),
    ),
    releaseRunLease: vi.fn().mockResolvedValue(undefined),
    deriveOwnerId: vi.fn(
      (projectId: string, workItemId: string, action: string) =>
        `kanban:work-item-run:${projectId}:${workItemId}:${action}`,
    ),
  };
  const cursorRepository = {
    getCursor: vi.fn((consumerName: string) =>
      Promise.resolve(cursors.get(consumerName) ?? null),
    ),
    saveCursor: vi.fn((consumerName: string, streamId: string) => {
      cursors.set(consumerName, {
        stream_id: streamId,
        updated_at: new Date(),
      });
      return Promise.resolve(cursors.get(consumerName));
    }),
  };
  const deadLetterRepository = {
    saveDeadLetter: vi.fn((record: unknown) => {
      deadLetters.push(record);
      return Promise.resolve(record);
    }),
    listDeadLetters: vi.fn(),
    deleteDeadLetter: vi.fn(),
    countRecent: vi.fn(),
  };
  const redis = {
    xrange: vi.fn(),
    xread: vi.fn(),
    xadd: vi.fn(),
  };

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    redis.xrange.mockReset();
    redis.xread.mockReset();
    redis.xadd.mockReset();
    redis.xadd.mockResolvedValue("100-0");
    deadLetterRepository.listDeadLetters.mockReset();
    deadLetterRepository.listDeadLetters.mockResolvedValue([]);
    deadLetterRepository.deleteDeadLetter.mockReset();
    deadLetterRepository.deleteDeadLetter.mockResolvedValue(undefined);
    deadLetterRepository.countRecent.mockReset();
    deadLetterRepository.countRecent.mockResolvedValue(0);
    delete process.env.KANBAN_CORE_LIFECYCLE_POLL_INTERVAL_MS;
    cursors.clear();
    deadLetters.length = 0;
    projectionService.recordCoreLifecycleEvent.mockResolvedValue({
      runId: "run-1",
    });
    dispatchService.requestOrchestrationCycle.mockResolvedValue(undefined);
    orchestrationService.reconcileLinkedWorkflowRun.mockResolvedValue({
      cleared: true,
    });
    orchestrationService.findByLinkedWorkflowRun.mockResolvedValue(null);
    orchestrationService.updateSpecsReady.mockResolvedValue(undefined);
    workItems.linkRunIfUnlinked.mockResolvedValue(false);
    workItems.recordExecutionStatus.mockResolvedValue(true);
    workItems.addTokenSpend.mockResolvedValue(true);
    workItems.findByProjectAndId.mockResolvedValue(null);
    workItems.findDependenciesByWorkItemIds.mockResolvedValue([]);
    workItems.findSubtasksByWorkItemIds.mockResolvedValue([]);
    realtimeGateway.broadcastWorkItemUpdated.mockReset();
    realtimePublisher.publish.mockResolvedValue(undefined);
    repairLane.recordFailedWorkItemRun.mockResolvedValue(undefined);
    wakeupService.requestWakeup.mockResolvedValue({ emitted: true });
    wakePolicyService.resolveForProject.mockResolvedValue("slot_freed");
    leaseService.releaseCycleLease.mockResolvedValue(undefined);
    leaseService.heartbeatCycleLease.mockResolvedValue(undefined);
    charterRegen.enqueue.mockResolvedValue(undefined);
    workItemRunLease.acquireRunLease.mockResolvedValue({
      acquired: true,
      leaseIds: ["lease-1"],
    });
    workItemRunLease.releaseRunLease.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("declares concrete repair and wakeup service metadata for Nest dependency injection", () => {
    const dependencies = Reflect.getMetadata(
      "design:paramtypes",
      CoreLifecycleStreamConsumerService,
    ) as unknown[];

    expect(dependencies[5]).toBe(KanbanWorkItemRepository);
    expect(dependencies[6]).toBe(KanbanWorkItemRunCostRepository);
    expect(dependencies[7]).toBe(OrchestrationRepairLaneService);
    expect(dependencies[8]).toBe(ProjectOrchestrationWakeupService);
    expect(dependencies[9]).toBe(OrchestrationLeaseService);
    expect(dependencies[10]).toBe(CharterRegenEnqueuer);
    expect(dependencies[12]).toBe(WorkItemRunLeaseService);
    expect(dependencies[15]).toBe(OrchestrationWakePolicyService);
  });

  it("replays from the persisted cursor and advances it after each projected event", async () => {
    cursors.set("core-lifecycle-projection", {
      stream_id: "10-0",
      updated_at: new Date("2026-04-29T00:00:00.000Z"),
    });
    redis.xrange.mockResolvedValue([
      [
        "11-0",
        ["envelope", JSON.stringify(createEnvelope("evt-1", "RUNNING"))],
      ],
      [
        "12-0",
        ["envelope", JSON.stringify(createEnvelope("evt-2", "COMPLETED"))],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(redis.xrange).toHaveBeenCalledWith(
      "stream:core:lifecycle",
      "(10-0",
      "+",
    );
    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(2);
    expect(cursorRepository.saveCursor).toHaveBeenLastCalledWith(
      "core-lifecycle-projection",
      "12-0",
    );
  });

  it("dead-letters malformed stream events and still advances the cursor", async () => {
    redis.xrange.mockResolvedValue([["13-0", ["envelope", "{bad json"]]]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).not.toHaveBeenCalled();
    const deadLetter = deadLetters[0] as { stream_id: string; reason: string };
    expect(deadLetter.stream_id).toBe("13-0");
    expect(deadLetter.reason).toContain("Malformed core lifecycle event");
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "13-0",
    );
  });

  it("dead-letters projection failures without rewinding successfully processed events", async () => {
    projectionService.recordCoreLifecycleEvent.mockRejectedValueOnce(
      new Error("projection failed"),
    );
    redis.xrange.mockResolvedValue([
      ["14-0", ["envelope", JSON.stringify(createEnvelope("evt-3", "FAILED"))]],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(deadLetterRepository.saveDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        stream_id: "14-0",
        reason: "projection failed",
      }),
    );
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "14-0",
    );
  });

  it("polls available events on module startup without manual replay", async () => {
    redis.xrange.mockResolvedValue([
      [
        "15-0",
        ["envelope", JSON.stringify(createEnvelope("evt-4", "RUNNING"))],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.onModuleInit();

    expect(redis.xrange).toHaveBeenCalledWith(
      "stream:core:lifecycle",
      "-",
      "+",
    );
    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "15-0",
    );
  });

  it("continues polling after startup until module destroy", async () => {
    vi.useFakeTimers();
    process.env.KANBAN_CORE_LIFECYCLE_POLL_INTERVAL_MS = "25";
    redis.xrange
      .mockResolvedValueOnce([
        [
          "16-0",
          ["envelope", JSON.stringify(createEnvelope("evt-5", "RUNNING"))],
        ],
      ])
      .mockResolvedValueOnce([
        [
          "17-0",
          ["envelope", JSON.stringify(createEnvelope("evt-6", "COMPLETED"))],
        ],
      ]);
    const consumer = createConsumer();

    await consumer.onModuleInit();
    await vi.advanceTimersByTimeAsync(25);

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(2);

    consumer.onModuleDestroy();
    redis.xrange.mockResolvedValueOnce([
      ["18-0", ["envelope", JSON.stringify(createEnvelope("evt-7", "FAILED"))]],
    ]);
    await vi.advanceTimersByTimeAsync(25);

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(2);
  });

  it("evaluates continuation when work item completes", async () => {
    redis.xrange.mockResolvedValue([
      [
        "19-0",
        [
          "envelope",
          JSON.stringify(
            createCompletedEnvelope("evt-8", "work-item-1", "project-1"),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(
      orchestrationService.reconcileLinkedWorkflowRun,
    ).toHaveBeenCalledWith("project-1", {
      workflowRunId: "run-1",
      status: "COMPLETED",
    });
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-1",
      reason: "work_item_completed",
      source: "core_lifecycle_stream",
    });
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "19-0",
    );
  });

  it("does not request orchestration cycle for orchestration lifecycle work item", async () => {
    redis.xrange.mockResolvedValue([
      [
        "20-0",
        [
          "envelope",
          JSON.stringify(
            createCompletedEnvelope(
              "evt-9",
              "__orchestration_lifecycle__",
              "project-1",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(dispatchService.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-1",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "20-0",
    );
  });

  it("records terminal core workflow run projections and requests one workflow completion wakeup", async () => {
    redis.xrange.mockResolvedValue([
      [
        "20-1",
        [
          "envelope",
          JSON.stringify(
            createTerminalCompletedRunWithProjectContext("evt-terminal"),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "core.workflow.run.completed.v1",
        payload: expect.objectContaining({
          run_id: "run-1",
          workflow_id: "workflow-1",
          status: "COMPLETED",
        }),
      }),
    );
    expect(wakeupService.requestWakeup).toHaveBeenCalledTimes(1);
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-1",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });
  });

  it("does not request orchestration cycle for non-completed events", async () => {
    redis.xrange.mockResolvedValue([
      [
        "21-0",
        ["envelope", JSON.stringify(createEnvelope("evt-10", "RUNNING"))],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(dispatchService.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(wakeupService.requestWakeup).not.toHaveBeenCalled();
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "21-0",
    );
  });

  it("links non-terminal workflow run events to work items", async () => {
    workItems.linkRunIfUnlinked.mockResolvedValueOnce(true);
    redis.xrange.mockResolvedValue([
      [
        "21-3",
        [
          "envelope",
          JSON.stringify(
            createRunningEnvelopeWithWorkItemId(
              "evt-link-running",
              "work-item-1",
              "project-1",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.linkRunIfUnlinked).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-1",
      runId: "run-1",
    });
    expect(
      orchestrationService.reconcileLinkedWorkflowRun,
    ).not.toHaveBeenCalled();
    expect(wakeupService.requestWakeup).not.toHaveBeenCalled();
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "21-3",
    );
  });

  it("records non-terminal run status onto the work item", async () => {
    workItems.linkRunIfUnlinked.mockResolvedValueOnce(true);
    const runningEnvelope = createRunningEnvelopeWithWorkItemId(
      "evt-record-status",
      "work-item-1",
      "project-1",
    );
    redis.xrange.mockResolvedValue([
      ["21-6", ["envelope", JSON.stringify(runningEnvelope)]],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.recordExecutionStatus).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-1",
      runId: runningEnvelope.payload.run_id,
      status: "RUNNING",
    });
  });

  it("broadcasts the updated work item to the board after a non-terminal status change", async () => {
    workItems.linkRunIfUnlinked.mockResolvedValueOnce(true);
    workItems.recordExecutionStatus.mockResolvedValueOnce(true);
    const runningEnvelope = createRunningEnvelopeWithWorkItemId(
      "evt-broadcast-status",
      "work-item-1",
      "project-1",
    );
    const entityWithStatus = {
      id: "work-item-1",
      project_id: "project-1",
      title: "Item",
      description: null,
      status: "in-progress",
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      token_spend: 0,
      cost_cents: 0,
      current_execution_id: "run-1",
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      linked_run_id: "run-1",
      last_execution_status: "RUNNING",
      created_at: new Date("2026-06-24T00:00:00.000Z"),
      updated_at: new Date("2026-06-24T00:00:00.000Z"),
    };
    workItems.findByProjectAndId.mockResolvedValueOnce(entityWithStatus);
    redis.xrange.mockResolvedValue([
      ["21-7", ["envelope", JSON.stringify(runningEnvelope)]],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(realtimeGateway.broadcastWorkItemUpdated).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        id: "work-item-1",
        lastExecutionStatus: "RUNNING",
      }),
      [],
    );
  });

  it("broadcasts the updated work item to the board immediately after a terminal (FAILED) status event", async () => {
    workItems.clearRunLinksIfMatches.mockResolvedValueOnce(true);
    const failedEnvelope = createFailedEnvelopeWithWorkItemId(
      "evt-broadcast-terminal",
      "work-item-term",
      "project-1",
    );
    const entityWithTerminalStatus = {
      id: "work-item-term",
      project_id: "project-1",
      title: "Item",
      description: null,
      status: "in-progress",
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      token_spend: 0,
      cost_cents: 0,
      current_execution_id: "run-1",
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      linked_run_id: "run-1",
      last_execution_status: "FAILED",
      created_at: new Date("2026-06-24T00:00:00.000Z"),
      updated_at: new Date("2026-06-24T00:00:00.000Z"),
    };
    workItems.findByProjectAndId.mockResolvedValueOnce(
      entityWithTerminalStatus,
    );
    redis.xrange.mockResolvedValue([
      ["60-0", ["envelope", JSON.stringify(failedEnvelope)]],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.clearRunLinksIfMatches).toHaveBeenCalledWith(
      "project-1",
      "work-item-term",
      failedEnvelope.payload.run_id,
      "FAILED",
    );
    expect(realtimeGateway.broadcastWorkItemUpdated).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        id: "work-item-term",
        lastExecutionStatus: "FAILED",
      }),
      [],
    );
  });

  it("clears the work item run link when a terminal (FAILED) run event arrives", async () => {
    // A terminal run must release the work item's WIP slot eagerly. Previously
    // only the poll-driven dispatch reconciliation sweep cleared the link, and
    // that sweep never visits items that have already moved to a terminal
    // column (e.g. `done`), so a cancelled/failed run stranded the link forever.
    const failedEnvelope = createFailedEnvelopeWithWorkItemId(
      "evt-terminal-clear",
      "work-item-term",
      "project-1",
    );
    redis.xrange.mockResolvedValue([
      ["61-0", ["envelope", JSON.stringify(failedEnvelope)]],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.clearRunLinksIfMatches).toHaveBeenCalledWith(
      "project-1",
      "work-item-term",
      failedEnvelope.payload.run_id,
      "FAILED",
    );
  });

  it("acquires the per-work-item run lease (action: lifecycle_link) before linking and releases it on success", async () => {
    workItems.linkRunIfUnlinked.mockResolvedValueOnce(true);
    redis.xrange.mockResolvedValue([
      [
        "21-3a",
        [
          "envelope",
          JSON.stringify(
            createRunningEnvelopeWithWorkItemId(
              "evt-link-lease-success",
              "work-item-1",
              "project-1",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItemRunLease.acquireRunLease).toHaveBeenCalledWith({
      projectId: "project-1",
      workItemId: "work-item-1",
      action: "lifecycle_link",
      ownerId: expect.stringContaining(
        "kanban:work-item-run:project-1:work-item-1:lifecycle_link",
      ),
    });
    expect(workItems.linkRunIfUnlinked).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-1",
      runId: "run-1",
    });
    expect(workItemRunLease.releaseRunLease).toHaveBeenCalledWith(
      "project-1",
      "kanban:work-item-run:project-1:work-item-1:lifecycle_link",
    );
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "21-3a",
    );
  });

  it("skips the linkRunIfUnlinked call when the lifecycle_link lease is already held and surfaces a structured WARN", async () => {
    workItemRunLease.acquireRunLease.mockResolvedValueOnce({
      acquired: false,
      conflicts: [
        {
          conflictKey: {
            kind: "work_item",
            value: "work_item_dispatch:project-1:work-item-1",
          },
          heldByOwnerKind: "direct_mutation",
          heldByOwnerId: "kanban:work-item-run:project-1:work-item-1:dispatch",
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
        },
      ],
    } as any);
    redis.xrange.mockResolvedValue([
      [
        "21-3b",
        [
          "envelope",
          JSON.stringify(
            createRunningEnvelopeWithWorkItemId(
              "evt-link-lease-conflict",
              "work-item-1",
              "project-1",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();
    const warnSpy = vi
      .spyOn(consumer["logger"], "warn")
      .mockImplementation(() => {});

    await consumer.replayFromCursor();

    expect(workItemRunLease.acquireRunLease).toHaveBeenCalledWith({
      projectId: "project-1",
      workItemId: "work-item-1",
      action: "lifecycle_link",
      ownerId: expect.stringContaining(
        "kanban:work-item-run:project-1:work-item-1:lifecycle_link",
      ),
    });
    expect(workItems.linkRunIfUnlinked).not.toHaveBeenCalled();
    expect(workItemRunLease.releaseRunLease).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Skipping lifecycle-projection link for work item work-item-1",
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "kanban:work-item-run:project-1:work-item-1:dispatch",
      ),
    );
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "21-3b",
    );
  });

  it("releases the lifecycle_link lease even when linkRunIfUnlinked throws", async () => {
    workItems.linkRunIfUnlinked.mockRejectedValueOnce(
      new Error("transient link failure"),
    );
    redis.xrange.mockResolvedValue([
      [
        "21-3c",
        [
          "envelope",
          JSON.stringify(
            createRunningEnvelopeWithWorkItemId(
              "evt-link-lease-throw",
              "work-item-1",
              "project-1",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItemRunLease.acquireRunLease).toHaveBeenCalledTimes(1);
    expect(workItemRunLease.releaseRunLease).toHaveBeenCalledWith(
      "project-1",
      "kanban:work-item-run:project-1:work-item-1:lifecycle_link",
    );
    // The thrown linkRunIfUnlinked surfaces as a dead-letter entry so the
    // cursor still advances on the next event.
    expect(deadLetterRepository.saveDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        stream_id: "21-3c",
        reason: "transient link failure",
      }),
    );
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "21-3c",
    );
  });

  it("does not link terminal workflow run events before stale-link reconciliation", async () => {
    redis.xrange.mockResolvedValue([
      [
        "21-4",
        [
          "envelope",
          JSON.stringify(
            createCompletedEnvelope(
              "evt-terminal-link-skip",
              "work-item-1",
              "project-1",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.linkRunIfUnlinked).not.toHaveBeenCalled();
    expect(
      orchestrationService.reconcileLinkedWorkflowRun,
    ).toHaveBeenCalledWith("project-1", {
      workflowRunId: "run-1",
      status: "COMPLETED",
    });
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-1",
      reason: "work_item_completed",
      source: "core_lifecycle_stream",
    });
  });

  it("does not link orchestration lifecycle marker runs", async () => {
    redis.xrange.mockResolvedValue([
      [
        "21-5",
        [
          "envelope",
          JSON.stringify(
            createRunningEnvelopeWithWorkItemId(
              "evt-orchestration-marker",
              "__orchestration_lifecycle__",
              "project-1",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.linkRunIfUnlinked).not.toHaveBeenCalled();
    expect(wakeupService.requestWakeup).not.toHaveBeenCalled();
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
  });

  it("resolves project from linked workflow run when terminal event has no project context", async () => {
    orchestrationService.findByLinkedWorkflowRun.mockResolvedValueOnce({
      project_id: "project-linked",
      linked_run_id: "run-1",
    });
    redis.xrange.mockResolvedValue([
      [
        "27-0",
        [
          "envelope",
          JSON.stringify(createCompletedEnvelopeWithoutContext("evt-linked")),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(orchestrationService.findByLinkedWorkflowRun).toHaveBeenCalledWith(
      "run-1",
    );
    expect(
      orchestrationService.reconcileLinkedWorkflowRun,
    ).toHaveBeenCalledWith("project-linked", {
      workflowRunId: "run-1",
      status: "COMPLETED",
    });
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-linked",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
  });

  it("skips orchestration continuation when a stale terminal run was not cleared", async () => {
    orchestrationService.findByLinkedWorkflowRun.mockResolvedValueOnce({
      project_id: "project-linked",
      linked_run_id: "run-1",
    });
    orchestrationService.reconcileLinkedWorkflowRun.mockResolvedValueOnce({
      cleared: false,
    });
    redis.xrange.mockResolvedValue([
      [
        "27-1",
        [
          "envelope",
          JSON.stringify(createCompletedEnvelopeWithoutContext("evt-relinked")),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(
      orchestrationService.reconcileLinkedWorkflowRun,
    ).toHaveBeenCalledWith("project-linked", {
      workflowRunId: "run-1",
      status: "COMPLETED",
    });
    expect(wakeupService.requestWakeup).not.toHaveBeenCalled();
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "27-1",
    );
  });

  it("records repair evidence and wakes orchestration for failed work-item runs", async () => {
    orchestrationService.reconcileLinkedWorkflowRun.mockResolvedValueOnce({
      cleared: false,
    });
    redis.xrange.mockResolvedValue([
      [
        "28-0",
        [
          "envelope",
          JSON.stringify(
            createFailedEnvelope("evt-failed", "work-item-1", "project-1"),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(repairLane.recordFailedWorkItemRun).toHaveBeenCalledWith({
      projectId: "project-1",
      workflowRunId: "run-1",
      workItemId: "work-item-1",
      status: "FAILED",
      failureClass: FailureClass.SystemFailure,
    });
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-1",
      reason: "workflow_failed",
      source: "core_lifecycle_stream",
    });
  });

  it("classifies QA-rejected failed work-item runs with FailureClass.QaRejection", async () => {
    orchestrationService.reconcileLinkedWorkflowRun.mockResolvedValueOnce({
      cleared: false,
    });
    const qaEntity = {
      id: "work-item-qa",
      project_id: "project-1",
      metadata: { qa_decision: "reject" },
    };
    // findByProjectAndId is called three times for failed work-item terminal events:
    // 1. recordTerminalRunStatus→broadcastWorkItemRunState (returns null to skip broadcast)
    // 2. evaluateContinuationForTerminalRun→recordTerminalRepairEvidence→resolveWorkItemRunFailureClass
    // 3. evaluateContinuationForTerminalRun→isWorkItemStillActive (returns null → not active → wake)
    workItems.findByProjectAndId.mockResolvedValueOnce(null);
    workItems.findByProjectAndId.mockResolvedValueOnce(qaEntity);
    redis.xrange.mockResolvedValue([
      [
        "29-0",
        [
          "envelope",
          JSON.stringify(
            createFailedEnvelope("evt-qa-reject", "work-item-qa", "project-1"),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.findByProjectAndId).toHaveBeenCalledWith(
      "project-1",
      "work-item-qa",
    );
    expect(repairLane.recordFailedWorkItemRun).toHaveBeenCalledWith({
      projectId: "project-1",
      workflowRunId: "run-1",
      workItemId: "work-item-qa",
      status: "FAILED",
      failureClass: FailureClass.QaRejection,
    });
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-1",
      reason: "workflow_failed",
      source: "core_lifecycle_stream",
    });
  });

  it("ignores terminal step lifecycle events when evaluating continuation", async () => {
    redis.xrange.mockResolvedValue([
      [
        "21-1",
        [
          "envelope",
          JSON.stringify(
            createCompletedStepEnvelope("evt-10-step", "project-1"),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).not.toHaveBeenCalled();
    expect(
      orchestrationService.reconcileLinkedWorkflowRun,
    ).not.toHaveBeenCalled();
    expect(wakeupService.requestWakeup).not.toHaveBeenCalled();
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "21-1",
    );
  });

  it("reads canonical snake_case work item metadata from completed workflow runs", async () => {
    redis.xrange.mockResolvedValue([
      [
        "21-2",
        [
          "envelope",
          JSON.stringify(
            createCompletedEnvelope(
              "evt-10-snake",
              "work-item-snake",
              "project-1",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-1",
      reason: "work_item_completed",
      source: "core_lifecycle_stream",
    });
  });

  it("handles continuation failure gracefully without dead-lettering", async () => {
    wakeupService.requestWakeup.mockRejectedValueOnce(
      new Error("continuation failed"),
    );
    redis.xrange.mockResolvedValue([
      [
        "22-0",
        [
          "envelope",
          JSON.stringify(
            createCompletedEnvelope("evt-11", "work-item-2", "project-2"),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-2",
      reason: "work_item_completed",
      source: "core_lifecycle_stream",
    });
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "22-0",
    );
  });

  it("does not update specs_ready when discovery workflow completes", async () => {
    redis.xrange.mockResolvedValue([
      [
        "23-0",
        [
          "envelope",
          JSON.stringify(
            createSpecWorkflowCompletedEnvelope(
              "evt-12",
              "project_discovery_ceo",
              "project-3",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(orchestrationService.updateSpecsReady).not.toHaveBeenCalled();
    expect(
      orchestrationService.reconcileLinkedWorkflowRun,
    ).toHaveBeenCalledWith("project-3", {
      workflowRunId: "run-1",
      status: "COMPLETED",
    });
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-3",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "23-0",
    );
  });

  it("does not update specs_ready when spec revision workflow completes", async () => {
    redis.xrange.mockResolvedValue([
      [
        "24-0",
        [
          "envelope",
          JSON.stringify(
            createSpecWorkflowCompletedEnvelope(
              "evt-13",
              "project_spec_revision_ceo",
              "project-4",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(orchestrationService.updateSpecsReady).not.toHaveBeenCalled();
    expect(
      orchestrationService.reconcileLinkedWorkflowRun,
    ).toHaveBeenCalledWith("project-4", {
      workflowRunId: "run-1",
      status: "COMPLETED",
    });
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-4",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });
    expect(cursorRepository.saveCursor).toHaveBeenCalledWith(
      "core-lifecycle-projection",
      "24-0",
    );
  });

  it("does not update specs_ready for non-spec workflows", async () => {
    redis.xrange.mockResolvedValue([
      [
        "25-0",
        [
          "envelope",
          JSON.stringify(
            createCompletedEnvelope("evt-14", "work-item-3", "project-5"),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(orchestrationService.updateSpecsReady).not.toHaveBeenCalled();
  });

  it("does not invoke specs_ready update path for discovery workflow completions", async () => {
    redis.xrange.mockResolvedValue([
      [
        "26-0",
        [
          "envelope",
          JSON.stringify(
            createSpecWorkflowCompletedEnvelope(
              "evt-15",
              "project_discovery_ceo",
              "project-6",
            ),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(orchestrationService.updateSpecsReady).not.toHaveBeenCalled();
    expect(
      orchestrationService.reconcileLinkedWorkflowRun,
    ).toHaveBeenCalledWith("project-6", {
      workflowRunId: "run-1",
      status: "COMPLETED",
    });
    expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
      projectId: "project-6",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
  });

  it("releases the cycle lease when a CEO workflow run reaches a terminal state", async () => {
    const projectId = "project-ceo-test";
    orchestrationService.reconcileLinkedWorkflowRun.mockResolvedValue({
      cleared: false,
    });

    redis.xrange.mockResolvedValue([
      [
        "50-0",
        [
          "envelope",
          JSON.stringify(
            createSpecWorkflowCompletedEnvelope(
              "evt-ceo-1",
              "project_orchestration_cycle_ceo",
              projectId,
            ),
          ),
        ],
      ],
    ]);

    const consumer = createConsumer();
    await consumer.replayFromCursor();

    expect(leaseService.releaseCycleLease).toHaveBeenCalledWith(projectId);
  });

  it("heartbeats the cycle lease when the CEO workflow run becomes RUNNING", async () => {
    const projectId = "project-ceo-heartbeat";

    redis.xrange.mockResolvedValue([
      [
        "51-0",
        [
          "envelope",
          JSON.stringify(
            createSpecWorkflowRunningEnvelope(
              "evt-ceo-running",
              "project_orchestration_cycle_ceo",
              projectId,
            ),
          ),
        ],
      ],
    ]);

    const consumer = createConsumer();
    await consumer.replayFromCursor();

    expect(leaseService.heartbeatCycleLease).toHaveBeenCalledWith(projectId);
  });

  it("accrues a terminal run's token usage onto its linked work item", async () => {
    const envelope = createCompletedEnvelopeWithUsage(
      "evt-usage",
      "work-item-1",
      "project-1",
      1500,
    );
    redis.xrange.mockResolvedValue([
      ["30-0", ["envelope", JSON.stringify(envelope)]],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.addTokenSpend).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-1",
      amount: 1500,
    });
  });

  it("accrues token usage when the work item id is carried in contextId (dispatch shape)", async () => {
    const envelope = createCompletedEnvelopeWithUsageInContextId(
      "evt-usage-contextid",
      "work-item-dispatch",
      "project-1",
      2200,
    );
    redis.xrange.mockResolvedValue([
      ["35-0", ["envelope", JSON.stringify(envelope)]],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.addTokenSpend).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-dispatch",
      amount: 2200,
    });
  });

  it("does not accrue token spend when the terminal run carries no usage", async () => {
    redis.xrange.mockResolvedValue([
      [
        "31-0",
        [
          "envelope",
          JSON.stringify(
            createCompletedEnvelope("evt-no-usage", "work-item-1", "project-1"),
          ),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.addTokenSpend).not.toHaveBeenCalled();
  });

  it("does not accrue token spend for orchestration-lifecycle runs", async () => {
    const envelope = {
      ...createTerminalCompletedRunWithProjectContext("evt-orch-usage"),
    };
    const withUsage = {
      ...envelope,
      payload: { ...envelope.payload, usage: { total_tokens: 999 } },
    };
    redis.xrange.mockResolvedValue([
      ["32-0", ["envelope", JSON.stringify(withUsage)]],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.addTokenSpend).not.toHaveBeenCalled();
  });

  it("accrues a terminal run's estimated cost onto its linked work item", async () => {
    const envelope = createCompletedEnvelopeWithUsageAndCost(
      "evt-cost",
      "work-item-cost",
      "project-1",
      1500,
      250,
    );
    redis.xrange.mockResolvedValue([
      ["33-0", ["envelope", JSON.stringify(envelope)]],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.addCostSpend).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-cost",
      amountCents: 250,
    });
  });

  it("does not accrue cost when estimated_cost_cents is absent from the usage payload", async () => {
    const envelope = createCompletedEnvelopeWithUsage(
      "evt-no-cost",
      "work-item-no-cost",
      "project-1",
      1500,
    );
    redis.xrange.mockResolvedValue([
      ["34-0", ["envelope", JSON.stringify(envelope)]],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(workItems.addCostSpend).not.toHaveBeenCalled();
  });

  describe("replayDeadLetters", () => {
    it("re-XADDs each stored dead-letter payload verbatim and deletes the row, without touching the cursor", async () => {
      const rowOne = {
        id: "dl-1",
        stream_key: "stream:core:lifecycle",
        stream_id: "40-0",
        reason: "projection failed",
        payload: {
          event_id: "evt-a",
          event_type: "improvement.task.requested.v1",
          occurred_at: "2026-07-01T00:00:00.000Z",
          envelope: JSON.stringify({ payload: { proposalId: "prop-a" } }),
        },
        created_at: new Date("2026-07-01T00:00:00.000Z"),
      };
      const rowTwo = {
        id: "dl-2",
        stream_key: "stream:core:lifecycle",
        stream_id: "41-0",
        reason: "projection failed",
        payload: {
          event_id: "evt-b",
          event_type: "improvement.task.requested.v1",
          occurred_at: "2026-07-01T00:01:00.000Z",
          envelope: JSON.stringify({ payload: { proposalId: "prop-b" } }),
        },
        created_at: new Date("2026-07-01T00:01:00.000Z"),
      };
      deadLetterRepository.listDeadLetters.mockResolvedValue([rowOne, rowTwo]);
      const consumer = createConsumer();

      const result = await consumer.replayDeadLetters();

      expect(redis.xadd).toHaveBeenCalledWith(
        "stream:core:lifecycle",
        "*",
        "event_id",
        "evt-a",
        "event_type",
        "improvement.task.requested.v1",
        "occurred_at",
        "2026-07-01T00:00:00.000Z",
        "envelope",
        rowOne.payload.envelope,
      );
      expect(redis.xadd).toHaveBeenCalledWith(
        "stream:core:lifecycle",
        "*",
        "event_id",
        "evt-b",
        "event_type",
        "improvement.task.requested.v1",
        "occurred_at",
        "2026-07-01T00:01:00.000Z",
        "envelope",
        rowTwo.payload.envelope,
      );
      expect(deadLetterRepository.deleteDeadLetter).toHaveBeenCalledWith(
        "dl-1",
      );
      expect(deadLetterRepository.deleteDeadLetter).toHaveBeenCalledWith(
        "dl-2",
      );
      expect(result).toEqual({ replayed: 2, skipped: 0, remaining: 0 });
      expect(cursorRepository.saveCursor).not.toHaveBeenCalled();
    });

    it("replays and deletes only rows matching the given proposalIds filter, leaving the rest intact", async () => {
      const rowMatch = {
        id: "dl-3",
        stream_key: "stream:core:lifecycle",
        stream_id: "42-0",
        reason: "projection failed",
        payload: {
          envelope: JSON.stringify({ payload: { proposalId: "prop-match" } }),
        },
        created_at: new Date("2026-07-01T00:02:00.000Z"),
      };
      const rowOther = {
        id: "dl-4",
        stream_key: "stream:core:lifecycle",
        stream_id: "43-0",
        reason: "projection failed",
        payload: {
          envelope: JSON.stringify({ payload: { proposalId: "prop-other" } }),
        },
        created_at: new Date("2026-07-01T00:03:00.000Z"),
      };
      deadLetterRepository.listDeadLetters.mockResolvedValue([
        rowMatch,
        rowOther,
      ]);
      // The non-matching row is left behind, so the post-drain count is 1.
      deadLetterRepository.countRecent.mockResolvedValue(1);
      const consumer = createConsumer();

      const result = await consumer.replayDeadLetters({
        proposalIds: ["prop-match"],
      });

      expect(redis.xadd).toHaveBeenCalledTimes(1);
      expect(deadLetterRepository.deleteDeadLetter).toHaveBeenCalledWith(
        "dl-3",
      );
      expect(deadLetterRepository.deleteDeadLetter).not.toHaveBeenCalledWith(
        "dl-4",
      );
      expect(result).toEqual({ replayed: 1, skipped: 1, remaining: 1 });
    });

    it("skips a row that fails to re-publish without aborting the rest of the batch", async () => {
      const rowBad = {
        id: "dl-5",
        stream_key: "stream:core:lifecycle",
        stream_id: "44-0",
        reason: "projection failed",
        payload: {
          envelope: JSON.stringify({ payload: { proposalId: "prop-bad" } }),
        },
        created_at: new Date("2026-07-01T00:04:00.000Z"),
      };
      const rowGood = {
        id: "dl-6",
        stream_key: "stream:core:lifecycle",
        stream_id: "45-0",
        reason: "projection failed",
        payload: {
          envelope: JSON.stringify({ payload: { proposalId: "prop-good" } }),
        },
        created_at: new Date("2026-07-01T00:05:00.000Z"),
      };
      redis.xadd
        .mockRejectedValueOnce(new Error("redis unavailable"))
        .mockResolvedValueOnce("100-0");
      deadLetterRepository.listDeadLetters.mockResolvedValue([rowBad, rowGood]);
      // The publish-fail row stays behind, so the post-drain count is 1.
      deadLetterRepository.countRecent.mockResolvedValue(1);
      const consumer = createConsumer();

      const result = await consumer.replayDeadLetters();

      expect(deadLetterRepository.deleteDeadLetter).toHaveBeenCalledTimes(1);
      expect(deadLetterRepository.deleteDeadLetter).toHaveBeenCalledWith(
        "dl-6",
      );
      expect(result).toEqual({ replayed: 1, skipped: 1, remaining: 1 });
    });
  });

  function createCompletedEnvelopeWithUsage(
    eventId: string,
    workItemId: string,
    project_id: string,
    totalTokens: number,
  ) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "COMPLETED",
        context: {
          scopeId: project_id,
          contextId: project_id,
          contextType: "kanban.project",
          metadata: { work_item_id: workItemId },
        },
        usage: { total_tokens: totalTokens, input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  function createCompletedEnvelopeWithUsageInContextId(
    eventId: string,
    workItemId: string,
    project_id: string,
    totalTokens: number,
  ) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "COMPLETED",
        context: {
          scopeId: project_id,
          contextId: workItemId,
          contextType: "kanban.project",
          metadata: null,
        },
        usage: { total_tokens: totalTokens, input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  function createCompletedEnvelopeWithUsageAndCost(
    eventId: string,
    workItemId: string,
    project_id: string,
    totalTokens: number,
    estimatedCostCents: number,
  ) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "COMPLETED",
        context: {
          scopeId: project_id,
          contextId: project_id,
          contextType: "kanban.project",
          metadata: { work_item_id: workItemId },
        },
        usage: {
          total_tokens: totalTokens,
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_cents: estimatedCostCents,
        },
      },
    });
  }

  function createConsumer(): CoreLifecycleStreamConsumerService {
    return new CoreLifecycleStreamConsumerService(
      redis as never,
      projectionService as never,
      cursorRepository as never,
      deadLetterRepository as never,
      orchestrationService as never,
      workItems as never,
      workItemRunCosts as never,
      repairLane as never,
      wakeupService as never,
      leaseService as never,
      charterRegen as never,
      integrationEventRouter as never,
      workItemRunLease as never,
      realtimeGateway as never,
      realtimePublisher as never,
      wakePolicyService as never,
    );
  }

  function createEnvelope(eventId: string, status: string) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status,
        context: {
          scopeId: "project-1",
          contextId: "project-1",
          contextType: "kanban.project",
          metadata: { workItemId: "work-item-1" },
        },
      },
    });
  }

  function createRunningEnvelopeWithWorkItemId(
    eventId: string,
    workItemId: string,
    project_id: string,
  ) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "RUNNING",
        context: {
          scopeId: project_id,
          contextId: workItemId,
          contextType: "kanban.project",
          metadata: { work_item_id: workItemId },
        },
      },
    });
  }

  function createFailedEnvelopeWithWorkItemId(
    eventId: string,
    workItemId: string,
    project_id: string,
  ) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "FAILED",
        context: {
          scopeId: project_id,
          contextId: project_id,
          contextType: "kanban.project",
          metadata: { work_item_id: workItemId },
        },
      },
    });
  }

  function createCompletedEnvelope(
    eventId: string,
    workItemId: string,
    project_id: string,
  ) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "COMPLETED",
        context: {
          scopeId: project_id,
          contextId: project_id,
          contextType: "kanban.project",
          metadata: { work_item_id: workItemId },
        },
      },
    });
  }

  function createFailedEnvelope(
    eventId: string,
    workItemId: string,
    project_id: string,
  ) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "FAILED",
        context: {
          scopeId: project_id,
          contextId: project_id,
          contextType: "kanban.project",
          metadata: { work_item_id: workItemId },
        },
      },
    });
  }

  function createCompletedEnvelopeWithoutContext(eventId: string) {
    const envelope = createCompletedEnvelope(
      "evt-completed-template",
      "work-item-ignored",
      "project-1",
    );
    return {
      ...envelope,
      event_id: eventId,
      payload: {
        ...envelope.payload,
        context: {
          scopeId: null,
          contextId: null,
          contextType: null,
          metadata: { ignore: "terminal completion without project context" },
        },
      },
    };
  }

  function createTerminalCompletedRunWithProjectContext(eventId: string) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "workflow-1",
        status: "COMPLETED",
        context: {
          scopeId: "project-1",
          contextId: "project-1",
          contextType: "kanban.project",
          metadata: { work_item_id: "__orchestration_lifecycle__" },
        },
      },
    });
  }

  function createCompletedStepEnvelope(eventId: string, project_id: string) {
    return CoreWorkflowStepEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.step.completed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        job_id: "job-1",
        step_id: "step-1",
        status: "COMPLETED",
        context: {
          scopeId: project_id,
          contextId: project_id,
          contextType: "kanban.project",
          metadata: { work_item_id: "work-item-step" },
        },
      },
    });
  }

  function createSpecWorkflowCompletedEnvelope(
    eventId: string,
    workflow_id: string,
    project_id: string,
  ) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id,
        status: "COMPLETED",
        context: {
          scopeId: project_id,
          contextId: project_id,
          contextType: "kanban.project",
        },
      },
    });
  }

  function createSpecWorkflowRunningEnvelope(
    eventId: string,
    workflow_id: string,
    project_id: string,
  ) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: eventId,
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-04-29T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id,
        status: "RUNNING",
        context: {
          scopeId: project_id,
          contextId: project_id,
          contextType: "kanban.project",
        },
      },
    });
  }
});

describe("CoreLifecycleStreamConsumerService — charter materialization", () => {
  function buildService(
    charterRegenEnqueuer: CharterRegenEnqueuer,
  ): CoreLifecycleStreamConsumerService {
    // Positional args match the real constructor order; only charterRegen is exercised here.
    return new CoreLifecycleStreamConsumerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      charterRegenEnqueuer,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it("enqueues charter regen when a run goes RUNNING for a project scope", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const service = buildService({
      enqueue,
    } as unknown as CharterRegenEnqueuer);

    await service.maybeMaterializeCharterOnRunStart({
      event_type: "core.workflow.run.status_changed.v1",
      payload: {
        run_id: "run-1",
        status: "RUNNING",
        context: {
          scopeId: "project-1",
          contextId: null,
          contextType: null,
          scopeNodeId: null,
          scopePath: null,
        },
      },
    } as any);

    expect(enqueue).toHaveBeenCalledWith("project-1");
  });

  it("does not enqueue for terminal runs or missing scope", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const service = buildService({
      enqueue,
    } as unknown as CharterRegenEnqueuer);

    await service.maybeMaterializeCharterOnRunStart({
      event_type: "core.workflow.run.status_changed.v1",
      payload: {
        run_id: "r",
        status: "COMPLETED",
        context: {
          scopeId: "p",
          contextId: null,
          contextType: null,
          scopeNodeId: null,
          scopePath: null,
        },
      },
    } as any);
    await service.maybeMaterializeCharterOnRunStart({
      event_type: "core.workflow.run.status_changed.v1",
      payload: { run_id: "r", status: "RUNNING", context: null },
    } as any);

    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("CoreLifecycleStreamConsumerService — capacity gate", () => {
  const cursors = new Map<string, { stream_id: string; updated_at: Date }>();
  const deadLetters: unknown[] = [];
  const projectionService = { recordCoreLifecycleEvent: vi.fn() };
  const orchestrationService = {
    reconcileLinkedWorkflowRun: vi.fn().mockResolvedValue({ cleared: true }),
    findByLinkedWorkflowRun: vi.fn().mockResolvedValue(null),
    updateSpecsReady: vi.fn().mockResolvedValue(undefined),
  };
  const workItems = {
    linkRunIfUnlinked: vi.fn().mockResolvedValue(false),
    clearRunLinksIfMatches: vi.fn().mockResolvedValue(true),
    recordExecutionStatus: vi.fn().mockResolvedValue(true),
    addTokenSpend: vi.fn().mockResolvedValue(true),
    addCostSpend: vi.fn().mockResolvedValue(true),
    findByProjectAndId: vi.fn().mockResolvedValue(null),
    findDependenciesByWorkItemIds: vi.fn().mockResolvedValue([]),
    findSubtasksByWorkItemIds: vi.fn().mockResolvedValue([]),
  };
  const workItemRunCosts = {
    recordAttempt: vi.fn().mockResolvedValue({ inserted: true }),
  };
  const realtimeGateway = { broadcastWorkItemUpdated: vi.fn() };
  const realtimePublisher = { publish: vi.fn().mockResolvedValue(undefined) };
  const repairLane = {
    recordFailedWorkItemRun: vi.fn().mockResolvedValue(undefined),
  };
  const wakeupService = {
    requestWakeup: vi.fn().mockResolvedValue({ emitted: true }),
  };
  const leaseService = {
    releaseCycleLease: vi.fn().mockResolvedValue(undefined),
    heartbeatCycleLease: vi.fn().mockResolvedValue(undefined),
  };
  const charterRegen = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const integrationEventRouter = {
    handles: vi.fn().mockReturnValue(false),
    route: vi.fn().mockResolvedValue(undefined),
  };
  const workItemRunLease = {
    acquireRunLease: vi.fn(() =>
      Promise.resolve({ acquired: true, leaseIds: ["lease-1"] }),
    ),
    releaseRunLease: vi.fn().mockResolvedValue(undefined),
    deriveOwnerId: vi.fn(
      (projectId: string, workItemId: string, action: string) =>
        `kanban:work-item-run:${projectId}:${workItemId}:${action}`,
    ),
  };
  const cursorRepository = {
    getCursor: vi.fn((consumerName: string) =>
      Promise.resolve(cursors.get(consumerName) ?? null),
    ),
    saveCursor: vi.fn((consumerName: string, streamId: string) => {
      cursors.set(consumerName, {
        stream_id: streamId,
        updated_at: new Date(),
      });
      return Promise.resolve(cursors.get(consumerName));
    }),
  };
  const deadLetterRepository = {
    saveDeadLetter: vi.fn((record: unknown) => {
      deadLetters.push(record);
      return Promise.resolve(record);
    }),
  };
  const redis = { xrange: vi.fn(), xread: vi.fn() };
  const wakePolicyService = {
    resolveForProject: vi.fn().mockResolvedValue("slot_freed"),
  };

  function createConsumer(): CoreLifecycleStreamConsumerService {
    return new CoreLifecycleStreamConsumerService(
      redis as never,
      projectionService as never,
      cursorRepository as never,
      deadLetterRepository as never,
      orchestrationService as never,
      workItems as never,
      workItemRunCosts as never,
      repairLane as never,
      wakeupService as never,
      leaseService as never,
      charterRegen as never,
      integrationEventRouter as never,
      workItemRunLease as never,
      realtimeGateway as never,
      realtimePublisher as never,
      wakePolicyService as never,
    );
  }

  function makeCompletedWorkItemRunEnvelope(
    projectId: string,
    workItemId: string,
  ) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: `cap-gate-${Math.random()}`,
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-06-28T00:00:00.000Z",
      correlation_id: "corr-cap",
      source_service: "core",
      payload: {
        run_id: "run-cap-1",
        workflow_id: "work_item_implement",
        status: "COMPLETED",
        context: {
          scopeId: projectId,
          contextId: projectId,
          contextType: "kanban.project",
          metadata: { work_item_id: workItemId },
        },
      },
    });
  }

  function makeCompletedLifecycleRunEnvelope(projectId: string) {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: `cap-gate-orch-${Math.random()}`,
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-06-28T00:00:00.000Z",
      correlation_id: "corr-cap-orch",
      source_service: "core",
      payload: {
        run_id: "run-cap-orch",
        workflow_id: "project_orchestration_cycle_ceo",
        status: "COMPLETED",
        context: {
          scopeId: projectId,
          contextId: projectId,
          contextType: "kanban.project",
          metadata: { work_item_id: "__orchestration_lifecycle__" },
        },
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    redis.xrange.mockReset();
    cursors.clear();
    deadLetters.length = 0;
    projectionService.recordCoreLifecycleEvent.mockResolvedValue({
      runId: "run-cap-1",
    });
    orchestrationService.reconcileLinkedWorkflowRun.mockResolvedValue({
      cleared: true,
    });
    orchestrationService.findByLinkedWorkflowRun.mockResolvedValue(null);
    workItems.clearRunLinksIfMatches.mockResolvedValue(true);
    workItems.recordExecutionStatus.mockResolvedValue(true);
    workItems.findByProjectAndId.mockResolvedValue(null);
    realtimeGateway.broadcastWorkItemUpdated.mockReset();
    realtimePublisher.publish.mockResolvedValue(undefined);
    wakeupService.requestWakeup.mockResolvedValue({ emitted: true });
    wakePolicyService.resolveForProject.mockResolvedValue("slot_freed");
    leaseService.releaseCycleLease.mockResolvedValue(undefined);
    charterRegen.enqueue.mockResolvedValue(undefined);
    workItemRunLease.acquireRunLease.mockResolvedValue({
      acquired: true,
      leaseIds: ["lease-1"],
    });
    workItemRunLease.releaseRunLease.mockResolvedValue(undefined);
  });

  it("suppresses the wakeup when the completed item is still active (in-review)", async () => {
    wakePolicyService.resolveForProject.mockResolvedValue("slot_freed");
    // findByProjectAndId is called twice for completed work-item terminal events:
    // 1. recordTerminalRunStatus→broadcastWorkItemRunState (null → skip broadcast to avoid date errors)
    // 2. isWorkItemStillActive (returns the in-review entity so gate can inspect the slot)
    workItems.findByProjectAndId.mockResolvedValueOnce(null);
    workItems.findByProjectAndId.mockResolvedValueOnce({
      id: "wi1",
      status: "in-review",
      linked_run_id: null,
      current_execution_id: null,
    });
    redis.xrange.mockResolvedValue([
      [
        "gate-1-0",
        [
          "envelope",
          JSON.stringify(makeCompletedWorkItemRunEnvelope("p1", "wi1")),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(wakeupService.requestWakeup).not.toHaveBeenCalled();
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
  });

  it("wakes when the completed item is done (slot freed)", async () => {
    wakePolicyService.resolveForProject.mockResolvedValue("slot_freed");
    // Call 1 (broadcast) → null to skip; call 2 (isWorkItemStillActive) → done entity.
    workItems.findByProjectAndId.mockResolvedValueOnce(null);
    workItems.findByProjectAndId.mockResolvedValueOnce({
      id: "wi1",
      status: "done",
      linked_run_id: null,
      current_execution_id: null,
    });
    redis.xrange.mockResolvedValue([
      [
        "gate-2-0",
        [
          "envelope",
          JSON.stringify(makeCompletedWorkItemRunEnvelope("p1", "wi1")),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(wakeupService.requestWakeup).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        source: "core_lifecycle_stream",
      }),
    );
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
  });

  it("every_terminal policy wakes even when the item is still active", async () => {
    wakePolicyService.resolveForProject.mockResolvedValue("every_terminal");
    // Call 1 (broadcast) → null; call 2 (isWorkItemStillActive) → in-review (still active).
    workItems.findByProjectAndId.mockResolvedValueOnce(null);
    workItems.findByProjectAndId.mockResolvedValueOnce({
      id: "wi1",
      status: "in-review",
      linked_run_id: null,
      current_execution_id: null,
    });
    redis.xrange.mockResolvedValue([
      [
        "gate-3-0",
        [
          "envelope",
          JSON.stringify(makeCompletedWorkItemRunEnvelope("p1", "wi1")),
        ],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(wakeupService.requestWakeup).toHaveBeenCalled();
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
  });

  it("non-work-item runs (orchestration lifecycle marker) still wake under slot_freed policy", async () => {
    wakePolicyService.resolveForProject.mockResolvedValue("slot_freed");
    // The orchestration lifecycle marker is not a real work item so isWorkItemStillActive
    // short-circuits to false without loading the item. reconcile returns cleared:true so
    // shouldStopAfterStaleLink("other", true) is false and the gate is reached.
    redis.xrange.mockResolvedValue([
      [
        "gate-4-0",
        ["envelope", JSON.stringify(makeCompletedLifecycleRunEnvelope("p1"))],
      ],
    ]);
    const consumer = createConsumer();

    await consumer.replayFromCursor();

    expect(wakeupService.requestWakeup).toHaveBeenCalled();
    expect(deadLetterRepository.saveDeadLetter).not.toHaveBeenCalled();
  });
});
