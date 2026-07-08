/**
 * Contract test: CEO cycle backlog promotion mandate for autonomous zero-todo boards.
 *
 * Work item: 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2
 *
 * Verifies that the autonomous backlog-only board never produces a bare repeat
 * decision with no board mutation. This is a runtime contract test ensuring the
 * OrchestrationRecordCycleDecisionTool enforces backlog promotion policy.
 *
 * Policy rules:
 * 1. Board with 0 todo + 3+ unblocked backlog + autonomous mode → MUST reject bare repeat
 * 2. Board with 0 todo + all backlog blocked + autonomous → CAN accept repeat with blockedItems
 * 3. Board with todo > 0 + autonomous → CAN accept repeat (normal case)
 */

import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { WorkItemService } from "../../../work-item/work-item.service";
import type { WorkItemRecord } from "../../../work-item/work-item.types";
import { OrchestrationRecordCycleDecisionTool } from "./orchestration-record-cycle-decision.tool";

interface MockOrchestration {
  get: ReturnType<typeof vi.fn>;
  recordCycleDecision: ReturnType<typeof vi.fn>;
}

interface MockWorkItems {
  listWorkItems: ReturnType<typeof vi.fn>;
}

function createWorkItem(
  id: string,
  status: WorkItemRecord["status"],
  overrides?: Partial<WorkItemRecord>,
): WorkItemRecord {
  return {
    id,
    project_id: "project-test",
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
    ...overrides,
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
  const orchestration: MockOrchestration = overrides?.orchestration ?? {
    get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
    recordCycleDecision: vi.fn().mockResolvedValue({
      decision: "repeat",
      reason: "test",
      persisted: true,
      duplicate: false,
    }),
  };

  const workItems: MockWorkItems = overrides?.workItems ?? {
    listWorkItems: vi.fn().mockResolvedValue([]),
  };

  const tool = new OrchestrationRecordCycleDecisionTool(
    orchestration as unknown as OrchestrationService,
    workItems as unknown as WorkItemService,
  );

  return { tool, orchestration, workItems };
}

const context = {} as InternalToolExecutionContext;

/** Creates a tool configured to test bare-repeat rejection with the given board items. */
function makeRejectTool(
  items: WorkItemRecord[],
): OrchestrationRecordCycleDecisionTool {
  const { tool } = createTool({
    orchestration: {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn(),
    },
    workItems: { listWorkItems: vi.fn().mockResolvedValue(items) },
  });
  return tool;
}

const REJECT_MSG =
  "Backlog-only repeat decisions must review backlog candidates";
const THREE_BACKLOG = [
  createWorkItem("backlog-1", "backlog"),
  createWorkItem("backlog-2", "backlog"),
  createWorkItem("backlog-3", "backlog"),
];

describe("Policy Rule 1: Board with 0 todo + 3+ unblocked backlog + autonomous → MUST reject bare repeat", () => {
  it("rejects bare repeat when board has 0 todo and 3 unblocked backlog items (autonomous)", async () => {
    await expect(
      makeRejectTool(THREE_BACKLOG).execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "no board action available",
      }),
    ).rejects.toThrow(REJECT_MSG);
  });

  it("rejects bare repeat when board has 0 todo and 4 unblocked backlog items (autonomous)", async () => {
    await expect(
      makeRejectTool([
        ...THREE_BACKLOG,
        createWorkItem("backlog-4", "backlog"),
      ]).execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "continuing cycle",
      }),
    ).rejects.toThrow(REJECT_MSG);
  });

  it("rejects bare repeat when 0 todo + unblocked backlog even with blocked items present", async () => {
    await expect(
      makeRejectTool([
        ...THREE_BACKLOG,
        createWorkItem("blocked-1", "blocked"),
      ]).execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "work remains",
      }),
    ).rejects.toThrow(REJECT_MSG);
  });

  it("rejects bare repeat with generic 'continue' reason when 0 todo + unblocked backlog", async () => {
    await expect(
      makeRejectTool(THREE_BACKLOG).execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "continue",
      }),
    ).rejects.toThrow(REJECT_MSG);
  });
});

describe("Policy Rule 2: Board with 0 todo + all backlog blocked + autonomous → CAN accept repeat with blockedItems", () => {
  it("allows repeat when all backlog items are blocked (autonomous)", async () => {
    const orchestration: MockOrchestration = {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "repeat",
        reason: "all backlog items are blocked",
        persisted: true,
        duplicate: false,
      }),
    };

    const workItems: MockWorkItems = {
      listWorkItems: vi.fn().mockResolvedValue([
        createWorkItem("blocked-backlog-1", "backlog", {
          currentExecutionId: "exec-1",
        }),
        createWorkItem("blocked-backlog-2", "backlog", {
          linkedRunId: "run-1",
        }),
      ]),
    };

    const { tool } = createTool({ orchestration, workItems });

    const result = await tool.execute(context, {
      project_id: "project-test",
      decision: "repeat",
      reason: "all backlog items are blocked - awaiting resolution",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });

  it("allows repeat when no backlog items exist (empty board)", async () => {
    const orchestration: MockOrchestration = {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "repeat",
        reason: "no backlog items available",
        persisted: true,
        duplicate: false,
      }),
    };

    const workItems: MockWorkItems = {
      listWorkItems: vi.fn().mockResolvedValue([]),
    };

    const { tool } = createTool({ orchestration, workItems });

    const result = await tool.execute(context, {
      project_id: "project-test",
      decision: "repeat",
      reason: "no backlog items available",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });

  it("allows repeat with reason mentioning ticket-level blocker", async () => {
    const orchestration: MockOrchestration = {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "repeat",
        reason: "ticket-level blocker active",
        persisted: true,
        duplicate: false,
      }),
    };

    const workItems: MockWorkItems = {
      listWorkItems: vi
        .fn()
        .mockResolvedValue([
          createWorkItem("backlog-1", "backlog"),
          createWorkItem("backlog-2", "backlog"),
          createWorkItem("backlog-3", "backlog"),
        ]),
    };

    const { tool } = createTool({ orchestration, workItems });

    const result = await tool.execute(context, {
      project_id: "project-test",
      decision: "repeat",
      reason:
        "Reviewed candidate backlog-1: ticket-level blocker is active branch ownership; no safe candidate remains.",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });

  it("allows repeat with reason mentioning promotion policy", async () => {
    const orchestration: MockOrchestration = {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "repeat",
        reason: "promotion policy evaluation complete",
        persisted: true,
        duplicate: false,
      }),
    };

    const workItems: MockWorkItems = {
      listWorkItems: vi
        .fn()
        .mockResolvedValue([
          createWorkItem("backlog-1", "backlog"),
          createWorkItem("backlog-2", "backlog"),
          createWorkItem("backlog-3", "backlog"),
        ]),
    };

    const { tool } = createTool({ orchestration, workItems });

    const result = await tool.execute(context, {
      project_id: "project-test",
      decision: "repeat",
      reason: "Promot backlog-1 and backlog-2: all clear for action",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });
});

describe("Policy Rule 3: Board with todo > 0 + autonomous → CAN accept repeat (normal case)", () => {
  it("allows repeat when todo items exist (normal dispatch case)", async () => {
    const orchestration: MockOrchestration = {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "repeat",
        reason: "todo items remain",
        persisted: true,
        duplicate: false,
      }),
    };

    const workItems: MockWorkItems = {
      listWorkItems: vi
        .fn()
        .mockResolvedValue([
          createWorkItem("todo-1", "todo"),
          createWorkItem("todo-2", "todo"),
          createWorkItem("backlog-1", "backlog"),
          createWorkItem("backlog-2", "backlog"),
        ]),
    };

    const { tool } = createTool({ orchestration, workItems });

    const result = await tool.execute(context, {
      project_id: "project-test",
      decision: "repeat",
      reason: "todo items remain - dispatching work",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });

  it("allows repeat when at least one todo item exists regardless of backlog count", async () => {
    const orchestration: MockOrchestration = {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "repeat",
        reason: "active todo",
        persisted: true,
        duplicate: false,
      }),
    };

    const workItems: MockWorkItems = {
      listWorkItems: vi
        .fn()
        .mockResolvedValue([
          createWorkItem("todo-1", "todo"),
          createWorkItem("backlog-1", "backlog"),
          createWorkItem("backlog-2", "backlog"),
          createWorkItem("backlog-3", "backlog"),
          createWorkItem("backlog-4", "backlog"),
        ]),
    };

    const { tool } = createTool({ orchestration, workItems });

    const result = await tool.execute(context, {
      project_id: "project-test",
      decision: "repeat",
      reason: "active todo item in queue",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });

  it("allows repeat with generic reason when todo exists", async () => {
    const orchestration: MockOrchestration = {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "repeat",
        reason: "work continues",
        persisted: true,
        duplicate: false,
      }),
    };

    const workItems: MockWorkItems = {
      listWorkItems: vi
        .fn()
        .mockResolvedValue([
          createWorkItem("todo-1", "todo"),
          createWorkItem("backlog-1", "backlog"),
        ]),
    };

    const { tool } = createTool({ orchestration, workItems });

    const result = await tool.execute(context, {
      project_id: "project-test",
      decision: "repeat",
      reason: "continue",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });
});

describe("Edge cases and mixed scenarios (Part 1)", () => {
  it("allows terminal decisions (blocked, pause, complete) regardless of board state", async () => {
    const orchestration: MockOrchestration = {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "blocked",
        reason: "human decision required",
        persisted: true,
        duplicate: false,
      }),
    };

    const workItems: MockWorkItems = {
      listWorkItems: vi
        .fn()
        .mockResolvedValue([
          createWorkItem("backlog-1", "backlog"),
          createWorkItem("backlog-2", "backlog"),
          createWorkItem("backlog-3", "backlog"),
        ]),
    };

    const { tool } = createTool({ orchestration, workItems });

    const result = await tool.execute(context, {
      project_id: "project-test",
      decision: "blocked",
      reason: "human decision required",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });

  it("respects supervised mode backlog-only guard", async () => {
    const { tool } = createTool({
      orchestration: {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "supervised" }),
        recordCycleDecision: vi.fn(),
      },
      workItems: { listWorkItems: vi.fn().mockResolvedValue(THREE_BACKLOG) },
    });
    await expect(
      tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "no board action available",
      }),
    ).rejects.toThrow(REJECT_MSG);
  });

  it("backlog items with active execution are considered blocked", async () => {
    const orchestration: MockOrchestration = {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "repeat",
        reason: "backlog items blocked by active execution",
        persisted: true,
        duplicate: false,
      }),
    };

    const workItems: MockWorkItems = {
      listWorkItems: vi.fn().mockResolvedValue([
        createWorkItem("backlog-1", "backlog", {
          currentExecutionId: "exec-123",
        }),
        createWorkItem("backlog-2", "backlog", {
          currentExecutionId: "exec-456",
        }),
        createWorkItem("backlog-3", "backlog", { linkedRunId: "run-789" }),
      ]),
    };

    const { tool } = createTool({ orchestration, workItems });

    const result = await tool.execute(context, {
      project_id: "project-test",
      decision: "repeat",
      reason: "backlog items blocked by active execution",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });
});

describe("Edge cases and mixed scenarios (Part 2)", () => {
  it("mixed backlog (some blocked, some available) requires evidence for bare repeat", async () => {
    await expect(
      makeRejectTool([
        createWorkItem("backlog-available-1", "backlog"),
        createWorkItem("backlog-available-2", "backlog"),
        createWorkItem("backlog-blocked-1", "backlog", {
          currentExecutionId: "exec-1",
        }),
      ]).execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "continue",
      }),
    ).rejects.toThrow(REJECT_MSG);
  });

  it("autonomous repeat with reason containing both backlog and todo keywords passes validation", async () => {
    const orchestration: MockOrchestration = {
      get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
      recordCycleDecision: vi.fn().mockResolvedValue({
        decision: "repeat",
        reason: "backlog and todo evaluation complete",
        persisted: true,
        duplicate: false,
      }),
    };

    const workItems: MockWorkItems = {
      listWorkItems: vi
        .fn()
        .mockResolvedValue([
          createWorkItem("backlog-1", "backlog"),
          createWorkItem("backlog-2", "backlog"),
          createWorkItem("backlog-3", "backlog"),
        ]),
    };

    const { tool } = createTool({ orchestration, workItems });

    const result = await tool.execute(context, {
      project_id: "project-test",
      decision: "repeat",
      reason:
        "Reviewed backlog candidates: no todo available, backlog items present.",
    });

    expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });
});
