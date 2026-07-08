import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { Logger } from "@nestjs/common";
import { OrchestrationContinuationReconcilerService } from "./orchestration-continuation-reconciler.service";

describe("OrchestrationContinuationReconcilerService", () => {
  let reconciler: OrchestrationContinuationReconcilerService;
  let findOrchestratingStatesSpy: Mock;
  let findOrchestratingStatesForContinuationCleanupSpy: Mock;
  let requestWakeupSpy: Mock;
  let reconcileProjectLinkedRunsSpy: Mock;
  let resolveProjectDispatchCapacitySpy: Mock;
  let clearCycleDecisionSpy: Mock;
  let heartbeatCycleLeaseSpy: Mock;
  let markPendingConsecutiveFailureSpy: Mock;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    delete process.env.KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS;

    findOrchestratingStatesSpy = vi.fn().mockResolvedValue([]);
    findOrchestratingStatesForContinuationCleanupSpy = vi
      .fn()
      .mockResolvedValue([]);
    requestWakeupSpy = vi.fn().mockResolvedValue({ emitted: true });
    reconcileProjectLinkedRunsSpy = vi.fn().mockResolvedValue({
      reconciled: [],
      skipped: [],
      orphanReconciled: [],
    });
    resolveProjectDispatchCapacitySpy = vi.fn().mockResolvedValue({
      maxActive: 1,
      activeCount: 0,
      availableSlots: 1,
      projectAvailableSlots: 1,
      canLaunchNewWork: true,
    });
    clearCycleDecisionSpy = vi.fn().mockResolvedValue(undefined);
    heartbeatCycleLeaseSpy = vi.fn().mockResolvedValue(undefined);
    markPendingConsecutiveFailureSpy = vi.fn().mockResolvedValue(undefined);
    const workItemsSpy = {
      findByProjectAndId: vi.fn().mockResolvedValue(null),
    };

    reconciler = new OrchestrationContinuationReconcilerService(
      {
        findOrchestratingStates: findOrchestratingStatesSpy,
        findOrchestratingStatesForContinuationCleanup:
          findOrchestratingStatesForContinuationCleanupSpy,
        clearCycleDecision: clearCycleDecisionSpy,
        markPendingConsecutiveFailure: markPendingConsecutiveFailureSpy,
      } as never,
      { requestWakeup: requestWakeupSpy } as never,
      {
        reconcileProjectLinkedRuns: reconcileProjectLinkedRunsSpy,
        resolveProjectDispatchCapacity: resolveProjectDispatchCapacitySpy,
      } as never,
      { heartbeatCycleLease: heartbeatCycleLeaseSpy } as never,
      workItemsSpy as never,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    reconciler.onModuleDestroy();
  });

  describe("onModuleInit", () => {
    it("calls the continuation cleanup query and emits wakeups on startup", async () => {
      vi.useFakeTimers();
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-1", linked_run_id: "run-1" },
      ] as never);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();

      expect(findOrchestratingStatesSpy).not.toHaveBeenCalled();
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);
      expect(requestWakeupSpy).toHaveBeenCalledWith({
        projectId: "project-1",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
    });

    it("emits a wakeup for each orchestrating state", async () => {
      vi.useFakeTimers();
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-a", linked_run_id: "run-a" },
        { project_id: "project-b", linked_run_id: null },
        { project_id: "project-c", linked_run_id: "run-c" },
      ] as never);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();

      expect(requestWakeupSpy).toHaveBeenCalledTimes(3);
      expect(requestWakeupSpy).toHaveBeenNthCalledWith(1, {
        projectId: "project-a",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
      expect(requestWakeupSpy).toHaveBeenNthCalledWith(2, {
        projectId: "project-b",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
      expect(requestWakeupSpy).toHaveBeenNthCalledWith(3, {
        projectId: "project-c",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
    });

    it("emits wakeups and does not record continuation decisions", async () => {
      vi.useFakeTimers();
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-1", linked_run_id: "run-1" },
      ] as never);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();

      expect(requestWakeupSpy).toHaveBeenCalledWith({
        projectId: "project-1",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
      expect(findOrchestratingStatesSpy).not.toHaveBeenCalled();
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe("reconcileStaleContinuations", () => {
    it("does not request a stale wakeup when the latest orchestration decision is blocked", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        {
          project_id: "project-1",
          status: "orchestrating",
          decision_log: [
            {
              type: "cycle_decision",
              cycleDecision: "repeat",
              idempotencyKey: "project-1-cycle-9",
            },
            {
              type: "cycle_decision",
              cycleDecision: "blocked",
              idempotencyKey: "project-1-cycle-9-blocked",
            },
          ],
          metadata: {},
        },
      ] as never);

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenCalledWith("project-1");
      expect(requestWakeupSpy).not.toHaveBeenCalled();
    });

    it("reconciles metadata-blocked states without requesting a stale wakeup", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        {
          project_id: "project-metadata-blocked",
          status: "orchestrating",
          decision_log: [],
          metadata: { cycle_decision: "blocked" },
        },
      ] as never);

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenCalledWith(
        "project-metadata-blocked",
      );
      expect(requestWakeupSpy).not.toHaveBeenCalled();
    });

    it("continues linked-run cleanup for later projects when a wakeup request fails", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-wakeup-fails", status: "orchestrating" },
        { project_id: "project-still-cleans", status: "orchestrating" },
      ] as never);
      requestWakeupSpy.mockImplementation((input: { projectId: string }) => {
        if (input.projectId === "project-wakeup-fails") {
          throw new Error("wakeup failed");
        }
        return Promise.resolve({ emitted: true });
      });

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 2 });
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenCalledTimes(2);
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenNthCalledWith(
        1,
        "project-wakeup-fails",
      );
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenNthCalledWith(
        2,
        "project-still-cleans",
      );
      expect(requestWakeupSpy).toHaveBeenCalledTimes(2);
    });

    it.each(["pause", "complete"])(
      "reconciles metadata-%s states without requesting a stale wakeup",
      async (cycleDecision) => {
        findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
          {
            project_id: `project-metadata-${cycleDecision}`,
            status: "orchestrating",
            decision_log: [],
            metadata: { cycle_decision: cycleDecision },
          },
        ] as never);

        const result = await reconciler.reconcileStaleContinuations();

        expect(result).toEqual({ evaluated: 1 });
        expect(reconcileProjectLinkedRunsSpy).toHaveBeenCalledWith(
          `project-metadata-${cycleDecision}`,
        );
        expect(requestWakeupSpy).not.toHaveBeenCalled();
      },
    );

    it.each(["pause", "complete"])(
      "reconciles latest %s decision-log states without requesting a stale wakeup",
      async (cycleDecision) => {
        findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
          {
            project_id: `project-log-${cycleDecision}`,
            status: "orchestrating",
            decision_log: [
              {
                type: "cycle_decision",
                cycleDecision,
                idempotencyKey: `project-log-${cycleDecision}-cycle-9`,
              },
            ],
            metadata: {},
          },
        ] as never);

        const result = await reconciler.reconcileStaleContinuations();

        expect(result).toEqual({ evaluated: 1 });
        expect(reconcileProjectLinkedRunsSpy).toHaveBeenCalledWith(
          `project-log-${cycleDecision}`,
        );
        expect(requestWakeupSpy).not.toHaveBeenCalled();
      },
    );

    it("reconciles actions-only blocked decisions without requesting a stale wakeup", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        {
          project_id: "project-actions-blocked",
          status: "orchestrating",
          decision_log: [
            {
              type: "cycle_decision",
              actions: ["blocked"],
              idempotencyKey: "project-actions-blocked-cycle-9",
            },
          ],
          metadata: {},
        },
      ] as never);

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenCalledWith(
        "project-actions-blocked",
      );
      expect(requestWakeupSpy).not.toHaveBeenCalled();
    });

    it("skips only states whose latest decision log entry is blocked", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        {
          project_id: "project-blocked",
          status: "orchestrating",
          decision_log: [
            {
              type: "cycle_decision",
              cycleDecision: "repeat",
              idempotencyKey: "project-blocked-cycle-8",
            },
            {
              type: "cycle_decision",
              cycleDecision: "blocked",
              idempotencyKey: "project-blocked-cycle-9",
            },
          ],
          metadata: {},
        },
        {
          project_id: "project-repeat",
          status: "orchestrating",
          decision_log: [
            {
              type: "cycle_decision",
              cycleDecision: "blocked",
              idempotencyKey: "project-repeat-cycle-8",
            },
            {
              type: "cycle_decision",
              cycleDecision: "repeat",
              idempotencyKey: "project-repeat-cycle-9",
            },
          ],
          metadata: {},
        },
      ] as never);

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 2 });
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenCalledTimes(2);
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenNthCalledWith(
        1,
        "project-blocked",
      );
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenNthCalledWith(
        2,
        "project-repeat",
      );
      expect(requestWakeupSpy).toHaveBeenCalledTimes(1);
      expect(requestWakeupSpy).toHaveBeenCalledWith({
        projectId: "project-repeat",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
    });

    it("reconciles linked runs before a stale wakeup that later dedupes", async () => {
      const callOrder: string[] = [];
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-1", status: "orchestrating", metadata: {} },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockImplementation(() => {
        callOrder.push("reconcile");
        return Promise.resolve({
          reconciled: [],
          skipped: [],
          orphanReconciled: [],
        });
      });
      requestWakeupSpy.mockImplementation(() => {
        callOrder.push("wakeup");
        return Promise.resolve({ emitted: false, reason: "cooldown_active" });
      });

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenCalledWith("project-1");
      expect(requestWakeupSpy).toHaveBeenCalledWith({
        projectId: "project-1",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
      expect(callOrder).toEqual(["reconcile", "wakeup"]);
    });

    it("clears stop decision when orphaned in-progress items are detected", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        {
          project_id: "project-with-orphans",
          status: "orchestrating",
          decision_log: [
            {
              type: "cycle_decision",
              cycleDecision: "blocked",
              idempotencyKey: "blocked-1",
            },
          ],
          metadata: {},
        },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockResolvedValue({
        reconciled: [],
        skipped: [],
        orphanReconciled: [
          { workItemId: "orphan-item-1", previousStatus: "in-progress" },
        ],
      });

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(clearCycleDecisionSpy).toHaveBeenCalledWith(
        "project-with-orphans",
        {
          reason: expect.stringContaining("orphaned in-progress work item"),
        },
      );
      expect(requestWakeupSpy).toHaveBeenCalledWith({
        projectId: "project-with-orphans",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
    });

    it("does not clear stop decision when no orphans are found", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        {
          project_id: "project-no-orphans",
          status: "orchestrating",
          decision_log: [],
          metadata: {},
        },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockResolvedValue({
        reconciled: [],
        skipped: [],
        orphanReconciled: [],
      });

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(clearCycleDecisionSpy).not.toHaveBeenCalled();
      expect(requestWakeupSpy).toHaveBeenCalledWith({
        projectId: "project-no-orphans",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
    });

    it("does not request a stale wakeup when project capacity is exhausted", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-at-cap", status: "orchestrating", metadata: {} },
      ] as never);
      resolveProjectDispatchCapacitySpy.mockResolvedValue({
        maxActive: 1,
        activeCount: 1,
        availableSlots: 0,
        projectAvailableSlots: 0,
        canLaunchNewWork: false,
      });

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(resolveProjectDispatchCapacitySpy).toHaveBeenCalledWith(
        "project-at-cap",
      );
      expect(requestWakeupSpy).not.toHaveBeenCalled();
    });

    it("requests a stale wakeup when project capacity is available", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        {
          project_id: "project-has-capacity",
          status: "orchestrating",
          metadata: {},
        },
      ] as never);
      resolveProjectDispatchCapacitySpy.mockResolvedValue({
        maxActive: 2,
        activeCount: 1,
        availableSlots: 1,
        projectAvailableSlots: 1,
        canLaunchNewWork: true,
      });

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(requestWakeupSpy).toHaveBeenCalledWith({
        projectId: "project-has-capacity",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
    });

    it("requests wakeup after orphan recovery even when project capacity is exhausted", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        {
          project_id: "project-orphan-at-cap",
          status: "orchestrating",
          decision_log: [
            {
              type: "cycle_decision",
              cycleDecision: "blocked",
              idempotencyKey: "blocked-1",
            },
          ],
          metadata: {},
        },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockResolvedValue({
        reconciled: [],
        skipped: [],
        orphanReconciled: [
          { workItemId: "orphan-item-1", previousStatus: "in-progress" },
        ],
      });
      resolveProjectDispatchCapacitySpy.mockResolvedValue({
        maxActive: 1,
        activeCount: 1,
        availableSlots: 0,
        projectAvailableSlots: 0,
        canLaunchNewWork: false,
      });

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(resolveProjectDispatchCapacitySpy).not.toHaveBeenCalled();
      expect(requestWakeupSpy).toHaveBeenCalledWith({
        projectId: "project-orphan-at-cap",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
    });

    it("continues processing later projects when capacity resolution fails", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-capacity-fails", status: "orchestrating" },
        { project_id: "project-still-wakes", status: "orchestrating" },
      ] as never);
      resolveProjectDispatchCapacitySpy.mockImplementation(
        (projectId: string) => {
          if (projectId === "project-capacity-fails") {
            throw new Error("settings unavailable");
          }
          return Promise.resolve({
            maxActive: 2,
            activeCount: 1,
            availableSlots: 1,
            projectAvailableSlots: 1,
            canLaunchNewWork: true,
          });
        },
      );

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 2 });
      expect(requestWakeupSpy).toHaveBeenCalledTimes(2);
      expect(requestWakeupSpy).toHaveBeenNthCalledWith(1, {
        projectId: "project-capacity-fails",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
      expect(requestWakeupSpy).toHaveBeenNthCalledWith(2, {
        projectId: "project-still-wakes",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
    });

    it("heartbeats the cycle lease for a project whose linked run is still active", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "p1", linked_run_id: "run-9" },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockResolvedValue({
        reconciled: [],
        skipped: [],
        orphanReconciled: [],
      });

      await reconciler.reconcileStaleContinuations();

      expect(heartbeatCycleLeaseSpy).toHaveBeenCalledWith("p1");
    });
  });

  describe("interval scheduling", () => {
    it("schedules interval runs after startup", async () => {
      vi.useFakeTimers();
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([]);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60000);
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(2);
    });

    it("uses KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS env var when set", async () => {
      vi.useFakeTimers();
      process.env.KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS = "100";
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([]);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(99);
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe("in-flight guard", () => {
    it("skips reconcile when inFlight guard prevents re-entrancy", async () => {
      vi.useFakeTimers();
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([]);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);

      const reconcilerPrivate = reconciler as unknown as {
        inFlight: boolean;
        runReconcile: () => Promise<void>;
      };
      reconcilerPrivate.inFlight = true;
      await reconcilerPrivate.runReconcile();

      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);
    });

    it("allows reconcile after inFlight guard releases", async () => {
      vi.useFakeTimers();
      process.env.KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS = "100";
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([]);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe("onModuleDestroy", () => {
    it("clears the interval so no further calls occur", async () => {
      vi.useFakeTimers();
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([]);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);

      reconciler.onModuleDestroy();

      await vi.advanceTimersByTimeAsync(60000);
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe("env parsing", () => {
    it("falls back to default when KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS rounds to 0", async () => {
      vi.useFakeTimers();
      process.env.KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS = "0.4";
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([]);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);
    });

    it("falls back to default for negative values", async () => {
      vi.useFakeTimers();
      process.env.KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS = "-100";
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([]);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60000);
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(2);
    });

    it("falls back to default for non-numeric values", async () => {
      vi.useFakeTimers();
      process.env.KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS = "abc";
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([]);
      requestWakeupSpy.mockResolvedValue({ emitted: true });

      await reconciler.onModuleInit();
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60000);
      expect(
        findOrchestratingStatesForContinuationCleanupSpy,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe("failure handling", () => {
    let loggerWarnSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      loggerWarnSpy = vi.spyOn(Logger.prototype, "warn") as never;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("continues later project cleanup when linked-run reconciliation fails for one project", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-reconcile-fails", status: "orchestrating" },
        { project_id: "project-still-evaluates", status: "orchestrating" },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockImplementation((projectId: string) => {
        if (projectId === "project-reconcile-fails") {
          throw new Error("linked run lookup failed");
        }

        return Promise.resolve({
          reconciled: [],
          skipped: [],
          orphanReconciled: [],
        });
      });

      await expect(reconciler.reconcileStaleContinuations()).resolves.toEqual({
        evaluated: 2,
      });

      expect(reconcileProjectLinkedRunsSpy).toHaveBeenCalledTimes(2);
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenNthCalledWith(
        1,
        "project-reconcile-fails",
      );
      expect(reconcileProjectLinkedRunsSpy).toHaveBeenNthCalledWith(
        2,
        "project-still-evaluates",
      );
      expect(requestWakeupSpy).toHaveBeenCalledTimes(1);
      expect(requestWakeupSpy).toHaveBeenCalledWith({
        projectId: "project-still-evaluates",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        "reconcileProjectLinkedRuns failed for project-reconcile-fails: linked run lookup failed",
      );
    });

    it("logs a warning when reconciliation fails and does not reject", async () => {
      vi.useFakeTimers();
      findOrchestratingStatesForContinuationCleanupSpy.mockRejectedValue(
        new Error("find failed"),
      );

      await reconciler.onModuleInit();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("reconcileStaleContinuations failed"),
      );

      await vi.advanceTimersByTimeAsync(60000);

      expect(loggerWarnSpy).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("reconcileStaleContinuations failed"),
      );
    });
  });

  describe("FAILED workflow retrospective", () => {
    it("marks a pending consecutive failure when reconciled runs have FAILED status", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-failed", status: "orchestrating" },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockResolvedValue({
        reconciled: [{ status: "FAILED" }],
        skipped: [],
        orphanReconciled: [],
      });

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(markPendingConsecutiveFailureSpy).toHaveBeenCalledWith(
        "project-failed",
        expect.objectContaining({ failedRunCount: 1 }),
      );
      expect(markPendingConsecutiveFailureSpy).toHaveBeenCalledTimes(1);
    });

    it("passes the full failed-run count to markPendingConsecutiveFailure", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-multi", status: "orchestrating" },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockResolvedValue({
        reconciled: [
          { status: "FAILED" },
          { status: "COMPLETED" },
          { status: "FAILED" },
          { status: "RUNNING" },
        ],
        skipped: [],
        orphanReconciled: [],
      });

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(markPendingConsecutiveFailureSpy).toHaveBeenCalledTimes(1);
      expect(markPendingConsecutiveFailureSpy).toHaveBeenCalledWith(
        "project-multi",
        expect.objectContaining({ failedRunCount: 2 }),
      );
    });

    it("does not call markPendingConsecutiveFailure when no reconciled runs have FAILED status", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-ok", status: "orchestrating" },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockResolvedValue({
        reconciled: [
          { status: "COMPLETED" },
          { status: "RUNNING" },
          { status: "CANCELLED" },
        ],
        skipped: [],
        orphanReconciled: [],
      });

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(markPendingConsecutiveFailureSpy).not.toHaveBeenCalled();
    });

    it("marks the pending failure with a descriptive reason referencing the stale reconciler", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-with-reason", status: "orchestrating" },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockResolvedValue({
        reconciled: [{ status: "FAILED" }, { status: "FAILED" }],
        skipped: [],
        orphanReconciled: [],
      });

      await reconciler.reconcileStaleContinuations();

      expect(markPendingConsecutiveFailureSpy).toHaveBeenCalledWith(
        "project-with-reason",
        expect.objectContaining({
          failedRunCount: 2,
          reason: expect.stringContaining("stale_reconciler"),
        }),
      );
    });

    it("tolerates markPendingConsecutiveFailure errors and continues", async () => {
      findOrchestratingStatesForContinuationCleanupSpy.mockResolvedValue([
        { project_id: "project-fails-soft", status: "orchestrating" },
      ] as never);
      reconcileProjectLinkedRunsSpy.mockResolvedValue({
        reconciled: [{ status: "FAILED" }],
        skipped: [],
        orphanReconciled: [],
      });
      markPendingConsecutiveFailureSpy.mockRejectedValue(
        new Error("persistence failure"),
      );

      const result = await reconciler.reconcileStaleContinuations();

      expect(result).toEqual({ evaluated: 1 });
      expect(requestWakeupSpy).toHaveBeenCalledWith({
        projectId: "project-fails-soft",
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      });
    });
  });
});
