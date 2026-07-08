import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { WorkItemService } from "../../../work-item/work-item.service";
import type {
  WorkItemRecord,
  WorkItemStatus,
} from "../../../work-item/work-item.types";
import { OrchestrationRecordCycleDecisionSchema } from "../shared/schemas";
import { OrchestrationRecordCycleDecisionTool } from "./orchestration-record-cycle-decision.tool";

interface MockOrchestration {
  recordCycleDecision: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

interface MockWorkItems {
  listWorkItems: ReturnType<typeof vi.fn>;
}

describe("OrchestrationRecordCycleDecisionTool", () => {
  const context = {} as InternalToolExecutionContext;

  function createMockOrchestration(): MockOrchestration {
    return {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "supervised" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "repeat",
        reason: "Work remains",
        persisted: true,
        duplicate: false,
      }),
    };
  }

  function createWorkItem(id: string, status: WorkItemStatus): WorkItemRecord {
    return {
      id,
      project_id: "project-1",
      title: `${status} item ${id}`,
      description: null,
      status,
      scope: "standard",
      priority: "p1",
      assignedAgentId: null,
      tokenSpend: 0,
      currentExecutionId: null,
      waitingForInput: false,
      executionConfig: null,
      metadata: null,
      lastExecutionStatus: null,
      dependsOn: [],
      blockedBy: [],
      blocks: [],
      blockers: [],
      subtasks: [],
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
      linkedRunId: null,
    };
  }

  function createMockWorkItems(items: WorkItemRecord[] = []): MockWorkItems {
    return {
      listWorkItems: vi.fn().mockResolvedValue(items),
    };
  }

  function createTool(overrides?: {
    orchestration?: MockOrchestration;
    workItems?: MockWorkItems;
  }): {
    tool: OrchestrationRecordCycleDecisionTool;
    orchestration: MockOrchestration;
    workItems: MockWorkItems;
  } {
    const orchestration = overrides?.orchestration ?? createMockOrchestration();
    const workItems = overrides?.workItems ?? createMockWorkItems();
    const tool = new OrchestrationRecordCycleDecisionTool(
      orchestration as unknown as OrchestrationService,
      workItems as unknown as WorkItemService,
    );
    return { tool, orchestration, workItems };
  }

  it("has tool name kanban.orchestration_record_cycle_decision from both getName and getDefinition", () => {
    const { tool } = createTool();
    expect(tool.getName()).toBe("kanban.orchestration_record_cycle_decision");
    expect(tool.getDefinition().name).toBe(
      "kanban.orchestration_record_cycle_decision",
    );
  });

  it("calls service recordCycleDecision with mapped params and returns ok result", async () => {
    const orchestration = createMockOrchestration();
    const { tool } = createTool({ orchestration });

    const result = await tool.execute(context, {
      project_id: "project-1",
      decision: "repeat",
      reason: "2 spec(s) remain for implementation",
      idempotency_key: "cycle-repeat-project-1-run-1",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      {
        decision: "repeat",
        reason: "2 spec(s) remain for implementation",
        idempotencyKey: "cycle-repeat-project-1-run-1",
        autonomousDefault: undefined,
        readyWorkRemaining: undefined,
      },
    );
    expect(result).toMatchObject({
      ok: true,
      project_id: "project-1",
      decision: "repeat",
      persisted: true,
      duplicate: false,
    });
  });

  it("derives project_id from context.scopeId when project_id is blank", async () => {
    const orchestration = createMockOrchestration();
    const workItems = createMockWorkItems([createWorkItem("todo-1", "todo")]);
    const { tool } = createTool({ orchestration, workItems });

    await tool.execute(
      { scopeId: "project-from-context" },
      {
        project_id: "   ",
        decision: "repeat",
        reason: "Work remains",
      },
    );

    expect(orchestration.get).toHaveBeenCalledWith("project-from-context");
    expect(workItems.listWorkItems).toHaveBeenCalledWith(
      "project-from-context",
    );
    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-from-context",
      expect.objectContaining({ decision: "repeat" }),
    );
  });

  it("calls service with minimal params when optional fields are omitted", async () => {
    const orchestration = createMockOrchestration();
    orchestration.recordCycleDecision.mockResolvedValue({
      decision: "complete",
      reason: "All done",
      persisted: true,
      duplicate: false,
    });
    const { tool } = createTool({ orchestration });

    const result = await tool.execute(context, {
      project_id: "project-2",
      decision: "complete",
      reason: "All specs resolved",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-2",
      {
        decision: "complete",
        reason: "All specs resolved",
        idempotencyKey: undefined,
        autonomousDefault: undefined,
        readyWorkRemaining: undefined,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      project_id: "project-2",
      decision: "complete",
      persisted: true,
    });
  });

  it("maps autonomous_default and ready_work_remaining to service input for default-to-repeat calls", async () => {
    const orchestration = createMockOrchestration();
    orchestration.recordCycleDecision.mockResolvedValue({
      decision: "repeat",
      reason: "autonomous cycle with ready work",
      persisted: true,
      duplicate: false,
    });
    const { tool } = createTool({ orchestration });

    const result = await tool.execute(context, {
      project_id: "project-auto",
      reason: "autonomous cycle with ready work",
      autonomous_default: true,
      ready_work_remaining: true,
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-auto",
      {
        decision: undefined,
        reason: "autonomous cycle with ready work",
        idempotencyKey: undefined,
        autonomousDefault: true,
        readyWorkRemaining: true,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      project_id: "project-auto",
      decision: "repeat",
      persisted: true,
    });
  });

  it("passes skipped result through when service skips autonomous default", async () => {
    const orchestration = createMockOrchestration();
    orchestration.recordCycleDecision.mockResolvedValue({
      decision: "repeat",
      reason: "blocked by explicit stop",
      persisted: false,
      duplicate: false,
      skipped: true,
    });
    const { tool } = createTool({ orchestration });

    const result = await tool.execute(context, {
      project_id: "project-skipped",
      reason: "autonomous cycle",
      autonomous_default: true,
      ready_work_remaining: true,
    });

    expect(result).toMatchObject({
      ok: true,
      project_id: "project-skipped",
      persisted: false,
      duplicate: false,
      skipped: true,
    });
  });

  it("returns duplicate flag when service detects duplicate decision", async () => {
    const orchestration = createMockOrchestration();
    orchestration.recordCycleDecision.mockResolvedValue({
      decision: "repeat",
      reason: "Work remains",
      persisted: false,
      duplicate: true,
    });
    const { tool } = createTool({ orchestration });

    const result = await tool.execute(context, {
      project_id: "project-3",
      decision: "repeat",
      reason: "Work remains",
      idempotency_key: "cycle-repeat-project-3-run-1",
    });

    expect(result).toMatchObject({
      ok: true,
      project_id: "project-3",
      persisted: false,
      duplicate: true,
    });
  });

  it("rejects generic repeat decisions on backlog-only boards", async () => {
    const orchestration = createMockOrchestration();
    const workItems = createMockWorkItems([
      createWorkItem("backlog-1", "backlog"),
    ]);
    const { tool } = createTool({ orchestration, workItems });

    await expect(
      tool.execute(context, {
        project_id: "project-1",
        decision: "repeat",
        reason: "No board action available",
      }),
    ).rejects.toThrow(
      "Backlog-only repeat decisions must review backlog candidates",
    );

    expect(workItems.listWorkItems).toHaveBeenCalledWith("project-1");
    expect(orchestration.recordCycleDecision).not.toHaveBeenCalled();
  });

  it("allows repeat decisions when a todo item already exists", async () => {
    const orchestration = createMockOrchestration();
    const workItems = createMockWorkItems([
      createWorkItem("todo-1", "todo"),
      createWorkItem("backlog-1", "backlog"),
    ]);
    const { tool } = createTool({ orchestration, workItems });

    await tool.execute(context, {
      project_id: "project-1",
      decision: "repeat",
      reason: "Dispatchable todo remains",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
  });

  it("allows repeat decisions when no backlog work exists", async () => {
    const orchestration = createMockOrchestration();
    const workItems = createMockWorkItems([
      createWorkItem("blocked-1", "blocked"),
    ]);
    const { tool } = createTool({ orchestration, workItems });

    await tool.execute(context, {
      project_id: "project-1",
      decision: "repeat",
      reason: "Only blocked human-decision work remains",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
  });

  it("allows backlog-only repeat decisions with ticket-level blocker evidence", async () => {
    const orchestration = createMockOrchestration();
    const workItems = createMockWorkItems([
      createWorkItem("backlog-1", "backlog"),
    ]);
    const { tool } = createTool({ orchestration, workItems });

    await tool.execute(context, {
      project_id: "project-1",
      decision: "repeat",
      reason:
        "Reviewed candidate backlog-1: ticket-level blocker is active branch ownership; no safe candidate remains.",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
  });

  it("does not apply the backlog-only repeat guard to terminal decisions", async () => {
    const orchestration = createMockOrchestration();
    const workItems = createMockWorkItems([
      createWorkItem("backlog-1", "backlog"),
    ]);
    const { tool } = createTool({ orchestration, workItems });

    await tool.execute(context, {
      project_id: "project-1",
      decision: "blocked",
      reason: "Human decision required",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
  });

  it("converts blocked decision to repeat when project is autonomous and only feedback-needed imported items are active", async () => {
    const orchestration = createMockOrchestration();
    orchestration.get.mockResolvedValue({ orchestrationMode: "autonomous" });
    const workItems = createMockWorkItems([
      {
        ...createWorkItem("blocked-1", "blocked"),
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:scope-1",
          importedRepoReconciliation: true,
          feedbackNeeded: true,
        },
      },
    ]);
    const { tool } = createTool({ orchestration, workItems });

    await tool.execute(context, {
      project_id: "project-1",
      decision: "blocked",
      reason: "all findings require review",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ decision: "repeat" }),
    );
  });

  it("parses the input schema with compact fields", () => {
    const parsed = toolSchema().parse({
      project_id: "proj-1",
      decision: "repeat",
      reason: "Work remains",
      idempotency_key: "key-1",
    });

    expect(parsed).toMatchObject({
      project_id: "proj-1",
      decision: "repeat",
      reason: "Work remains",
      idempotency_key: "key-1",
    });

    const minimal = toolSchema().parse({
      project_id: "proj-2",
      decision: "pause",
      reason: "Paused by request",
    });

    expect(minimal).toMatchObject({
      project_id: "proj-2",
      decision: "pause",
      reason: "Paused by request",
    });
    expect(minimal.idempotency_key).toBeUndefined();
    expect(minimal.autonomous_default).toBeUndefined();
    expect(minimal.ready_work_remaining).toBeUndefined();

    const autonomousWithoutDecision = toolSchema().parse({
      project_id: "proj-3",
      reason: "autonomous default cycle",
      autonomous_default: true,
      ready_work_remaining: true,
    });

    expect(autonomousWithoutDecision.decision).toBeUndefined();
    expect(autonomousWithoutDecision.autonomous_default).toBe(true);
    expect(autonomousWithoutDecision.ready_work_remaining).toBe(true);
  });

  it("rejects invalid decision values in the schema", () => {
    expect(() =>
      toolSchema().parse({
        project_id: "proj-1",
        decision: "invalid",
        reason: "Bad decision",
      }),
    ).toThrow();
  });

  it("rejects omitted decision without autonomous_default and ready_work_remaining", () => {
    expect(() =>
      toolSchema().parse({
        project_id: "proj-1",
        reason: "No decision and no autonomous default",
      }),
    ).toThrow();
  });

  it("rejects omitted decision with autonomous_default but without ready_work_remaining", () => {
    expect(() =>
      toolSchema().parse({
        project_id: "proj-1",
        reason: "Autonomous default without ready work",
        autonomous_default: true,
      }),
    ).toThrow();
  });

  it("rejects omitted decision with ready_work_remaining but without autonomous_default", () => {
    expect(() =>
      toolSchema().parse({
        project_id: "proj-1",
        reason: "Ready work without autonomous default",
        ready_work_remaining: true,
      }),
    ).toThrow();
  });

  it("rejects explicit decision with autonomous_default true", () => {
    expect(() =>
      toolSchema().parse({
        project_id: "proj-1",
        decision: "pause",
        reason: "Explicit stop with auto flag",
        autonomous_default: true,
      }),
    ).toThrow();

    expect(() =>
      toolSchema().parse({
        project_id: "proj-1",
        decision: "repeat",
        reason: "Explicit repeat with auto flag",
        autonomous_default: true,
      }),
    ).toThrow();
  });

  it("rejects whitespace-only reason", () => {
    expect(() =>
      toolSchema().parse({
        project_id: "proj-1",
        decision: "repeat",
        reason: "   ",
      }),
    ).toThrow();
  });

  it("rejects whitespace-only project_id", () => {
    const parsed = toolSchema().parse({
      project_id: "  ",
      decision: "repeat",
      reason: "Valid reason",
    });

    expect(parsed.project_id).toBeUndefined();
  });

  it("rejects whitespace-only idempotency_key", () => {
    expect(() =>
      toolSchema().parse({
        project_id: "proj-1",
        decision: "repeat",
        reason: "Valid reason",
        idempotency_key: "  ",
      }),
    ).toThrow();
  });

  it("trims and accepts valid reason with surrounding whitespace", () => {
    const parsed = toolSchema().parse({
      project_id: "proj-1",
      decision: "repeat",
      reason: "  valid reason  ",
    });
    expect(parsed.reason).toBe("valid reason");
  });

  it("resolves OrchestrationService through Nest DI constructor injection", async () => {
    const mockRecordCycleDecision = vi.fn().mockResolvedValue({
      decision: "repeat",
      reason: "test",
      persisted: true,
      duplicate: false,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrchestrationRecordCycleDecisionTool,
        {
          provide: OrchestrationService,
          useFactory: () => ({ recordCycleDecision: mockRecordCycleDecision }),
        },
        {
          provide: WorkItemService,
          useFactory: () => ({ listWorkItems: vi.fn().mockResolvedValue([]) }),
        },
      ],
    }).compile();

    const tool = moduleRef.get(OrchestrationRecordCycleDecisionTool);
    expect(tool).toBeInstanceOf(OrchestrationRecordCycleDecisionTool);
    expect(tool.getName()).toBe("kanban.orchestration_record_cycle_decision");
  });

  it("getDefinition includes tierRestriction and transport metadata", () => {
    const { tool } = createTool();
    const definition = tool.getDefinition();
    expect(definition.tierRestriction).toBe(2);
    expect(definition.transport).toBe("runner_local");
    expect(definition.runtimeOwner).toBe("runner");
    expect(definition.inputSchema).toBe(OrchestrationRecordCycleDecisionSchema);
  });

  function toolSchema() {
    const { tool } = createTool();
    return tool.getDefinition().inputSchema;
  }

  /**
   * M1: Runtime guard contract — reject no-op `repeat` decisions on backlog-only boards.
   *
   * Work item: 67bfb3b7-f713-4001-a7a3-eaf668b0902f
   * Incident: 2026-05-15 — bare `repeat` with reason "No board action available"
   *           was accepted by the CEO cycle tool despite 33 unblocked backlog items.
   *
   * This block is intentionally a nested `describe` from the rest of the file so the
   * acceptance criteria (AC-1..AC-4) are discoverable as a self-contained contract.
   *
   * TDD Red phase: the no-op repeat guard is intentionally NOT YET implemented in
   * `OrchestrationRecordCycleDecisionTool` (the `assertRepeatDecisionIsActionable`
   * method and its helpers have been removed from the production target for this
   * milestone). The REJECT test (AC-1) is expected to FAIL in this phase and will
   * turn GREEN when M2 re-introduces the guard. The other tests (AC-2, AC-3a, AC-3b,
   * AC-4) are positive characterization tests — they pass regardless of the guard
   * because the tool's default behaviour is to pass the decision through to the
   * orchestration service.
   *
   * AC mapping:
   *   AC-1   — REJECT no-op repeat: backlog has items, todo is empty, reason is bare
   *            "No board action available" (or similar generic justification).
   *   AC-2   — ALLOW repeat when at least one `todo` work item exists.
   *   AC-3a  — ALLOW repeat when the backlog is empty (no available candidates).
   *   AC-3b  — ALLOW repeat when every backlog candidate is listed in the reason with
   *            a per-item ticket-level blocker.
   *   AC-4   — Guard does not interfere with non-repeat decisions
   *            (pause / complete / blocked) even when backlog exists and todo is empty.
   */
  describe("runtime guard contract (M1: no-op repeat)", () => {
    const GUARD_MESSAGE_FRAGMENT =
      "Backlog-only repeat decisions must review backlog candidates";

    it("AC-1: rejects bare 'repeat' with reason 'No board action available' on 0-todo + 33-backlog board (incident 2026-05-15)", async () => {
      const orchestration = createMockOrchestration();
      const backlogItems = Array.from({ length: 33 }, (_, i) =>
        createWorkItem(`backlog-${i + 1}`, "backlog"),
      );
      const workItems = createMockWorkItems(backlogItems);
      const { tool } = createTool({ orchestration, workItems });

      await expect(
        tool.execute(context, {
          project_id: "project-1",
          decision: "repeat",
          reason: "No board action available",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        tool.execute(context, {
          project_id: "project-1",
          decision: "repeat",
          reason: "No board action available",
        }),
      ).rejects.toThrow(GUARD_MESSAGE_FRAGMENT);

      // Guard must short-circuit before the orchestration service is called.
      expect(orchestration.recordCycleDecision).not.toHaveBeenCalled();
      // Guard must read the live work-item state from the project.
      expect(workItems.listWorkItems).toHaveBeenCalledWith("project-1");
    });

    it("AC-2: allows 'repeat' when at least one todo work item exists (backlog may also exist)", async () => {
      const orchestration = createMockOrchestration();
      orchestration.recordCycleDecision.mockResolvedValue({
        decision: "repeat",
        reason: "Dispatchable todo remains",
        persisted: true,
        duplicate: false,
      });
      const workItems = createMockWorkItems([
        createWorkItem("todo-1", "todo"),
        createWorkItem("backlog-1", "backlog"),
        createWorkItem("backlog-2", "backlog"),
      ]);
      const { tool } = createTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-1",
        decision: "repeat",
        reason: "Dispatchable todo remains",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(orchestration.recordCycleDecision).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({ decision: "repeat" }),
      );
      expect(result).toMatchObject({
        ok: true,
        project_id: "project-1",
        decision: "repeat",
        persisted: true,
        duplicate: false,
      });
    });

    it("AC-3a: allows 'repeat' when the backlog is empty (no available candidates to inspect)", async () => {
      const orchestration = createMockOrchestration();
      orchestration.recordCycleDecision.mockResolvedValue({
        decision: "repeat",
        reason: "Backlog is empty",
        persisted: true,
        duplicate: false,
      });
      const workItems = createMockWorkItems([]);
      const { tool } = createTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-1",
        decision: "repeat",
        reason: "Backlog is empty",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        ok: true,
        project_id: "project-1",
        decision: "repeat",
      });
    });

    it("AC-3b: allows 'repeat' when every backlog candidate is listed with a per-item ticket-level blocker in the reason payload", async () => {
      const orchestration = createMockOrchestration();
      orchestration.recordCycleDecision.mockResolvedValue({
        decision: "repeat",
        reason:
          "Reviewed candidate backlog-1 and backlog-2: ticket-level blocker is active branch ownership; no safe candidate remains.",
        persisted: true,
        duplicate: false,
      });
      const workItems = createMockWorkItems([
        createWorkItem("backlog-1", "backlog"),
        createWorkItem("backlog-2", "backlog"),
      ]);
      const { tool } = createTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-1",
        decision: "repeat",
        reason:
          "Reviewed candidate backlog-1 and backlog-2: ticket-level blocker is active branch ownership; no safe candidate remains.",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        ok: true,
        project_id: "project-1",
        decision: "repeat",
      });
    });

    it("AC-4: does not apply the guard to non-repeat decisions (pause / complete / blocked) on a 0-todo + backlog board", async () => {
      const orchestration = createMockOrchestration();
      const workItems = createMockWorkItems([
        createWorkItem("backlog-1", "backlog"),
        createWorkItem("backlog-2", "backlog"),
        createWorkItem("backlog-3", "backlog"),
      ]);
      const { tool } = createTool({ orchestration, workItems });

      // pause — explicit halt, must not be blocked by the backlog-only repeat guard.
      await expect(
        tool.execute(context, {
          project_id: "project-1",
          decision: "pause",
          reason: "orchestration paused by request",
        }),
      ).resolves.toMatchObject({ ok: true, project_id: "project-1" });

      // complete — terminal completion, must not be blocked by the guard.
      await expect(
        tool.execute(context, {
          project_id: "project-1",
          decision: "complete",
          reason: "all planned outcomes achieved",
        }),
      ).resolves.toMatchObject({ ok: true, project_id: "project-1" });

      // blocked — explicit blocked decision, must not be blocked by the guard.
      await expect(
        tool.execute(context, {
          project_id: "project-1",
          decision: "blocked",
          reason: "human decision required",
        }),
      ).resolves.toMatchObject({ ok: true, project_id: "project-1" });

      // All three non-repeat decisions must have reached the service.
      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(3);
      expect(orchestration.recordCycleDecision).toHaveBeenNthCalledWith(
        1,
        "project-1",
        expect.objectContaining({ decision: "pause" }),
      );
      expect(orchestration.recordCycleDecision).toHaveBeenNthCalledWith(
        2,
        "project-1",
        expect.objectContaining({ decision: "complete" }),
      );
      expect(orchestration.recordCycleDecision).toHaveBeenNthCalledWith(
        3,
        "project-1",
        expect.objectContaining({ decision: "blocked" }),
      );
    });
  });
});
