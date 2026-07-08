/**
 * Contract test: CEO cycle zero-todo backlog promotion mandate.
 *
 * Work item: 5ba520b3-e2bc-4eba-ad77-1807b6917a3c
 * Title: Implement CEO Zero-Todo Contract Test and Runtime Guard
 *
 * This contract test validates that the kanban.complete_orchestration_cycle_decision
 * tool enforces the ZERO-TODO BACKLOG PROMOTION MANDATE:
 *
 * When an autonomous project has:
 *   - todo_count == 0
 *   - backlog_count > 0
 *   - unblocked backlog items exist
 *
 * The tool MUST reject bare `repeat` decisions with:
 *   - no mutation (board change)
 *   - no blockedItems array with per-item blockedReason
 *
 * Valid outcomes (one MUST be chosen):
 *   (a) Promote at least one unblocked backlog item to todo
 *   (b) Patch execution config, then promote
 *   (c) Create work item via delegation, then promote
 *   (d) Structured repeat with blockedItems array containing per-item blockedReason
 *   (e) decision: blocked with explicit ticket-level blocker
 *
 * Invalid:
 *   - Bare `repeat` with no mutation and no blockedItems = PROTOCOL VIOLATION
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { CoreWorkflowClientService } from "../../../core/core-workflow-client.service";
import { KanbanRetrospectiveEvidenceService } from "../../../retrospectives/kanban-retrospective-evidence.service";
import { BoardStateService } from "../../../services/board-state.service";
import { WorkItemService } from "../../../work-item/work-item.service";
import type { WorkItemRecord } from "../../../work-item/work-item.types";
import { OrchestrationRecordCycleDecisionTool } from "./orchestration-record-cycle-decision.tool";
import { CompleteOrchestrationCycleDecisionTool } from "./complete-orchestration-cycle-decision.tool";

// =============================================================================
// Test Data Factories
// =============================================================================

interface MockOrchestration {
  get: ReturnType<typeof vi.fn>;
  recordCycleDecision: ReturnType<typeof vi.fn>;
}

interface MockWorkItems {
  listWorkItems: ReturnType<typeof vi.fn>;
}

interface MockCoreWorkflowClient {
  setWorkflowJobOutput: ReturnType<typeof vi.fn>;
  emitDomainEvent: ReturnType<typeof vi.fn>;
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
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    linkedRunId: null,
    ...overrides,
  };
}

function createRecordTool(overrides?: {
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

function createCompleteTool(overrides?: {
  orchestration?: MockOrchestration;
  workItems?: MockWorkItems;
  coreClient?: MockCoreWorkflowClient;
}): {
  recordTool: OrchestrationRecordCycleDecisionTool;
  coreClient: MockCoreWorkflowClient;
  tool: CompleteOrchestrationCycleDecisionTool;
} {
  const {
    tool: recordTool,
    orchestration,
    workItems,
  } = createRecordTool({
    orchestration: overrides?.orchestration,
    workItems: overrides?.workItems,
  });

  const coreClient: MockCoreWorkflowClient = overrides?.coreClient ?? {
    setWorkflowJobOutput: vi.fn().mockResolvedValue({ ok: true }),
    emitDomainEvent: vi.fn().mockResolvedValue({ ok: true }),
  };

  const evidenceService = {
    collectProjectEvidence: vi.fn().mockResolvedValue({
      state: "ready",
      deltaSnapshot: {
        workItems: {
          total: 0,
          countsByStatus: {},
        },
      },
    }),
  };

  const boardStateService = {
    createBoardStateSnapshot: vi.fn().mockResolvedValue({}),
    detectBoardMutation: vi.fn().mockResolvedValue({ hasMutations: false }),
    getBoardStateSummary: vi.fn().mockResolvedValue({}),
  };

  const tool = new CompleteOrchestrationCycleDecisionTool(
    recordTool,
    coreClient as unknown as CoreWorkflowClientService,
    evidenceService as unknown as KanbanRetrospectiveEvidenceService,
    boardStateService as unknown as BoardStateService,
  );

  return { recordTool, coreClient, tool };
}

// =============================================================================
// Contract Test Suite
// =============================================================================

describe("CEO cycle zero-todo backlog promotion - orchestration-cycle-contract", () => {
  const context: InternalToolExecutionContext = {
    workflowRunId: "run-test-001",
    jobId: "ceo_orchestration_decision",
  };

  // =========================================================================
  // MANDATE CONDITION: 0 todo + N unblocked backlog + autonomous mode
  // =========================================================================

  describe('Rule 1: Reject bare "repeat" when todo_count==0 and backlog_count>0 (autonomous)', () => {
    it("rejects bare repeat with reason 'no board action available' on 0-todo + 3-backlog board", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn(),
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

      const { tool } = createRecordTool({ orchestration, workItems });

      await expect(
        tool.execute(context, {
          project_id: "project-test",
          decision: "repeat",
          reason: "No board action available",
        }),
      ).rejects.toThrow(
        /Backlog-only repeat decisions must review backlog candidates/,
      );
    });

    it("rejects bare repeat on 0-todo + 33-backlog board (evidence scenario from M1)", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn(),
      };

      const workItems: MockWorkItems = {
        listWorkItems: vi
          .fn()
          .mockResolvedValue(
            Array.from({ length: 33 }, (_, i) =>
              createWorkItem(`backlog-${i + 1}`, "backlog"),
            ),
          ),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      await expect(
        tool.execute(context, {
          project_id: "project-test",
          decision: "repeat",
          reason:
            "No board action available. 3 blocked human-decision items awaiting human feedback. No board action available to this cycle.",
        }),
      ).rejects.toThrow(
        /Backlog-only repeat decisions must review backlog candidates/,
      );
    });

    it("rejects bare repeat with generic reason 'continue' on 0-todo + backlog board", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn(),
      };

      const workItems: MockWorkItems = {
        listWorkItems: vi
          .fn()
          .mockResolvedValue([
            createWorkItem("backlog-1", "backlog"),
            createWorkItem("backlog-2", "backlog"),
          ]),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      await expect(
        tool.execute(context, {
          project_id: "project-test",
          decision: "repeat",
          reason: "continue",
        }),
      ).rejects.toThrow(
        /Backlog-only repeat decisions must review backlog candidates/,
      );
    });

    it("rejects bare repeat when 0-todo + unblocked backlog even with 3 human_decision blocked items (NON-CONTAGION RULE)", async () => {
      // This is the exact scenario from 2026-05-15 evidence:
      // 33 backlog items, 3 human_decision blocked, CEO concluded "no board action available"
      // The NON-CONTAGION RULE states human_decision findings do NOT propagate to unrelated items

      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn(),
      };

      const workItems: MockWorkItems = {
        listWorkItems: vi.fn().mockResolvedValue([
          // 30 unblocked backlog items
          ...Array.from({ length: 30 }, (_, i) =>
            createWorkItem(`backlog-${i + 1}`, "backlog"),
          ),
          // 3 human_decision blocked items (should NOT block the 30 others)
          createWorkItem("blocked-human-1", "backlog", {
            status: "blocked",
            metadata: { sourceId: "probe:human_decision" },
          }),
          createWorkItem("blocked-human-2", "backlog", {
            status: "blocked",
            metadata: { sourceId: "probe:human_decision" },
          }),
          createWorkItem("blocked-human-3", "backlog", {
            status: "blocked",
            metadata: { sourceId: "probe:human_decision" },
          }),
        ]),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      await expect(
        tool.execute(context, {
          project_id: "project-test",
          decision: "repeat",
          reason:
            "No change from prior cycle: 0 dispatchable todo items, 3 blocked human-decision items awaiting human feedback. No board action available to this cycle.",
        }),
      ).rejects.toThrow(
        /Backlog-only repeat decisions must review backlog candidates/,
      );
    });
  });

  describe("Rule 2: Accept repeat with ticket-level no-action evidence", () => {
    it("accepts repeat when reason mentions 'ticket-level blocker'", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn().mockResolvedValue({
          decision: "repeat",
          reason:
            "Reviewed candidate backlog-1: ticket-level blocker is active",
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

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason:
          "Reviewed candidate backlog-1: ticket-level blocker is active branch ownership; no safe candidate remains.",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });

    it("accepts repeat when reason mentions 'reviewed candidate'", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn().mockResolvedValue({
          decision: "repeat",
          reason: "Reviewed candidate backlog-1",
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
          ]),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason:
          "Reviewed candidate backlog-1: all candidates have unresolved dependencies",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });

    it("accepts repeat when reason mentions 'promot' (promote/promoted/promotion)", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn().mockResolvedValue({
          decision: "repeat",
          reason: "Promot backlog-1 to todo",
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
          ]),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "Promot backlog-1 and backlog-2: all clear for action",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });

    it("accepts repeat when reason contains both 'backlog' and 'todo' keywords", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn().mockResolvedValue({
          decision: "repeat",
          reason: "backlog and todo evaluation",
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

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason:
          "Reviewed backlog candidates: no todo available, backlog items present, but all have execution blockers",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });
  });

  describe("Rule 3: Accept repeat when todo > 0 (normal dispatch case)", () => {
    it("accepts repeat when board has 1+ todo items", async () => {
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
            createWorkItem("backlog-1", "backlog"),
            createWorkItem("backlog-2", "backlog"),
          ]),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "continue",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });

    it("accepts repeat with generic reason when todo exists regardless of backlog count", async () => {
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
            createWorkItem("backlog-2", "backlog"),
            createWorkItem("backlog-3", "backlog"),
          ]),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "continue",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });
  });

  describe("Rule 4: Accept repeat when backlog items are all blocked (no available backlog)", () => {
    it("accepts repeat when all backlog items have active execution", async () => {
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

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "backlog items blocked by active execution",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });

    it("accepts repeat when no backlog items exist (empty board)", async () => {
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

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "no backlog items available",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });
  });

  describe("Rule 5: Accept terminal decisions (blocked, pause, complete) regardless of board state", () => {
    it("accepts decision: blocked when 0-todo + backlog board", async () => {
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

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "blocked",
        reason: "human decision required",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });

    it("accepts decision: pause when 0-todo + backlog board", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn().mockResolvedValue({
          decision: "pause",
          reason: "orchestration paused",
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
          ]),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "pause",
        reason: "orchestration paused",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });

    it("accepts decision: complete when 0-todo + backlog board", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn().mockResolvedValue({
          decision: "complete",
          reason: "all planned outcomes achieved",
          persisted: true,
          duplicate: false,
        }),
      };

      const workItems: MockWorkItems = {
        listWorkItems: vi
          .fn()
          .mockResolvedValue([createWorkItem("backlog-1", "backlog")]),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "complete",
        reason: "all planned outcomes achieved",
      });

      expect(orchestration.recordCycleDecision).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: true });
    });
  });

  describe("Rule 6: Composite tool kanban.complete_orchestration_cycle_decision enforces the same contract", () => {
    it("composite tool rejects bare repeat on 0-todo + backlog board (autonomous)", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn(),
      };

      const workItems: MockWorkItems = {
        listWorkItems: vi
          .fn()
          .mockResolvedValue([
            createWorkItem("backlog-1", "backlog"),
            createWorkItem("backlog-2", "backlog"),
          ]),
      };

      const { tool } = createCompleteTool({ orchestration, workItems });

      await expect(
        tool.execute(context, {
          project_id: "project-test",
          decision: "repeat",
          reason: "no board action available",
        }),
      ).rejects.toThrow(
        /Backlog-only repeat decisions must review backlog candidates/,
      );
    });

    it("composite tool accepts repeat with evidence on 0-todo + backlog board (autonomous)", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn().mockResolvedValue({
          decision: "repeat",
          reason: "Reviewed candidate backlog-1: all blocked",
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
          ]),
      };

      const { tool, coreClient } = createCompleteTool({
        orchestration,
        workItems,
      });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "Reviewed candidate backlog-1: ticket-level blocker is active",
      });

      expect(coreClient.setWorkflowJobOutput).toHaveBeenCalledWith({
        workflowRunId: "run-test-001",
        jobId: "ceo_orchestration_decision",
        data: {
          decision: "repeat",
          decision_reason: "Reviewed candidate backlog-1: all blocked",
          linked_run_id: "run-test-001",
        },
      });
      expect(result).toMatchObject({
        ok: true,
        output_written: true,
        linked_run_id: "run-test-001",
        next_action: "call_step_complete",
      });
    });

    it("composite tool requires workflow run and job context", async () => {
      const { tool } = createCompleteTool();

      await expect(
        tool.execute(
          { workflowRunId: "run-1" }, // missing jobId
          {
            project_id: "project-test",
            decision: "repeat",
            reason: "continue",
          },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("Edge cases and error handling", () => {
    it("mixed board (some backlog available, some blocked) requires evidence for repeat", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "autonomous" }),
        recordCycleDecision: vi.fn(),
      };

      const workItems: MockWorkItems = {
        listWorkItems: vi.fn().mockResolvedValue([
          createWorkItem("backlog-available-1", "backlog"),
          createWorkItem("backlog-available-2", "backlog"),
          createWorkItem("backlog-blocked-1", "backlog", {
            currentExecutionId: "exec-1",
          }),
        ]),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      await expect(
        tool.execute(context, {
          project_id: "project-test",
          decision: "repeat",
          reason: "continue",
        }),
      ).rejects.toThrow(
        /Backlog-only repeat decisions must review backlog candidates/,
      );
    });

    it("handles supervised mode the same as autonomous for backlog-only repeat guard", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockResolvedValue({ orchestrationMode: "supervised" }),
        recordCycleDecision: vi.fn(),
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

      const { tool } = createRecordTool({ orchestration, workItems });

      // Same guard applies in supervised mode
      await expect(
        tool.execute(context, {
          project_id: "project-test",
          decision: "repeat",
          reason: "no board action available",
        }),
      ).rejects.toThrow(
        /Backlog-only repeat decisions must review backlog candidates/,
      );
    });

    it("handles unknown project mode gracefully (allows repeat)", async () => {
      const orchestration: MockOrchestration = {
        get: vi.fn().mockRejectedValue(new Error("Project not found")),
        recordCycleDecision: vi.fn().mockResolvedValue({
          decision: "repeat",
          reason: "project mode unknown",
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
          ]),
      };

      const { tool } = createRecordTool({ orchestration, workItems });

      const result = await tool.execute(context, {
        project_id: "project-test",
        decision: "repeat",
        reason: "continue",
      });

      expect(result).toMatchObject({ ok: true });
    });
  });
});
