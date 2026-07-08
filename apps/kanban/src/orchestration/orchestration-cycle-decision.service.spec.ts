import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { OrchestrationCycleDecisionService } from "./orchestration-cycle-decision.service";
import type {
  CycleDecision,
  DecisionEntry,
  OrchestrationPersistenceRecord,
} from "./orchestration-internal.types";

type CycleDecisionInput = NonNullable<
  Parameters<OrchestrationCycleDecisionService["recordCycleDecision"]>[0]["input"]
>;

type CycleDecisionArgs = Parameters<
  OrchestrationCycleDecisionService["recordCycleDecision"]
>[0];

const PROJECT_ID = "project-failure-threshold";
const ORCHESTRATION_ID = "project-failure-threshold";

function makeOrchestration(
  overrides: Partial<OrchestrationPersistenceRecord> = {},
): OrchestrationPersistenceRecord {
  return {
    project_id: ORCHESTRATION_ID,
    goals: "ship it",
    mode: "autonomous",
    status: "orchestrating",
    linked_run_id: null,
    decision_log: [],
    action_requests: [],
    metadata: {},
    created_at: new Date("2026-06-17T12:00:00.000Z"),
    updated_at: new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  };
}

type ServiceOverrides = {
  findWorkItemsByProjectId?: Mock;
  findDependenciesByWorkItemIds?: Mock;
  runCompletionRetrospective?: Mock;
  checkFailureThreshold?: Mock;
  resetConsecutiveFailureCount?: Mock;
  clearPendingConsecutiveFailure?: Mock;
};

function makeService(overrides: ServiceOverrides = {}) {
  const findWorkItemsByProjectId =
    overrides.findWorkItemsByProjectId ??
    vi.fn().mockResolvedValue([]);
  const findDependenciesByWorkItemIds =
    overrides.findDependenciesByWorkItemIds ??
    vi.fn().mockResolvedValue([]);
  const runCompletionRetrospective =
    overrides.runCompletionRetrospective ??
    vi.fn().mockResolvedValue(undefined);
  const checkFailureThreshold =
    overrides.checkFailureThreshold ??
    vi.fn().mockResolvedValue(undefined);
  const resetConsecutiveFailureCount =
    overrides.resetConsecutiveFailureCount ??
    vi.fn().mockResolvedValue(undefined);
  const clearPendingConsecutiveFailure =
    overrides.clearPendingConsecutiveFailure ??
    vi.fn().mockResolvedValue(undefined);
  const failureThresholdService = {
    checkFailureThreshold,
    resetConsecutiveFailureCount,
  };
  const workItems = {
    findByproject_id: findWorkItemsByProjectId,
    findDependenciesByWorkItemIds,
  };
  const retrospectives = {
    runForCompletion: runCompletionRetrospective,
  };

  const service = new OrchestrationCycleDecisionService(
    workItems as never,
    retrospectives as never,
    failureThresholdService,
    clearPendingConsecutiveFailure as never,
  );

  return {
    service,
    findWorkItemsByProjectId,
    findDependenciesByWorkItemIds,
    runCompletionRetrospective,
    checkFailureThreshold,
    resetConsecutiveFailureCount,
    clearPendingConsecutiveFailure,
  };
}

function makeArgs(input: {
  input: CycleDecisionInput;
  existing?: OrchestrationPersistenceRecord;
  metadata?: Record<string, unknown>;
}): CycleDecisionArgs {
  const existing = input.existing ?? makeOrchestration();
  const metadata = input.metadata ?? {};
  return {
    projectId: PROJECT_ID,
    existing,
    metadata,
    input: input.input,
    getDecisionLog: (state) =>
      state.decision_log ?? [],
    savePersistenceState: vi
      .fn()
      .mockImplementation(
        (
          state: OrchestrationPersistenceRecord,
          updates: Partial<OrchestrationPersistenceRecord>,
        ) => {
          return Promise.resolve({
            ...state,
            ...updates,
            decision_log: updates.decision_log ?? state.decision_log,
            action_requests: updates.action_requests ?? state.action_requests,
            metadata: updates.metadata ?? state.metadata,
          });
        },
      ),
  };
}

describe("OrchestrationCycleDecisionService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T12:00:00.000Z"));
  });

  // ---------------------------------------------------------------------------
  // recordCycleDecision — failure-threshold trigger
  // Work item 2b8d0c51 / EPIC-117 / EPIC-202
  // ---------------------------------------------------------------------------

  describe("recordCycleDecision failure-threshold trigger", () => {
    it("calls checkFailureThreshold(projectId) when consecutiveFailure is true", async () => {
      const { service, checkFailureThreshold } = makeService();
      const args = makeArgs({
        input: {
          decision: "blocked",
          reason: "Previous workflow run FAILED",
          consecutiveFailure: true,
        },
      });

      await service.recordCycleDecision(args);

      expect(checkFailureThreshold).toHaveBeenCalledWith(PROJECT_ID);
    });

    it("does not call checkFailureThreshold when consecutiveFailure is omitted", async () => {
      const { service, checkFailureThreshold } = makeService();
      const args = makeArgs({
        input: { decision: "repeat", reason: "Has dispatchable work" },
      });

      await service.recordCycleDecision(args);

      expect(checkFailureThreshold).not.toHaveBeenCalled();
    });

    it("does not call checkFailureThreshold when consecutiveFailure is false", async () => {
      const { service, checkFailureThreshold } = makeService();
      const args = makeArgs({
        input: {
          decision: "blocked",
          reason: "Hard blocker",
          consecutiveFailure: false,
        },
      });

      await service.recordCycleDecision(args);

      expect(checkFailureThreshold).not.toHaveBeenCalled();
    });

    it("calls checkFailureThreshold before the cycle decision result is returned (synchronous trigger)", async () => {
      const callOrder: string[] = [];
      const { service } = makeService({
        checkFailureThreshold: vi.fn(() => {
          callOrder.push("checkFailureThreshold");
          return Promise.resolve();
        }),
        runCompletionRetrospective: vi.fn(() => {
          callOrder.push("runCompletionRetrospective");
          return Promise.resolve();
        }),
      });
      const args = makeArgs({
        input: {
          decision: "blocked",
          reason: "FAILED",
          consecutiveFailure: true,
          idempotencyKey: "cycle-key-1",
        },
      });

      const result = await service.recordCycleDecision(args);

      expect(callOrder).toEqual(["checkFailureThreshold"]);
      expect(result).toMatchObject({
        decision: "blocked",
        persisted: true,
        duplicate: false,
      });
    });

    it("logs and swallows checkFailureThreshold errors so the cycle decision persists", async () => {
      // When the retrospective service throws, the failure-threshold
      // trigger must log and swallow the error so the cycle decision
      // still persists. We build the deps inline (rather than via
      // makeService) so the failing spy is the only mock being
      // exercised.
      const failingCheckFailureThreshold: Mock = vi
        .fn()
        .mockRejectedValue(new Error("retrospective service unavailable"));
      const errorSpy = vi.spyOn(Logger.prototype, "error");
      const service = new OrchestrationCycleDecisionService(
        {
          findByproject_id: vi.fn().mockResolvedValue([]),
          findDependenciesByWorkItemIds: vi.fn().mockResolvedValue([]),
        } as never,
        { runForCompletion: vi.fn().mockResolvedValue(undefined) } as never,
        {
          checkFailureThreshold: failingCheckFailureThreshold,
          resetConsecutiveFailureCount: vi.fn().mockResolvedValue(undefined),
        },
        vi.fn().mockResolvedValue(undefined) as never,
      );
      const args = makeArgs({
        input: {
          decision: "blocked",
          reason: "FAILED",
          consecutiveFailure: true,
        },
      });

      const result = await service.recordCycleDecision(args);

      expect(result).toMatchObject({
        decision: "blocked",
        persisted: true,
      });
      const failureCalls = failingCheckFailureThreshold.mock.calls.length;
      expect(failureCalls).toBe(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Pending consecutive-failure drain (state-driven path)
  // ---------------------------------------------------------------------------

  describe("recordCycleDecision drains pending consecutive failures", () => {
    it("replays the pending count as successive checkFailureThreshold calls", async () => {
      const { service, checkFailureThreshold, clearPendingConsecutiveFailure } =
        makeService();
      const metadata: Record<string, unknown> = {
        pending_consecutive_failure_count: 3,
        pending_consecutive_failure_reason: "stale_reconciler: 3 failed run(s)",
      };
      const args = makeArgs({
        input: { decision: "repeat", reason: "Has dispatchable work" },
        metadata,
      });

      await service.recordCycleDecision(args);

      expect(checkFailureThreshold).toHaveBeenCalledTimes(3);
      expect(checkFailureThreshold).toHaveBeenNthCalledWith(
        1,
        PROJECT_ID,
        expect.any(String),
      );
      expect(checkFailureThreshold).toHaveBeenNthCalledWith(
        2,
        PROJECT_ID,
        expect.any(String),
      );
      expect(checkFailureThreshold).toHaveBeenNthCalledWith(
        3,
        PROJECT_ID,
        expect.any(String),
      );
      expect(clearPendingConsecutiveFailure).toHaveBeenCalledWith(PROJECT_ID);
    });

    it("is a no-op when pending_consecutive_failure_count is 0 or missing", async () => {
      const { service, checkFailureThreshold, clearPendingConsecutiveFailure } =
        makeService();
      const args = makeArgs({
        input: { decision: "repeat", reason: "Has dispatchable work" },
        metadata: {},
      });

      await service.recordCycleDecision(args);

      expect(checkFailureThreshold).not.toHaveBeenCalled();
      expect(clearPendingConsecutiveFailure).not.toHaveBeenCalled();
    });

    it("drains pending failures even when the cycle decision is a duplicate (replay path)", async () => {
      const { service, checkFailureThreshold } = makeService();
      const metadata: Record<string, unknown> = {
        pending_consecutive_failure_count: 2,
        cycle_decision_idempotency_key: "duplicated-key",
      };
      const args = makeArgs({
        input: {
          decision: "blocked",
          reason: "duplicated",
          idempotencyKey: "duplicated-key",
        },
        metadata,
        existing: makeOrchestration({
          decision_log: [
            {
              timestamp: "2026-06-17T11:55:00.000Z",
              type: "cycle_decision",
              reasoning: "Earlier blocked decision",
              actions: ["blocked"],
              cycleDecision: "blocked",
              idempotencyKey: "duplicated-key",
            },
          ],
        }),
      });

      const result = await service.recordCycleDecision(args);

      // The drain runs BEFORE the duplicate-replay check, so the
      // threshold trigger still fires when a duplicate cycle decision
      // is observed but pending failures are queued.
      expect(checkFailureThreshold).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ duplicate: true });
    });

    it("tolerates clearPendingConsecutiveFailure errors after the drain", async () => {
      const { service, checkFailureThreshold, clearPendingConsecutiveFailure } =
        makeService({
          clearPendingConsecutiveFailure: vi
            .fn()
            .mockRejectedValue(new Error("persistence failure")),
        });
      const args = makeArgs({
        input: { decision: "repeat", reason: "Has dispatchable work" },
        metadata: { pending_consecutive_failure_count: 1 },
      });

      const result = await service.recordCycleDecision(args);

      expect(checkFailureThreshold).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ decision: "repeat", persisted: true });
    });
  });

  // ---------------------------------------------------------------------------
  // Counter reset on successful cycle completion
  // ---------------------------------------------------------------------------

  describe("recordCycleDecision resets the counter on a complete decision", () => {
    it("calls resetConsecutiveFailureCount when the safe decision is complete", async () => {
      const { service, resetConsecutiveFailureCount } = makeService();
      const args = makeArgs({
        input: {
          decision: "complete",
          reason: "Project finished",
          idempotencyKey: "cycle-complete-1",
        },
      });

      await service.recordCycleDecision(args);

      expect(resetConsecutiveFailureCount).toHaveBeenCalledWith(PROJECT_ID);
    });

    it("does not call resetConsecutiveFailureCount for non-complete decisions", async () => {
      const { service, resetConsecutiveFailureCount } = makeService();
      const decisions: ReadonlyArray<"repeat" | "pause" | "blocked"> = [
        "repeat",
        "pause",
        "blocked",
      ];
      const results = await Promise.all(
        decisions.map((decision) =>
          service.recordCycleDecision(
            makeArgs({
              input: {
                decision,
                reason: `${decision} reason`,
                idempotencyKey: `cycle-${decision}-1`,
              },
            }),
          ),
        ),
      );
      expect(results).toHaveLength(decisions.length);
      expect(resetConsecutiveFailureCount).not.toHaveBeenCalled();
    });

    it("prefers checkFailureThreshold over reset when consecutiveFailure is true on a complete decision", async () => {
      // Edge case: a workflow run that both ended in FAILED and was the
      // project's last cycle (e.g. after reconciliation marked it
      // complete). The failure path wins so the failure count is
      // recorded; the reset is skipped to avoid zeroing a brand-new
      // failure streak.
      const { service, checkFailureThreshold, resetConsecutiveFailureCount } =
        makeService();
      const args = makeArgs({
        input: {
          decision: "complete",
          reason: "Project complete after a failure",
          idempotencyKey: "cycle-complete-with-failure",
          consecutiveFailure: true,
        },
      });

      await service.recordCycleDecision(args);

      expect(checkFailureThreshold).toHaveBeenCalledWith(PROJECT_ID);
      expect(resetConsecutiveFailureCount).not.toHaveBeenCalled();
    });

    it("logs and swallows reset errors so the cycle decision still persists", async () => {
      const failingReset: Mock = vi
        .fn()
        .mockRejectedValue(new Error("reset failed"));
      const warnSpy = vi.spyOn(Logger.prototype, "warn");
      const service = new OrchestrationCycleDecisionService(
        {
          findByproject_id: vi.fn().mockResolvedValue([]),
          findDependenciesByWorkItemIds: vi.fn().mockResolvedValue([]),
        } as never,
        { runForCompletion: vi.fn().mockResolvedValue(undefined) } as never,
        {
          checkFailureThreshold: vi.fn().mockResolvedValue(undefined),
          resetConsecutiveFailureCount: failingReset,
        },
        vi.fn().mockResolvedValue(undefined) as never,
      );
      const args = makeArgs({
        input: {
          decision: "complete",
          reason: "Project finished",
          idempotencyKey: "cycle-complete-reset-error",
        },
      });

      const result = await service.recordCycleDecision(args);

      expect(result).toMatchObject({ decision: "complete", persisted: true });
      const resetCalls = failingReset.mock.calls.length;
      expect(resetCalls).toBe(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // safeDecision: dispatched decision still preserves failure semantics
  // ---------------------------------------------------------------------------

  describe("recordCycleDecision safety guards preserve failure trigger", () => {
    it("still calls checkFailureThreshold when resolveSafeCycleDecision downgrades a complete to blocked", async () => {
      // resolveSafeCycleDecision only downgrades `complete` when the
      // project has goals but no work items and imported-repo context.
      // Even on the downgraded `blocked` decision, the failure trigger
      // (when set) must still fire because the workflow run still failed.
      const { service, checkFailureThreshold } = makeService({
        findWorkItemsByProjectId: vi.fn().mockResolvedValue([]),
      });
      const args = makeArgs({
        input: {
          decision: "complete",
          reason: "Premature complete",
          consecutiveFailure: true,
          idempotencyKey: "downgrade-key",
        },
        existing: makeOrchestration({
          goals: "Goal A\nGoal B",
          metadata: { sourceContext: { sourceType: "import_remote" } },
        }),
      });

      const result = await service.recordCycleDecision(args);

      expect(result).toMatchObject({ decision: "blocked", persisted: true });
      expect(checkFailureThreshold).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  // Placeholder for a real (cycle-decision) safe-decision test when the
  // test suite grows; kept to assert that the import path remains live
  // for the cycle-decision service's types.
  it("exposes a typed CycleDecision union", () => {
    const sample: CycleDecision = "blocked";
    expect(sample).toBe("blocked");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
