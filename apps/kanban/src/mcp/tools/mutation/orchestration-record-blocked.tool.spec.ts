import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationRecordBlockedTool } from "./orchestration-record-blocked.tool";
import { OrchestrationService } from "../../../orchestration/orchestration.service";

interface MockOrchestration {
  recordImportHydrationBlocked: ReturnType<typeof vi.fn>;
  recordCycleDecision: ReturnType<typeof vi.fn>;
}

describe("OrchestrationRecordBlockedTool", () => {
  const context = {} as InternalToolExecutionContext;

  it("records blocked import hydration metadata and blocked cycle decision", async () => {
    const orchestration: MockOrchestration = {
      recordImportHydrationBlocked: vi.fn().mockResolvedValue(undefined),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "blocked",
        reason: "imported_repo_hydration blocked orchestration continuation",
        persisted: true,
        duplicate: false,
      }),
    };

    const tool = new OrchestrationRecordBlockedTool(
      orchestration as unknown as OrchestrationService,
    );

    const result = await tool.execute(context, {
      project_id: "project-1",
      blocked_stage: "imported_repo_hydration",
      ready_for_cycle: false,
      child_run_id: "child-run-1",
    });

    expect(orchestration.recordImportHydrationBlocked).toHaveBeenCalledTimes(1);
    expect(orchestration.recordImportHydrationBlocked).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        blocked_stage: "imported_repo_hydration",
        blocked_reason: undefined,
        ready_for_cycle: false,
        child_run_id: "child-run-1",
      }),
    );

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        decision: "blocked",
        reason: "imported_repo_hydration blocked orchestration continuation",
        idempotencyKey: "imported-hydration-blocked:project-1:child-run-1",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      project_id: "project-1",
      blocked_stage: "imported_repo_hydration",
    });
  });

  it("falls back to a default reason when blocked_reason is blank", async () => {
    const orchestration: MockOrchestration = {
      recordImportHydrationBlocked: vi.fn().mockResolvedValue(undefined),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "blocked",
        reason: "imported_repo_hydration blocked orchestration continuation",
        persisted: true,
        duplicate: false,
      }),
    };
    const tool = new OrchestrationRecordBlockedTool(
      orchestration as unknown as OrchestrationService,
    );

    await tool.execute(context, {
      project_id: "project-1",
      blocked_stage: "imported_repo_hydration",
      blocked_reason: "   ",
      ready_for_cycle: false,
      child_run_id: "child-run-1",
    });

    expect(orchestration.recordImportHydrationBlocked).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        blocked_reason: undefined,
      }),
    );

    const decisionCall = orchestration.recordCycleDecision.mock.calls[0]?.[1];
    expect(decisionCall).toMatchObject({
      decision: "blocked",
      reason: "imported_repo_hydration blocked orchestration continuation",
      idempotencyKey: "imported-hydration-blocked:project-1:child-run-1",
    });
  });

  it("uses hydration_child_run_id when child_run_id is blank", async () => {
    const orchestration: MockOrchestration = {
      recordImportHydrationBlocked: vi.fn().mockResolvedValue(undefined),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "blocked",
        reason: "blocked by hydration",
        persisted: true,
        duplicate: false,
      }),
    };
    const tool = new OrchestrationRecordBlockedTool(
      orchestration as unknown as OrchestrationService,
    );

    await tool.execute(context, {
      project_id: "project-2",
      blocked_stage: "imported_repo_hydration",
      blocked_reason: "blocked by hydration",
      ready_for_cycle: false,
      child_run_id: "   ",
      hydration_child_run_id: "hydration-run-1",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-2",
      expect.objectContaining({
        idempotencyKey: "imported-hydration-blocked:project-2:hydration-run-1",
      }),
    );
  });

  it("omits idempotencyKey when no child run id is available", async () => {
    const orchestration: MockOrchestration = {
      recordImportHydrationBlocked: vi.fn().mockResolvedValue(undefined),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "blocked",
        reason: "imported_repo_hydration blocked orchestration continuation",
        persisted: true,
        duplicate: false,
      }),
    };
    const tool = new OrchestrationRecordBlockedTool(
      orchestration as unknown as OrchestrationService,
    );

    await tool.execute(context, {
      project_id: "project-3",
      blocked_stage: "imported_repo_hydration",
      ready_for_cycle: false,
    });

    expect(orchestration.recordImportHydrationBlocked).toHaveBeenCalledWith(
      "project-3",
      expect.objectContaining({
        blocked_reason: undefined,
      }),
    );

    const decisionCall = orchestration.recordCycleDecision.mock.calls[0]?.[1];
    expect(decisionCall).toMatchObject({
      decision: "blocked",
      reason: "imported_repo_hydration blocked orchestration continuation",
    });
    expect(decisionCall).not.toHaveProperty("idempotencyKey");
  });
});
