import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatchService } from "../dispatch/dispatch.service";
import { OrchestrationLeaseService } from "./control-plane/orchestration-lease.service";
import { OrchestrationService } from "./orchestration.service";
import { ProjectOrchestrationWakeupService } from "./project-orchestration-wakeup.service";

describe("ProjectOrchestrationWakeupService", () => {
  const staleReconcilerWakeupCooldownMs = 5 * 60 * 1000;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildService = () => {
    const dispatch = {
      requestOrchestrationCycle: vi.fn().mockResolvedValue(undefined),
    };
    const orchestrationService = {
      getAutoWakeSuppressionState: vi
        .fn()
        .mockResolvedValue({ suppressed: false }),
      getWakeupCooldownState: vi.fn().mockResolvedValue(null),
      recordWakeup: vi.fn().mockResolvedValue(undefined),
    };
    const leaseService = {
      acquireCycleLease: vi
        .fn()
        .mockResolvedValue({ acquired: true, leaseIds: ["l1"] }),
      releaseCycleLease: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ProjectOrchestrationWakeupService(
      dispatch as never,
      orchestrationService as never,
      leaseService as never,
    );

    return { dispatch, orchestrationService, leaseService, service };
  };

  it("declares concrete service metadata for Nest dependency injection", () => {
    const dependencies = Reflect.getMetadata(
      "design:paramtypes",
      ProjectOrchestrationWakeupService,
    ) as unknown[];

    expect(dependencies).toEqual([
      DispatchService,
      OrchestrationService,
      OrchestrationLeaseService,
    ]);
  });

  it("emits a project orchestration cycle request when lease is acquired", async () => {
    const { dispatch, orchestrationService, service } = buildService();

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "workflow_terminal",
      source: "core_lifecycle_stream",
    });

    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "workflow_terminal",
        source: "core_lifecycle_stream",
        dedupeKey: expect.stringContaining(
          "core_lifecycle_stream:workflow_terminal",
        ),
      },
    );
    expect(orchestrationService.recordWakeup).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "workflow_terminal",
        source: "core_lifecycle_stream",
      },
    );
    expect(result).toEqual({ emitted: true });
  });

  it("does not launch when the cycle lease is already held", async () => {
    const { leaseService, dispatch, service } = buildService();
    leaseService.acquireCycleLease.mockResolvedValue({
      acquired: false,
      conflicts: [
        {
          conflictKey: {
            kind: "workflow_scope",
            value: "project_orchestration_cycle_ceo:p1",
          },
          heldByOwnerKind: "workflow_run",
          heldByOwnerId: "run-9",
          expiresAt: new Date().toISOString(),
        },
      ],
    });

    const result = await service.requestWakeup({
      projectId: "p1",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });

    expect(result).toEqual({ emitted: false, reason: "active_cycle_exists" });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
  });

  it("releases the cycle lease when dispatch fails", async () => {
    const { leaseService, dispatch, service } = buildService();
    dispatch.requestOrchestrationCycle.mockRejectedValue(
      new Error("dispatch failed"),
    );

    await expect(
      service.requestWakeup({
        projectId: "p1",
        reason: "workflow_completed",
        source: "core_lifecycle_stream",
      }),
    ).rejects.toThrow("dispatch failed");

    expect(leaseService.releaseCycleLease).toHaveBeenCalledWith("p1");
  });

  it("passes reason only when source is omitted", async () => {
    const { dispatch, orchestrationService, service } = buildService();

    await service.requestWakeup({
      projectId: "project-2",
      reason: "stale_reconciler",
    });

    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-2",
      { reason: "stale_reconciler", source: undefined },
    );
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("propagates wakeup metadata through the dispatch service", async () => {
    const { dispatch, orchestrationService, service } = buildService();

    await service.requestWakeup({
      projectId: "project-3",
      reason: "manual_recovery",
      source: "kanban_controller",
    });

    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledTimes(1);
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-3",
      { reason: "manual_recovery", source: "kanban_controller" },
    );
    expect(orchestrationService.recordWakeup).toHaveBeenCalledWith(
      "project-3",
      {
        reason: "manual_recovery",
        source: "kanban_controller",
      },
    );
  });

  it("passes explicit dedupe keys through to dispatch", async () => {
    const { dispatch, service } = buildService();

    await service.requestWakeup({
      projectId: "project-1",
      reason: "Spec revision workflow completed",
      source: "revision_complete",
      dedupeKey:
        "project-orchestration-cycle:project-1:revision_complete:spec_revision_completed",
    });

    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "Spec revision workflow completed",
        source: "revision_complete",
        dedupeKey:
          "project-orchestration-cycle:project-1:revision_complete:spec_revision_completed",
      },
    );
  });

  it("does not emit automatic wakeups when the latest cycle decision is blocked", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    orchestrationService.getAutoWakeSuppressionState.mockResolvedValue({
      suppressed: true,
      decision: "blocked",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });

    expect(result).toEqual({
      emitted: false,
      reason: "orchestration_auto_wake_suppressed",
    });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("suppresses automatic reconciler wakeups when blocked but preserves manual operator recovery", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    orchestrationService.getAutoWakeSuppressionState.mockResolvedValue({
      suppressed: true,
      decision: "blocked",
    });

    const automaticResult = await service.requestWakeup({
      projectId: "project-1",
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    const manualResult = await service.requestWakeup({
      projectId: "project-1",
      reason: "manual_recovery",
      source: "manual_operator_recovery",
    });

    expect(automaticResult).toEqual({
      emitted: false,
      reason: "orchestration_auto_wake_suppressed",
    });
    expect(manualResult).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledTimes(1);
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
      { reason: "manual_recovery", source: "manual_operator_recovery" },
    );
    expect(orchestrationService.recordWakeup).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "manual_recovery",
        source: "manual_operator_recovery",
      },
    );
  });

  it("preserves manual recovery wakeups when automatic wakeups are suppressed", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    orchestrationService.getAutoWakeSuppressionState.mockResolvedValue({
      suppressed: true,
      decision: "blocked",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "manual_recovery",
      source: "kanban_controller",
    });

    expect(result).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
      { reason: "manual_recovery", source: "kanban_controller" },
    );
    expect(orchestrationService.recordWakeup).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "manual_recovery",
        source: "kanban_controller",
      },
    );
  });

  it("suppresses revision-complete wakeups when automatic wakeups are suppressed", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    orchestrationService.getAutoWakeSuppressionState.mockResolvedValue({
      suppressed: true,
      decision: "blocked",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "Spec revision workflow completed",
      source: "revision_complete",
      dedupeKey:
        "project-orchestration-cycle:project-1:revision_complete:spec_revision_completed",
    });

    expect(result).toEqual({
      emitted: false,
      reason: "orchestration_auto_wake_suppressed",
    });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("preserves source-omitted wakeups when automatic wakeups are suppressed", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    orchestrationService.getAutoWakeSuppressionState.mockResolvedValue({
      suppressed: true,
      decision: "blocked",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "manual_recovery",
    });

    expect(result).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
      { reason: "manual_recovery", source: undefined },
    );
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("coalesces stale reconciler wakeups inside the automatic coalescing window", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date().toISOString(),
      source: "orchestration_continuation_reconciler",
      reason: "stale_reconciler",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(result).toEqual({
      emitted: false,
      reason: "automatic_wakeup_coalesced",
    });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("coalesces automatic stale reconciler wakeups 15 seconds after a lifecycle wakeup", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const now = new Date("2026-05-14T12:00:15.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date(now - 15 * 1000).toISOString(),
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(result).toEqual({
      emitted: false,
      reason: "automatic_wakeup_coalesced",
    });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("coalesces repeated lifecycle wakeups inside the automatic coalescing window", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date().toISOString(),
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });

    expect(result).toEqual({
      emitted: false,
      reason: "automatic_wakeup_coalesced",
    });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("coalesces lifecycle wakeups after recent stale reconciler wakeups", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const now = new Date("2026-05-14T12:00:15.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date(now - 15 * 1000).toISOString(),
      source: "orchestration_continuation_reconciler",
      reason: "stale_reconciler",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });

    expect(result).toEqual({
      emitted: false,
      reason: "automatic_wakeup_coalesced",
    });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("coalesces revision-complete wakeups after recent lifecycle wakeups", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const now = new Date("2026-05-14T12:00:15.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date(now - 15 * 1000).toISOString(),
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "Spec revision workflow completed",
      source: "revision_complete",
    });

    expect(result).toEqual({
      emitted: false,
      reason: "automatic_wakeup_coalesced",
    });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("does not coalesce automatic wakeups when last wakeup timestamp is in the future", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const now = new Date("2026-05-14T12:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date(now + 15 * 1000).toISOString(),
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });

    expect(result).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "workflow_completed",
        source: "core_lifecycle_stream",
        dedupeKey: expect.stringContaining(
          "core_lifecycle_stream:workflow_completed",
        ),
      },
    );
    expect(orchestrationService.recordWakeup).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "workflow_completed",
        source: "core_lifecycle_stream",
      },
    );
  });

  it("does not apply stale wakeup cooldown when last wakeup timestamp is in the future", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const now = new Date("2026-05-14T12:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date(now + 15 * 1000).toISOString(),
      source: "orchestration_continuation_reconciler",
      reason: "stale_reconciler",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(result).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
        dedupeKey: expect.stringContaining(
          "orchestration_continuation_reconciler:stale_reconciler",
        ),
      },
    );
    expect(orchestrationService.recordWakeup).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      },
    );
  });

  it("applies stale wakeup cooldown beyond the automatic coalescing window", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const now = new Date("2026-05-14T12:01:01.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date(now - 61 * 1000).toISOString(),
      source: "orchestration_continuation_reconciler",
      reason: "stale_reconciler",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(result).toEqual({ emitted: false, reason: "stale_wakeup_cooldown" });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("applies stale wakeup cooldown when a lifecycle wakeup followed the recent stale wakeup", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const now = new Date("2026-05-14T12:02:03.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date(now - 62 * 1000).toISOString(),
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
      lastStaleWakeupAt: new Date(now - 123 * 1000).toISOString(),
      lastStaleSource: "orchestration_continuation_reconciler",
      lastStaleReason: "stale_reconciler",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(result).toEqual({ emitted: false, reason: "stale_wakeup_cooldown" });
    expect(dispatch.requestOrchestrationCycle).not.toHaveBeenCalled();
    expect(orchestrationService.recordWakeup).not.toHaveBeenCalled();
  });

  it("emits automatic wakeups outside the coalescing window", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const now = new Date("2026-05-14T12:01:01.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date(now - 61 * 1000).toISOString(),
      source: "core_lifecycle_stream",
      reason: "workflow_completed",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(result).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
        dedupeKey: expect.stringContaining(
          "orchestration_continuation_reconciler:stale_reconciler",
        ),
      },
    );
    expect(orchestrationService.recordWakeup).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      },
    );
  });

  it("records wakeup metadata after a stale reconciler dispatch succeeds", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    orchestrationService.getWakeupCooldownState.mockResolvedValue({
      lastWakeupAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      source: "orchestration_continuation_reconciler",
      reason: "stale_reconciler",
    });

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(result).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
        dedupeKey: expect.stringContaining(
          "orchestration_continuation_reconciler:stale_reconciler",
        ),
      },
    );
    expect(orchestrationService.recordWakeup).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      },
    );
  });

  it("keeps stale reconciler dedupe keys stable inside one accepted window and rotates them after it", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const projectId = "project-1";
    const priorWakeupTime = new Date("2026-05-14T11:59:59.998Z").getTime();
    const firstWakeupTime =
      priorWakeupTime + staleReconcilerWakeupCooldownMs + 1;
    const readLagDuplicateWakeupTime = firstWakeupTime + 2;
    const cooldownDuplicateWakeupTime = firstWakeupTime + 61 * 1000;
    const secondAcceptedWakeupTime =
      firstWakeupTime + staleReconcilerWakeupCooldownMs + 1;
    let now = firstWakeupTime;
    const staleCooldownState = {
      lastWakeupAt: new Date(priorWakeupTime).toISOString(),
      source: "orchestration_continuation_reconciler",
      reason: "stale_reconciler",
    };
    const currentCooldownState = {
      lastWakeupAt: new Date(firstWakeupTime).toISOString(),
      source: "orchestration_continuation_reconciler",
      reason: "stale_reconciler",
    };

    orchestrationService.getWakeupCooldownState
      .mockResolvedValueOnce(staleCooldownState)
      .mockResolvedValueOnce(staleCooldownState)
      .mockResolvedValueOnce(currentCooldownState)
      .mockResolvedValueOnce(currentCooldownState);

    vi.spyOn(Date, "now").mockImplementation(() => now);

    const firstResult = await service.requestWakeup({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });
    now = readLagDuplicateWakeupTime;
    const readLagDuplicateResult = await service.requestWakeup({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });
    now = cooldownDuplicateWakeupTime;
    const cooldownDuplicateResult = await service.requestWakeup({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });
    now = secondAcceptedWakeupTime;
    const secondAcceptedResult = await service.requestWakeup({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(firstResult).toEqual({ emitted: true });
    expect(readLagDuplicateResult).toEqual({ emitted: true });
    expect(cooldownDuplicateResult).toEqual({
      emitted: false,
      reason: "stale_wakeup_cooldown",
    });
    expect(secondAcceptedResult).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledTimes(3);
    const firstCall = dispatch.requestOrchestrationCycle.mock.calls[0];
    const readLagDuplicateCall =
      dispatch.requestOrchestrationCycle.mock.calls[1];
    const secondCall = dispatch.requestOrchestrationCycle.mock.calls[2];
    const firstDedupeKey = firstCall[1]?.dedupeKey;
    const readLagDuplicateDedupeKey = readLagDuplicateCall[1]?.dedupeKey;
    const secondDedupeKey = secondCall[1]?.dedupeKey;

    expect(firstDedupeKey).toContain(
      "orchestration_continuation_reconciler:stale_reconciler",
    );
    expect(readLagDuplicateDedupeKey).toBe(firstDedupeKey);
    expect(secondDedupeKey).not.toBe(firstDedupeKey);
    expect(secondDedupeKey).toContain(
      "orchestration_continuation_reconciler:stale_reconciler",
    );
  });

  it("keeps initial automatic wakeup dedupe keys stable inside one empty cooldown window", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const projectId = "project-1";
    const firstWakeupTime = new Date("2026-05-14T12:00:00.001Z").getTime();
    const secondWakeupTime = firstWakeupTime + 2;
    let now = firstWakeupTime;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    orchestrationService.getWakeupCooldownState
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const firstResult = await service.requestWakeup({
      projectId,
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });
    now = secondWakeupTime;
    const secondResult = await service.requestWakeup({
      projectId,
      reason: "workflow_completed",
      source: "core_lifecycle_stream",
    });

    expect(firstResult).toEqual({ emitted: true });
    expect(secondResult).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledTimes(2);
    const firstDedupeKey =
      dispatch.requestOrchestrationCycle.mock.calls[0][1]?.dedupeKey;
    const secondDedupeKey =
      dispatch.requestOrchestrationCycle.mock.calls[1][1]?.dedupeKey;
    expect(firstDedupeKey).toContain(
      "core_lifecycle_stream:workflow_completed",
    );
    expect(secondDedupeKey).toBe(firstDedupeKey);
  });

  it("keeps initial stale reconciler dedupe keys stable across epoch bucket boundaries", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const projectId = "project-1";
    const epochAlignedBoundary =
      Math.ceil(
        Date.parse("2026-05-14T12:00:00.000Z") /
          staleReconcilerWakeupCooldownMs,
      ) * staleReconcilerWakeupCooldownMs;
    const firstWakeupTime = epochAlignedBoundary - 1;
    const secondWakeupTime = firstWakeupTime + 2;
    let now = firstWakeupTime;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    orchestrationService.getWakeupCooldownState
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const firstResult = await service.requestWakeup({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });
    now = secondWakeupTime;
    const secondResult = await service.requestWakeup({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(firstResult).toEqual({ emitted: true });
    expect(secondResult).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledTimes(2);
    const firstDedupeKey =
      dispatch.requestOrchestrationCycle.mock.calls[0][1]?.dedupeKey;
    const secondDedupeKey =
      dispatch.requestOrchestrationCycle.mock.calls[1][1]?.dedupeKey;
    expect(firstDedupeKey).toContain(
      "orchestration_continuation_reconciler:stale_reconciler",
    );
    expect(secondDedupeKey).toBe(firstDedupeKey);
  });

  it("rotates stale reconciler dedupe keys after an accepted wakeup cooldown window", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const projectId = "project-1";
    const firstWakeupAt = new Date("2026-05-14T12:00:00.000Z");
    const secondWakeupTime =
      firstWakeupAt.getTime() + staleReconcilerWakeupCooldownMs + 1;
    let now = firstWakeupAt.getTime();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    orchestrationService.getWakeupCooldownState
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        source: "orchestration_continuation_reconciler",
        reason: "stale_reconciler",
        lastWakeupAt: firstWakeupAt.toISOString(),
        lastStaleWakeupAt: firstWakeupAt.toISOString(),
        lastStaleReason: "stale_reconciler",
      });

    await service.requestWakeup({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });
    now = secondWakeupTime;
    await service.requestWakeup({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    const firstDedupeKey =
      dispatch.requestOrchestrationCycle.mock.calls[0][1]?.dedupeKey;
    const secondDedupeKey =
      dispatch.requestOrchestrationCycle.mock.calls[1][1]?.dedupeKey;
    expect(firstDedupeKey).toContain(
      "orchestration_continuation_reconciler:stale_reconciler",
    );
    expect(secondDedupeKey).toContain(
      "orchestration_continuation_reconciler:stale_reconciler",
    );
    expect(secondDedupeKey).not.toBe(firstDedupeKey);
  });

  it("rotates fallback stale reconciler dedupe keys after metadata recording fails", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    const projectId = "project-1";
    const firstWakeupTime = new Date("2026-05-14T12:00:00.000Z").getTime();
    const secondWakeupTime =
      firstWakeupTime + staleReconcilerWakeupCooldownMs + 1;
    let now = firstWakeupTime;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    orchestrationService.getWakeupCooldownState
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    orchestrationService.recordWakeup.mockRejectedValue(
      new Error("metadata write failed"),
    );

    const firstResult = await service.requestWakeup({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });
    now = secondWakeupTime;
    const secondResult = await service.requestWakeup({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(firstResult).toEqual({ emitted: true });
    expect(secondResult).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledTimes(2);
    const firstDedupeKey =
      dispatch.requestOrchestrationCycle.mock.calls[0][1]?.dedupeKey;
    const secondDedupeKey =
      dispatch.requestOrchestrationCycle.mock.calls[1][1]?.dedupeKey;
    expect(firstDedupeKey).toContain(
      "orchestration_continuation_reconciler:stale_reconciler",
    );
    expect(secondDedupeKey).not.toBe(firstDedupeKey);
    expect(secondDedupeKey).toContain(
      "orchestration_continuation_reconciler:stale_reconciler",
    );
  });

  it("still reports an emitted wakeup when post-dispatch metadata recording fails", async () => {
    const { dispatch, orchestrationService, service } = buildService();
    orchestrationService.recordWakeup.mockRejectedValue(
      new Error("metadata write failed"),
    );

    const result = await service.requestWakeup({
      projectId: "project-1",
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });

    expect(result).toEqual({ emitted: true });
    expect(dispatch.requestOrchestrationCycle).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
        dedupeKey: expect.stringContaining(
          "orchestration_continuation_reconciler:stale_reconciler",
        ),
      },
    );
    expect(orchestrationService.recordWakeup).toHaveBeenCalledWith(
      "project-1",
      {
        reason: "stale_reconciler",
        source: "orchestration_continuation_reconciler",
      },
    );
  });
});
