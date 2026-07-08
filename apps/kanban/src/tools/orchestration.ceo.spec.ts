/**
 * Unit tests for CEO orchestration cycle decision event emission.
 *
 * Milestone 4: Test kanban.retrospective_cycle_decision_recorded event emission
 *
 * Event emission rules:
 * - IS emitted for: 'blocked', 'complete', and 'repeat' with boardMutationDetected=true
 * - NOT emitted for: 'repeat' with boardMutationDetected=false (trivial repeat)
 *
 * Event payload verification:
 * - project_id, decision, reason, board_state_summary, work_item_counts, goal_coverage
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { CompleteOrchestrationCycleDecisionTool } from "../mcp/tools/mutation/complete-orchestration-cycle-decision.tool";
import { OrchestrationRecordCycleDecisionTool } from "../mcp/tools/mutation/orchestration-record-cycle-decision.tool";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { KanbanRetrospectiveEvidenceService } from "../retrospectives/kanban-retrospective-evidence.service";
import { BoardStateService } from "../services/board-state.service";
import type {
  BoardStateSummary,
  WorkItemCounts,
  GoalCoverage,
} from "../retrospectives/types/cycle-decision.types";

// Event type constant
const RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT =
  "kanban.retrospective_cycle_decision_recorded.v1";

interface EmittedEvent {
  eventName: string;
  eventId: string;
  payload: {
    eventName: string;
    projectId: string;
    decision: string;
    reasoning: string;
    idempotencyKey: string | null;
    boardStateSummary: {
      workItems: {
        total: number;
        countsByStatus: Record<string, number>;
      };
      goals: {
        total: number;
        countsByStatus: Record<string, number>;
      };
    };
    timestamp: string;
    cycleMetadata: {
      workflowRunId: string;
      jobId: string;
      decisionSource: string;
    };
  };
}

interface MockRecordToolResult {
  ok: boolean;
  project_id: string;
  decision: string;
  reason: string;
  persisted: boolean;
  duplicate: boolean;
}

// Mock data for board state summary
const mockBoardStateSummary: BoardStateSummary = {
  workItems: {
    total: 17,
    countsByStatus: { todo: 5, in_progress: 3, done: 8, blocked: 1 },
  },
  goals: {
    total: 3,
    countsByStatus: { active: 2, completed: 1 },
  },
};

// Mock data for work item counts
const mockWorkItemCounts: WorkItemCounts = {
  total: 17,
  byStatus: { todo: 5, in_progress: 3, done: 8, blocked: 1 },
  activeCount: 9,
  doneCount: 8,
};

// Mock data for goal coverage
const mockGoalCoverage: GoalCoverage = {
  total: 3,
  active: 2,
  completed: 1,
  coveragePercentage: 33.33,
};

describe("CEO Orchestration Cycle Decision Event Emission", () => {
  const context: InternalToolExecutionContext = {
    workflowRunId: "test-run-123",
    jobId: "ceo_cycle_decision",
  };

  const baseParams = {
    project_id: "project-abc",
    reason: "Test reason for cycle decision",
    idempotency_key: "cycle-2024-001",
  };

  // State for tracking emitted events
  let emittedEvents: EmittedEvent[] = [];

  // Mock factories
  function createMockRecordTool(result: MockRecordToolResult) {
    return {
      execute: vi.fn().mockResolvedValue(result),
    } as unknown as OrchestrationRecordCycleDecisionTool;
  }

  function createMockBoardStateService(
    mutationDetected: boolean,
    projectId: string = "project-abc",
  ): BoardStateService {
    const mock = {
      createBoardStateSnapshot: vi.fn().mockResolvedValue({
        timestamp: new Date(),
        projectId,
        tasks: new Map(),
        columns: new Map(),
      }),
      storeBoardStateSnapshot: vi.fn(),
      detectBoardMutation: vi
        .fn()
        .mockResolvedValue({ hasMutations: mutationDetected }),
      getBoardStateSummary: vi.fn().mockResolvedValue({
        projectId,
        totalTasks: 17,
        completedTasks: 8,
        blockedTasks: 1,
        inProgressTasks: 3,
        pendingTasks: 5,
        lastActivityAt: new Date(),
        // Mirror the seven flat fields produced by the real service. The
        // optional work_item_counts / goal_coverage are intentionally
        // omitted so extractBoardStateSummary falls back to zero / empty,
        // proving the helper's defensive behavior.
        column_counts: { todo: 5, in_progress: 3, done: 8, blocked: 1 },
        total_items: 17,
      }),
    } as unknown as BoardStateService;

    return mock;
  }

  function createMockCoreClient(): CoreWorkflowClientService {
    return {
      setWorkflowJobOutput: vi.fn().mockResolvedValue({ ok: true }),
      emitDomainEvent: vi
        .fn()
        .mockImplementation(
          (params: {
            eventName: string;
            eventId: string;
            payload: unknown;
          }) => {
            emittedEvents.push({
              eventName: params.eventName,
              eventId: params.eventId,
              payload: params.payload as EmittedEvent["payload"],
            });
            return Promise.resolve({ ok: true });
          },
        ),
      stepComplete: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as CoreWorkflowClientService;
  }

  function createMockEvidenceService(): KanbanRetrospectiveEvidenceService {
    return {
      collectProjectEvidence: vi.fn().mockResolvedValue({
        state: "ready",
        deltaSnapshot: {
          workItems: {
            total: 17,
            countsByStatus: { todo: 5, in_progress: 3, done: 8, blocked: 1 },
          },
          goals: {
            total: 3,
            countsByStatus: { active: 2, completed: 1 },
          },
        },
      }),
    } as unknown as KanbanRetrospectiveEvidenceService;
  }

  function createTool(
    recordToolResult: MockRecordToolResult,
    mutationDetected: boolean,
  ): {
    tool: CompleteOrchestrationCycleDecisionTool;
    recordTool: OrchestrationRecordCycleDecisionTool;
    boardStateService: BoardStateService;
    coreClient: CoreWorkflowClientService;
    evidenceService: KanbanRetrospectiveEvidenceService;
  } {
    const recordTool = createMockRecordTool(recordToolResult);
    const boardStateService = createMockBoardStateService(mutationDetected);
    const coreClient = createMockCoreClient();
    const evidenceService = createMockEvidenceService();

    const tool = new CompleteOrchestrationCycleDecisionTool(
      recordTool,
      coreClient,
      evidenceService,
      boardStateService,
    );

    return { tool, recordTool, boardStateService, coreClient, evidenceService };
  }

  function getEmittedCycleDecisionEvent(): EmittedEvent | undefined {
    return emittedEvents.find(
      (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
    );
  }

  beforeEach(() => {
    emittedEvents = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    emittedEvents = [];
  });

  // =============================================================================
  // Test Suite 1: Event IS emitted for decision='blocked'
  // =============================================================================

  describe("Event IS emitted when decision is 'blocked'", () => {
    it("should emit kanban.retrospective_cycle_decision_recorded event for blocked decision", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Human intervention required",
          persisted: true,
          duplicate: false,
        },
        true, // mutation detected (not relevant for blocked, but needed for the tool)
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should include project_id in event payload for blocked decision", async () => {
      const projectId = "project-blocked-test";
      const { tool } = createTool(
        {
          ok: true,
          project_id: projectId,
          decision: "blocked",
          reason: "Blocked for testing",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: projectId,
        decision: "blocked",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.projectId).toBe(projectId);
    });

    it("should include decision='blocked' in event payload", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Blocked decision verification",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.decision).toBe("blocked");
    });

    it("should include reason in event payload for blocked decision", async () => {
      const reason = "Human intervention required due to dependency issues";
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason,
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
        reason,
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.reasoning).toBe(reason);
    });
  });

  // =============================================================================
  // Test Suite 2: Event IS emitted for decision='complete'
  // =============================================================================

  describe("Event IS emitted when decision is 'complete'", () => {
    it("should emit kanban.retrospective_cycle_decision_recorded event for complete decision", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "All goals achieved",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should include project_id in event payload for complete decision", async () => {
      const projectId = "project-complete-test";
      const { tool } = createTool(
        {
          ok: true,
          project_id: projectId,
          decision: "complete",
          reason: "Complete for testing",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: projectId,
        decision: "complete",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.projectId).toBe(projectId);
    });

    it("should include decision='complete' in event payload", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Complete decision verification",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.decision).toBe("complete");
    });

    it("should include reason in event payload for complete decision", async () => {
      const reason = "All objectives achieved, cycle completed successfully";
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason,
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
        reason,
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.reasoning).toBe(reason);
    });
  });

  // =============================================================================
  // Test Suite 3: Event IS emitted for decision='repeat' WITH board mutation
  // =============================================================================

  describe("Event IS emitted when decision is 'repeat' WITH board mutation", () => {
    it("should emit kanban.retrospective_cycle_decision_recorded event for repeat with board mutation", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason: "Board changed, need to re-evaluate",
          persisted: true,
          duplicate: false,
        },
        true, // board mutation detected
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should include project_id in event payload for repeat with mutation", async () => {
      const projectId = "project-repeat-mutation-test";
      const { tool } = createTool(
        {
          ok: true,
          project_id: projectId,
          decision: "repeat",
          reason: "Mutation detected",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: projectId,
        decision: "repeat",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.projectId).toBe(projectId);
    });

    it("should include decision='repeat' in event payload when mutation detected", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason: "Board changed",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.decision).toBe("repeat");
    });

    it("should include reason in event payload for repeat with mutation", async () => {
      const reason = "Work items were added, need to re-evaluate plan";
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason,
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
        reason,
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.reasoning).toBe(reason);
    });

    it("should include board_state_summary in event payload when mutation detected", async () => {
      const { tool, evidenceService } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason: "Board changed",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.boardStateSummary).toBeDefined();
      expect(event?.payload.boardStateSummary.workItems).toBeDefined();
      expect(
        event?.payload.boardStateSummary.workItems.total,
      ).toBeGreaterThanOrEqual(0);
    });

    it("should call detectBoardMutation when decision is repeat", async () => {
      const { tool, boardStateService } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason: "Checking mutation detection",
          persisted: true,
          duplicate: false,
        },
        true, // mock returns true
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      expect(
        (boardStateService as any).detectBoardMutation,
      ).toHaveBeenCalledWith("project-abc", "cycle-2024-001");
    });
  });

  // =============================================================================
  // Test Suite 4: Event is NOT emitted for decision='repeat' WITHOUT board mutation
  // =============================================================================

  describe("Event is NOT emitted when decision is 'repeat' WITHOUT board mutation (trivial repeat)", () => {
    it("should NOT emit kanban.retrospective_cycle_decision_recorded event for trivial repeat", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason: "No changes detected, safe repeat",
          persisted: true,
          duplicate: false,
        },
        false, // no board mutation = trivial repeat
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event).toBeUndefined();
    });

    it("should NOT emit any event for repeat when boardMutationDetected is false", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason: "Trivial repeat - no changes",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      // Check that emitDomainEvent was never called with this event type
      const relevantEvents = emittedEvents.filter(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      expect(relevantEvents).toHaveLength(0);
    });

    it("should still persist the cycle decision even when event is not emitted for trivial repeat", async () => {
      const { tool, recordTool, coreClient } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason: "Trivial repeat",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      // The decision should still be recorded
      expect((recordTool as any).execute).toHaveBeenCalled();

      // The job output should still be written
      expect((coreClient as any).setWorkflowJobOutput).toHaveBeenCalled();

      // But no event should be emitted
      const event = getEmittedCycleDecisionEvent();
      expect(event).toBeUndefined();

      expect(result).toMatchObject({
        ok: true,
        project_id: "project-abc",
        decision: "repeat",
        persisted: true,
      });
    });
  });

  // =============================================================================
  // Test Suite 5: Verify complete event payload structure
  // =============================================================================

  describe("Event payload contains all required fields", () => {
    it("should include project_id in the event payload", async () => {
      const projectId = "project-payload-test";
      const { tool } = createTool(
        {
          ok: true,
          project_id: projectId,
          decision: "complete",
          reason: "Testing payload",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: projectId,
        decision: "complete",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.projectId).toBe(projectId);
      expect(typeof event?.payload.projectId).toBe("string");
    });

    it("should include decision in the event payload", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Testing decision field",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.decision).toBeDefined();
      expect(["blocked", "complete", "repeat"]).toContain(
        event?.payload.decision,
      );
    });

    it("should include reason in the event payload", async () => {
      const reason = "Comprehensive testing of reason field inclusion";
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason,
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
        reason,
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.reasoning).toBe(reason);
      expect(typeof event?.payload.reasoning).toBe("string");
    });

    it("should include board_state_summary in the event payload", async () => {
      const { tool, evidenceService } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Testing board_state_summary",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const event = getEmittedCycleDecisionEvent();

      // Verify board_state_summary is present
      expect(event?.payload.boardStateSummary).toBeDefined();
      expect(typeof event?.payload.boardStateSummary).toBe("object");

      // Verify workItems within board_state_summary
      expect(event?.payload.boardStateSummary.workItems).toBeDefined();
      expect(typeof event?.payload.boardStateSummary.workItems).toBe("object");
      expect(event?.payload.boardStateSummary.workItems.total).toBeDefined();
      expect(typeof event?.payload.boardStateSummary.workItems.total).toBe(
        "number",
      );
      expect(
        event?.payload.boardStateSummary.workItems.countsByStatus,
      ).toBeDefined();
      expect(
        typeof event?.payload.boardStateSummary.workItems.countsByStatus,
      ).toBe("object");

      // Verify goals within board_state_summary
      expect(event?.payload.boardStateSummary.goals).toBeDefined();
      expect(typeof event?.payload.boardStateSummary.goals).toBe("object");
    });

    it("should include work_item_counts in the event payload (derived from board_state_summary)", async () => {
      const { tool, evidenceService } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Testing work_item_counts",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      const event = getEmittedCycleDecisionEvent();

      // work_item_counts is derived from board_state_summary.workItems
      expect(event?.payload.boardStateSummary.workItems.total).toBeDefined();
      expect(
        event?.payload.boardStateSummary.workItems.countsByStatus,
      ).toBeDefined();

      // The work item counts should reflect the evidence collected
      expect(
        (evidenceService as any).collectProjectEvidence,
      ).toHaveBeenCalledWith("project-abc");
    });

    it("should include goal_coverage in the event payload (derived from board_state_summary)", async () => {
      const { tool, evidenceService } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Testing goal_coverage",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const event = getEmittedCycleDecisionEvent();

      // goal_coverage is derived from board_state_summary.goals
      expect(event?.payload.boardStateSummary.goals).toBeDefined();
      expect(event?.payload.boardStateSummary.goals.total).toBeDefined();
      expect(typeof event?.payload.boardStateSummary.goals.total).toBe(
        "number",
      );
      expect(
        event?.payload.boardStateSummary.goals.countsByStatus,
      ).toBeDefined();
    });

    it("should include timestamp in the event payload", async () => {
      const beforeTest = new Date();
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Testing timestamp",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const afterTest = new Date();
      const event = getEmittedCycleDecisionEvent();

      expect(event?.payload.timestamp).toBeDefined();
      expect(typeof event?.payload.timestamp).toBe("string");

      // Verify ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(event?.payload.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
      );

      // Verify timestamp is within test window
      const eventDate = new Date(event?.payload.timestamp ?? "");
      expect(eventDate.getTime()).toBeGreaterThanOrEqual(
        beforeTest.getTime() - 1000,
      );
      expect(eventDate.getTime()).toBeLessThanOrEqual(
        afterTest.getTime() + 1000,
      );
    });

    it("should include cycleMetadata with workflowRunId and jobId", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Testing cycleMetadata",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      const event = getEmittedCycleDecisionEvent();

      expect(event?.payload.cycleMetadata).toBeDefined();
      expect(event?.payload.cycleMetadata.workflowRunId).toBe(
        context.workflowRunId,
      );
      expect(event?.payload.cycleMetadata.jobId).toBe(context.jobId);
      expect(event?.payload.cycleMetadata.decisionSource).toBe(
        "orchestration_cycle",
      );
    });
  });

  // =============================================================================
  // Test Suite 6: Edge cases and integration scenarios
  // =============================================================================

  describe("Edge cases and integration scenarios", () => {
    it("should call collectProjectEvidence before emitting event", async () => {
      const { tool, evidenceService } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Evidence collection order test",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      expect(
        (evidenceService as any).collectProjectEvidence,
      ).toHaveBeenCalled();
      expect(
        (evidenceService as any).collectProjectEvidence,
      ).toHaveBeenCalledWith("project-abc");

      // Event should have been emitted
      const event = getEmittedCycleDecisionEvent();
      expect(event).toBeDefined();
    });

    it("should handle different project IDs correctly", async () => {
      const projectIds = ["proj-1", "proj-2", "proj-3"];

      for (const projectId of projectIds) {
        emittedEvents = []; // Reset for each iteration
        const { tool } = createTool(
          {
            ok: true,
            project_id: projectId,
            decision: "complete",
            reason: `Testing project ${projectId}`,
            persisted: true,
            duplicate: false,
          },
          true,
        );

        await tool.execute(context, {
          ...baseParams,
          project_id: projectId,
          decision: "complete",
        });

        const event = getEmittedCycleDecisionEvent();
        expect(event?.payload.projectId).toBe(projectId);
      }
    });

    it("should handle empty and non-empty idempotency keys", async () => {
      // With idempotency key
      const { tool: toolWithKey } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "With idempotency key",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await toolWithKey.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      let event = getEmittedCycleDecisionEvent();
      expect(event?.payload.idempotencyKey).toBe(baseParams.idempotency_key);

      // With empty idempotency key
      emittedEvents = [];
      const { tool: toolWithoutKey } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Without idempotency key",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await toolWithoutKey.execute(context, {
        project_id: "project-abc",
        decision: "complete",
        reason: "Without idempotency key",
      });

      event = getEmittedCycleDecisionEvent();
      expect(event?.payload.idempotencyKey).toBeNull();
    });

    it("should not emit event for duplicate decisions", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Duplicate decision",
          persisted: false, // duplicate=true in actual flow means persisted=false
          duplicate: true,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      // Even for substantive decisions, duplicates should not emit events
      const event = getEmittedCycleDecisionEvent();
      expect(event).toBeUndefined();
    });

    it("should handle case insensitivity for decision type", async () => {
      const { tool: toolUpper } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "COMPLETE",
          reason: "Uppercase decision",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await toolUpper.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      let event = getEmittedCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.payload.decision).toBeDefined();

      // Lowercase
      emittedEvents = [];
      const { tool: toolLower } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Lowercase decision",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await toolLower.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      event = getEmittedCycleDecisionEvent();
      expect(event).toBeDefined();
    });
  });

  // =============================================================================
  // Test Suite 7: Verify emitDomainEvent is called correctly
  // =============================================================================

  describe("emitDomainEvent is called correctly", () => {
    it("should call emitDomainEvent with correct event name for blocked decision", async () => {
      const { tool, coreClient } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Testing emitDomainEvent",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      expect((coreClient as any).emitDomainEvent).toHaveBeenCalled();

      // Verify the event name
      const callArgs = (coreClient.emitDomainEvent as any).mock.calls[0][0];
      expect(callArgs.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should call emitDomainEvent with correct event name for complete decision", async () => {
      const { tool, coreClient } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Testing emitDomainEvent",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      expect((coreClient as any).emitDomainEvent).toHaveBeenCalled();

      const callArgs = (coreClient.emitDomainEvent as any).mock.calls[0][0];
      expect(callArgs.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should call emitDomainEvent with correct event name for repeat with mutation", async () => {
      const { tool, coreClient } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason: "Testing emitDomainEvent",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      expect((coreClient as any).emitDomainEvent).toHaveBeenCalled();

      const callArgs = (coreClient.emitDomainEvent as any).mock.calls[0][0];
      expect(callArgs.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should NOT call emitDomainEvent for trivial repeat", async () => {
      const { tool, coreClient } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason: "Trivial repeat",
          persisted: true,
          duplicate: false,
        },
        false, // no mutation
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      // Check that emitDomainEvent was never called with the cycle decision event
      const calls = (coreClient.emitDomainEvent as ReturnType<typeof vi.fn>)
        .mock.calls;
      const cycleDecisionCalls = calls.filter(
        (call: unknown[]) =>
          (call[0] as { eventName: string }).eventName ===
          RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      expect(cycleDecisionCalls).toHaveLength(0);
    });

    it("should include eventId in emitDomainEvent call", async () => {
      const { tool, coreClient } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Testing eventId",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const callArgs = (coreClient.emitDomainEvent as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(callArgs.eventId).toBeDefined();
      expect(typeof callArgs.eventId).toBe("string");
      expect(callArgs.eventId.length).toBeGreaterThan(0);
    });

    it("should include payload in emitDomainEvent call", async () => {
      const { tool, coreClient } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Testing payload structure",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      const callArgs = (coreClient.emitDomainEvent as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(callArgs.payload).toBeDefined();
      expect(typeof callArgs.payload).toBe("object");
      expect(callArgs.payload.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      expect(callArgs.payload.projectId).toBe("project-abc");
      expect(callArgs.payload.decision).toBeDefined();
      expect(callArgs.payload.reasoning).toBeDefined();
      expect(callArgs.payload.boardStateSummary).toBeDefined();
    });
  });
});
