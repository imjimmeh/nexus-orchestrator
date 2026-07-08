/**
 * Unit tests for kanban.retrospective_cycle_decision_recorded event.
 *
 * These tests verify the event emission logic from the CompleteOrchestrationCycleDecisionTool,
 * confirming that the `kanban.retrospective_cycle_decision_recorded` event fires correctly
 * for non-trivial decisions and is NOT fired for trivial 'repeat' decisions without board mutation.
 *
 * Event emission rules:
 * - IS emitted for: 'blocked', 'complete', and 'repeat' with hasBoardMutation=true
 * - NOT emitted for: 'repeat' with hasBoardMutation=false (trivial repeat)
 *
 * @see apps/kanban/src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { CompleteOrchestrationCycleDecisionTool } from "../../mcp/tools/mutation/complete-orchestration-cycle-decision.tool";
import { OrchestrationRecordCycleDecisionTool } from "../../mcp/tools/mutation/orchestration-record-cycle-decision.tool";
import { BoardStateService } from "../../services/board-state.service";
import { CoreWorkflowClientService } from "../../core/core-workflow-client.service";
import { KanbanRetrospectiveEvidenceService } from "../../retrospectives/kanban-retrospective-evidence.service";
import { extractBoardStateSummary } from "../../retrospectives/cycle-decision-metadata";
import type { BoardStateSummary as ServiceBoardStateSummary } from "../../services/board-state.types";

// Test constants
const RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT =
  "kanban.retrospective_cycle_decision_recorded.v1";

const LEARNING_CANDIDATE_PROPOSED_EVENT = "learning.candidate.proposed.v1";

interface EmittedEvent {
  eventName: string;
  eventId: string;
  payload: Record<string, unknown>;
}

interface MockRecordToolResult {
  ok: boolean;
  project_id: string;
  decision: string;
  reason: string;
  persisted: boolean;
  duplicate: boolean;
}

describe("KanbanRetrospectiveCycleDecisionRecordedEvent", () => {
  const context: InternalToolExecutionContext = {
    workflowRunId: "run-test-001",
    jobId: "ceo_orchestration_decision",
  };

  const baseParams = {
    project_id: "project-test-123",
    reason: "Test reason for cycle decision",
    idempotency_key: "cycle-2024-001",
  };

  let emittedEvents: EmittedEvent[] = [];

  // Mock factories
  function createMockRecordTool(result: MockRecordToolResult) {
    return {
      execute: vi.fn().mockResolvedValue(result),
    } as unknown as OrchestrationRecordCycleDecisionTool;
  }

  function createMockBoardStateService(
    mutationDetected: boolean,
  ): BoardStateService {
    return {
      createBoardStateSnapshot: vi.fn().mockResolvedValue({
        timestamp: new Date(),
        projectId: "project-test-123",
        tasks: new Map(),
        columns: new Map(),
      }),
      storeBoardStateSnapshot: vi.fn(),
      // The source code reads `boardMutation.hasMutations`, so the mock must
      // return the BoardMutation shape (with `hasMutations` flag) rather than
      // a bare boolean.
      detectBoardMutation: vi.fn().mockResolvedValue({
        hasMutations: mutationDetected,
        addedTasks: mutationDetected ? 2 : 0,
        removedTasks: 0,
        completedTasks: mutationDetected ? 1 : 0,
        cycleNumber: 1,
      }),
      getBoardStateSummary: vi.fn().mockReturnValue({
        projectId: "project-test-123",
        totalTasks: 17,
        completedTasks: 8,
        blockedTasks: 1,
        inProgressTasks: 3,
        pendingTasks: 5,
        lastActivityAt: new Date(),
        workItems: {
          total: 17,
          countsByStatus: { todo: 5, in_progress: 3, done: 8, blocked: 1 },
        },
        goals: {
          total: 3,
          countsByStatus: { active: 2, completed: 1 },
        },
      }),
    } as unknown as BoardStateService;
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
              payload: params.payload as Record<string, unknown>,
            });
            return { ok: true };
          },
        ),
      stepComplete: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as CoreWorkflowClientService;
  }

  function createMockEvidenceService() {
    return {
      collectProjectEvidence: vi.fn().mockResolvedValue({
        state: "ready",
        deltaSnapshot: {
          workItems: {
            total: 17,
            countsByStatus: { todo: 5, in_progress: 3, done: 8, blocked: 1 },
          },
        },
      }),
    } as unknown as KanbanRetrospectiveEvidenceService;
  }

  function createTool(
    recordToolResult: MockRecordToolResult,
    mutationDetected: boolean,
  ): CompleteOrchestrationCycleDecisionTool {
    const recordTool = createMockRecordTool(recordToolResult);
    const boardStateService = createMockBoardStateService(mutationDetected);
    const coreClient = createMockCoreClient();
    const evidenceService = createMockEvidenceService();

    return new CompleteOrchestrationCycleDecisionTool(
      recordTool,
      coreClient,
      evidenceService,
      boardStateService,
    );
  }

  function getCycleDecisionEvent(): EmittedEvent | undefined {
    return emittedEvents.find(
      (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
    );
  }

  function getLearningCandidateEvent(): EmittedEvent | undefined {
    return emittedEvents.find(
      (e) => e.eventName === LEARNING_CANDIDATE_PROPOSED_EVENT,
    );
  }

  beforeEach(() => {
    emittedEvents = [];
    vi.clearAllMocks();
  });

  // =========================================================================
  // Task 4.1: Test event emitted for 'blocked' decision
  // =========================================================================

  describe("Event IS emitted for 'blocked' decision", () => {
    it("should emit kanban.retrospective_cycle_decision_recorded event for blocked decision", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "blocked",
          reason: "Human intervention required",
          persisted: true,
          duplicate: false,
        },
        false, // board mutation doesn't matter for blocked
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should emit learning.candidate.proposed event after blocked decision", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "blocked",
          reason: "Human intervention required",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      const learningEvent = getLearningCandidateEvent();
      expect(learningEvent).toBeDefined();
      expect(learningEvent?.eventName).toBe(LEARNING_CANDIDATE_PROPOSED_EVENT);
    });

    it("should include all required fields in blocked decision event payload", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "blocked",
          reason: "Human intervention required for task-456",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
        idempotency_key: "cycle-blocked-001",
      });

      const event = getCycleDecisionEvent();
      expect(event?.payload).toMatchObject(
        expect.objectContaining({
          eventName: RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
          projectId: "project-test-123",
          decision: expect.any(String),
          reasoning: "Human intervention required for task-456",
          idempotencyKey: "cycle-blocked-001",
        }),
      );
    });
  });

  // =========================================================================
  // Task 4.2: Test event emitted for 'complete' decision
  // =========================================================================

  describe("Event IS emitted for 'complete' decision", () => {
    it("should emit kanban.retrospective_cycle_decision_recorded event for complete decision", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "complete",
          reason: "All cycle goals achieved",
          persisted: true,
          duplicate: false,
        },
        false, // board mutation doesn't matter for complete
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should emit learning.candidate.proposed event after complete decision", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "complete",
          reason: "All goals achieved with 90% completion rate",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const learningEvent = getLearningCandidateEvent();
      expect(learningEvent).toBeDefined();
      expect(learningEvent?.eventName).toBe(LEARNING_CANDIDATE_PROPOSED_EVENT);
    });

    it("should include board state summary in complete decision event", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "complete",
          reason: "All goals achieved",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const event = getCycleDecisionEvent();
      expect(event?.payload.boardStateSummary).toBeDefined();
      expect(event?.payload.boardStateSummary).toMatchObject(
        expect.objectContaining({
          workItems: expect.any(Object),
          goals: expect.any(Object),
        }),
      );
    });
  });

  // =========================================================================
  // Task 4.3: Test event emitted for 'repeat' WITH board mutation
  // =========================================================================

  describe("Event IS emitted for 'repeat' WITH board mutation", () => {
    it("should emit kanban.retrospective_cycle_decision_recorded event for repeat with board mutation", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "Board changed, re-evaluate priorities",
          persisted: true,
          duplicate: false,
        },
        true, // board mutation detected
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should emit learning.candidate.proposed event after repeat with board mutation", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "Task dependencies resolved",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      const learningEvent = getLearningCandidateEvent();
      expect(learningEvent).toBeDefined();
    });

    it("should mark the repeat-with-mutation run as substantive in the result", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "Board structure updated",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      // A repeat combined with a detected board mutation is substantive and
      // the tool must surface that fact in its return value so the caller
      // can drive follow-up behaviour (e.g. emit downstream events).
      expect(result.isSubstantive).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.project_id).toBe("project-test-123");

      // The retrospective event should still have been emitted.
      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
    });
  });

  // =========================================================================
  // Task 4.3b: Test event emitted for 'continue' decision (added in milestone 2)
  // =========================================================================
  //
  // 'continue' was added in milestone 2 to model the autonomous
  // "default-to-continue" flow: the orchestration layer can record a
  // 'continue' decision when a cycle should advance to the next iteration
  // without changing the explicit decision category. 'continue' is treated
  // as a substantive decision in the outer isSubstantive check, so the
  // tool must emit a retrospective event for it.
  //
  // Note: The tool reads the final decision from the record tool's result
  // (not from the input params), so the input can carry any valid decision
  // value while the record tool returns 'continue' to exercise the new
  // emission path. The input schema does not (yet) list 'continue' as an
  // accepted value — that is an explicit, separate concern from emission.

  describe("Event IS emitted for 'continue' decision", () => {
    it("should emit kanban.retrospective_cycle_decision_recorded event when the record tool returns 'continue'", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "continue",
          reason: "Continuing cycle with new context",
          persisted: true,
          duplicate: false,
        },
        true, // board mutation detected — required by the inner check
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat", // valid schema value; tool reads 'continue' from record tool
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should emit learning.candidate.proposed event when the record tool returns 'continue'", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "continue",
          reason: "Continuing cycle, new evidence collected",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      const learningEvent = getLearningCandidateEvent();
      expect(learningEvent).toBeDefined();
      expect(learningEvent?.eventName).toBe(LEARNING_CANDIDATE_PROPOSED_EVENT);
    });

    it("should include all AC-2 required fields in the 'continue' event payload", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-continue-001",
          decision: "continue",
          reason: "Continuing to next cycle with refined priorities",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-continue-001",
        decision: "repeat",
        idempotency_key: "cycle-continue-001",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();

      const payload = event?.payload as Record<string, unknown>;
      expect(payload).toBeDefined();
      expect(payload.projectId).toBe("project-continue-001");
      expect(payload.decision).toBeDefined();
      expect(payload.reasoning).toBe(
        "Continuing to next cycle with refined priorities",
      );
      expect(payload.idempotencyKey).toBe("cycle-continue-001");
      expect(payload.boardStateSummary).toBeDefined();
      expect(payload.timestamp).toBeDefined();
      expect(payload.cycleMetadata).toMatchObject(
        expect.objectContaining({
          workflowRunId: context.workflowRunId,
          jobId: context.jobId,
          decisionSource: "orchestration_cycle",
        }),
      );
    });

    it("should mark 'continue' as substantive in the result", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "continue",
          reason: "Continuing cycle",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      expect(result.isSubstantive).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.project_id).toBe("project-test-123");
    });
  });

  // =========================================================================
  // Task 4.4: Test event NOT emitted for 'repeat' WITHOUT board mutation
  // =========================================================================

  describe("Event is NOT emitted for 'repeat' WITHOUT board mutation (trivial repeat)", () => {
    it("should NOT emit kanban.retrospective_cycle_decision_recorded event for trivial repeat", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "No changes detected, safe to repeat",
          persisted: true,
          duplicate: false,
        },
        false, // no board mutation = trivial repeat
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeUndefined();
    });

    it("should NOT emit learning.candidate.proposed event for trivial repeat", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "No board changes, safe to repeat",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      const learningEvent = getLearningCandidateEvent();
      expect(learningEvent).toBeUndefined();
    });

    it("should signal the caller to invoke stepComplete via the result for trivial repeat", async () => {
      // The tool does NOT call stepComplete directly. Instead, it returns a
      // result that signals the caller to call stepComplete next (via
      // `next_action` and `step_complete_called`). This test verifies the
      // signal is present even for trivial repeats so the workflow runtime
      // can still advance the run to completion.
      const stepCompleteSpy = vi.fn().mockResolvedValue({ ok: true });
      const mockCoreClient = {
        setWorkflowJobOutput: vi.fn().mockResolvedValue({ ok: true }),
        emitDomainEvent: vi.fn().mockImplementation(() => ({ ok: true })),
        stepComplete: stepCompleteSpy,
      } as unknown as CoreWorkflowClientService;

      const tool = new CompleteOrchestrationCycleDecisionTool(
        createMockRecordTool({
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "No changes detected",
          persisted: true,
          duplicate: false,
        }),
        mockCoreClient,
        createMockEvidenceService(),
        createMockBoardStateService(false),
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      // The tool must not call stepComplete itself; it returns a signal.
      expect(stepCompleteSpy).not.toHaveBeenCalled();

      // The result must tell the caller to call stepComplete next.
      expect(result.next_action).toBe("call_step_complete");
      expect(result.step_complete_called).toBe(false);
      expect(result.ok).toBe(true);
    });

    it("should verify no cycle decision event is emitted in trivial repeat scenario", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "Status quo maintained",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      // Verify no retrospective cycle decision event was emitted
      const relevantEvents = emittedEvents.filter(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      expect(relevantEvents).toHaveLength(0);
    });
  });

  // =========================================================================
  // Additional tests: Event payload structure verification
  // =========================================================================

  describe("Event payload contains all required fields", () => {
    it("should include projectId in event payload", async () => {
      const projectId = "project-xyz-789";
      const tool = createTool(
        {
          ok: true,
          project_id: projectId,
          decision: "blocked",
          reason: "Test project ID",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: projectId,
        decision: "blocked",
      });

      const event = getCycleDecisionEvent();
      expect(event?.payload.projectId).toBe(projectId);
    });

    it("should include timestamp in ISO 8601 format", async () => {
      const beforeTest = new Date();
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "complete",
          reason: "Timestamp test",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const afterTest = new Date();
      const event = getCycleDecisionEvent();

      expect(event?.payload.timestamp).toBeDefined();
      const timestamp = event?.payload.timestamp as string;

      // Verify ISO 8601 format
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);

      // Verify timestamp is within test window
      const eventDate = new Date(timestamp);
      expect(eventDate.getTime()).toBeGreaterThanOrEqual(
        beforeTest.getTime() - 1000,
      );
      expect(eventDate.getTime()).toBeLessThanOrEqual(
        afterTest.getTime() + 1000,
      );
    });

    it("should include cycleMetadata with workflow context", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "complete",
          reason: "Cycle metadata test",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const event = getCycleDecisionEvent();
      expect(event?.payload.cycleMetadata).toBeDefined();
      const cycleMetadata = event?.payload.cycleMetadata as Record<
        string,
        unknown
      >;
      expect(cycleMetadata.workflowRunId).toBe(context.workflowRunId);
      expect(cycleMetadata.jobId).toBe(context.jobId);
      expect(cycleMetadata.decisionSource).toBe("orchestration_cycle");
    });

    it("should include every AC-2 required field in a single event payload (blocked)", async () => {
      // AC-2 mandates that the event payload contains: projectId, decision,
      // boardStateSummary, timestamp, cycleMetadata. This single test asserts
      // all five fields are present together for a 'blocked' decision, so a
      // regression in any field surfaces here.
      const tool = createTool(
        {
          ok: true,
          project_id: "project-ac2-test",
          decision: "blocked",
          reason: "AC-2 coverage check",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-ac2-test",
        decision: "blocked",
        idempotency_key: "cycle-ac2-001",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();

      const payload = event?.payload;
      expect(payload).toBeDefined();
      expect(payload?.projectId).toBe("project-ac2-test");
      expect(payload?.decision).toBeDefined();
      expect(payload?.boardStateSummary).toMatchObject(
        expect.objectContaining({
          workItems: expect.objectContaining({ total: expect.any(Number) }),
          goals: expect.objectContaining({ total: expect.any(Number) }),
        }),
      );
      expect(payload?.timestamp).toBeDefined();
      expect(typeof payload?.timestamp).toBe("string");
      expect(payload?.cycleMetadata).toMatchObject(
        expect.objectContaining({
          workflowRunId: context.workflowRunId,
          jobId: context.jobId,
          decisionSource: "orchestration_cycle",
        }),
      );
    });

    it("should include every AC-2 required field in a single event payload (complete)", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-ac2-complete",
          decision: "complete",
          reason: "AC-2 coverage check for complete",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-ac2-complete",
        decision: "complete",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      const payload = event?.payload;
      expect(payload).toBeDefined();
      expect(payload?.projectId).toBe("project-ac2-complete");
      expect(payload?.decision).toBeDefined();
      expect(payload?.boardStateSummary).toBeDefined();
      expect(payload?.timestamp).toBeDefined();
      expect(payload?.cycleMetadata).toBeDefined();
    });

    it("should include every AC-2 required field in a single event payload (repeat with mutation)", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-ac2-repeat",
          decision: "repeat",
          reason: "AC-2 coverage check for repeat-with-mutation",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-ac2-repeat",
        decision: "repeat",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      const payload = event?.payload;
      expect(payload).toBeDefined();
      expect(payload?.projectId).toBe("project-ac2-repeat");
      expect(payload?.decision).toBeDefined();
      expect(payload?.boardStateSummary).toBeDefined();
      expect(payload?.timestamp).toBeDefined();
      expect(payload?.cycleMetadata).toBeDefined();
    });
  });

  // =========================================================================
  // Integration: Decision type differentiation
  // =========================================================================

  describe("Decision type differentiation", () => {
    it("should mark 'blocked' as always substantive regardless of board mutation", async () => {
      // With mutation
      const toolWithMutation = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "blocked",
          reason: "Blocked with mutation",
          persisted: true,
          duplicate: false,
        },
        true,
      );
      await toolWithMutation.execute(context, {
        ...baseParams,
        decision: "blocked",
      });
      expect(getCycleDecisionEvent()).toBeDefined();

      emittedEvents = [];
      vi.clearAllMocks();

      // Without mutation
      const toolWithoutMutation = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "blocked",
          reason: "Blocked without mutation",
          persisted: true,
          duplicate: false,
        },
        false,
      );
      await toolWithoutMutation.execute(context, {
        ...baseParams,
        decision: "blocked",
      });
      expect(getCycleDecisionEvent()).toBeDefined();
    });

    it("should mark 'repeat' as substantive only when board mutation is detected", async () => {
      // With mutation - should emit
      const toolWithMutation = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "Repeat with mutation",
          persisted: true,
          duplicate: false,
        },
        true,
      );
      await toolWithMutation.execute(context, {
        ...baseParams,
        decision: "repeat",
      });
      expect(getCycleDecisionEvent()).toBeDefined();

      emittedEvents = [];
      vi.clearAllMocks();

      // Without mutation - should NOT emit
      const toolWithoutMutation = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "Repeat without mutation",
          persisted: true,
          duplicate: false,
        },
        false,
      );
      await toolWithoutMutation.execute(context, {
        ...baseParams,
        decision: "repeat",
      });
      expect(getCycleDecisionEvent()).toBeUndefined();
    });
  });

  // =========================================================================
  // Return-value contract: isSubstantive flag and emitted event identifiers
  // =========================================================================

  describe("Return-value contract: isSubstantive and emitted event identifiers", () => {
    it("should set isSubstantive=true and emit an event for 'blocked'", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "blocked",
          reason: "Return-value contract test",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      expect(result.isSubstantive).toBe(true);
      expect(getCycleDecisionEvent()).toBeDefined();
    });

    it("should set isSubstantive=true and emit an event for 'complete'", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "complete",
          reason: "Return-value contract test",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      expect(result.isSubstantive).toBe(true);
      expect(getCycleDecisionEvent()).toBeDefined();
    });

    it("should set isSubstantive=true and emit an event for 'repeat' with mutation", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "Return-value contract test",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      expect(result.isSubstantive).toBe(true);
      expect(getCycleDecisionEvent()).toBeDefined();
    });

    it("should set isSubstantive=true and emit an event for 'continue'", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "continue",
          reason: "Return-value contract test for continue",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      expect(result.isSubstantive).toBe(true);
      expect(getCycleDecisionEvent()).toBeDefined();
    });

    it("should set isSubstantive=false and NOT emit an event for 'repeat' without mutation", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "repeat",
          reason: "Return-value contract test",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      expect(result.isSubstantive).toBe(false);
      expect(getCycleDecisionEvent()).toBeUndefined();
    });

    it("should expose a stable, scoped eventId for the cycle decision event", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "blocked",
          reason: "eventId format test",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.eventId).toMatch(
        /^kanban:retrospective_cycle_decision:project-test-123:.+:\d+$/,
      );
    });

    it("should not double-emit when the record tool reports the call as a duplicate", async () => {
      // When the persistence layer reports the decision as a duplicate, the
      // tool must NOT emit a fresh retrospective event (replay safety). The
      // result should still be ok=true because the prior decision is in place.
      const tool = createTool(
        {
          ok: true,
          project_id: "project-test-123",
          decision: "blocked",
          reason: "Duplicate replay scenario",
          persisted: true,
          duplicate: true,
        },
        false,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      expect(result.ok).toBe(true);
      expect(result.isSubstantive).toBe(false);
      expect(getCycleDecisionEvent()).toBeUndefined();
      expect(getLearningCandidateEvent()).toBeUndefined();
    });
  });

  // =========================================================================
  // Task 1.2 - Expanded integration tests
  // =========================================================================
  //
  // The following describe blocks add deeper, integration-style coverage
  // on top of the basic emit/no-emit matrix. They cover:
  //   - the exact `decision` value carried in the payload for each type
  //   - the exact `reasoning` value carried in the payload for each type
  //   - ordering of the two emitted events (cycle decision before learning)
  //   - error paths that must NOT emit
  //   - the shape of `boardStateSummary` for every substantive decision
  //   - multi-decision sequential runs to assert the events are distinct
  //   - the `pause` input value as an edge case (not in the substantive list)
  //   - direct payload comparison proving different decisions are distinguishable

  /**
   * Substantive decision matrix used by the parametrized tests below.
   * `mutation` is the simulated board-mutation flag and `inputDecision`
   * is the value passed to the tool's input schema (the schema does not
   * yet list 'continue' as a valid input, so we use 'repeat' as the
   * schema value while the record tool returns 'continue' to exercise
   * the new emission path).
   */
  const SUBSTANTIVE_DECISIONS: ReadonlyArray<{
    label: string;
    decision: "blocked" | "complete" | "repeat" | "continue";
    mutation: boolean;
    inputDecision: "blocked" | "complete" | "repeat";
    reason: string;
  }> = [
    {
      label: "blocked",
      decision: "blocked",
      mutation: false,
      inputDecision: "blocked",
      reason: "Blocked: human intervention required for migration",
    },
    {
      label: "complete",
      decision: "complete",
      mutation: false,
      inputDecision: "complete",
      reason: "Complete: all milestones achieved with 95% coverage",
    },
    {
      label: "repeat-with-mutation",
      decision: "repeat",
      mutation: true,
      inputDecision: "repeat",
      reason: "Repeat: dependencies resolved, re-evaluate priority",
    },
    {
      label: "continue",
      decision: "continue",
      mutation: true,
      inputDecision: "repeat",
      reason: "Continue: advancing to next cycle with new context",
    },
  ];

  // -------------------------------------------------------------------------
  // Decision type differentiation: actual payload content
  // -------------------------------------------------------------------------

  describe("Decision type differentiation: actual payload content", () => {
    it("should set payload.decision='blocked' for a blocked decision", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-diff-blocked",
          decision: "blocked",
          reason: "Blocked reason",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-diff-blocked",
        decision: "blocked",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.payload.decision).toBe("blocked");
    });

    it("should set payload.decision='complete' for a complete decision", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-diff-complete",
          decision: "complete",
          reason: "Complete reason",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-diff-complete",
        decision: "complete",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.payload.decision).toBe("complete");
    });

    it("should set payload.decision='repeat' for a repeat decision with board mutation", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-diff-repeat",
          decision: "repeat",
          reason: "Repeat reason",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-diff-repeat",
        decision: "repeat",
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.payload.decision).toBe("repeat");
    });

    it("should set payload.decision='repeat' for a continue decision (mapped to REPEAT in the event payload)", async () => {
      // The implementation maps "continue" to DecisionType.REPEAT when
      // building the event payload, even though "continue" is treated as
      // substantive at the outer isSubstantive check. The downstream
      // payload's `decision` field will be "repeat" (not "continue").
      const tool = createTool(
        {
          ok: true,
          project_id: "project-diff-continue",
          decision: "continue",
          reason: "Continue reason",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-diff-continue",
        decision: "repeat", // valid schema value
      });

      const event = getCycleDecisionEvent();
      expect(event).toBeDefined();
      expect(event?.payload.decision).toBe("repeat");
    });

    it("should set payload.reasoning to the input reason for every substantive decision type", async () => {
      for (const config of SUBSTANTIVE_DECISIONS) {
        emittedEvents = [];
        vi.clearAllMocks();

        const tool = createTool(
          {
            ok: true,
            project_id: `project-r-${config.label}`,
            decision: config.decision,
            reason: config.reason,
            persisted: true,
            duplicate: false,
          },
          config.mutation,
        );

        await tool.execute(context, {
          ...baseParams,
          project_id: `project-r-${config.label}`,
          decision: config.inputDecision,
        });

        const event = getCycleDecisionEvent();
        expect(
          event,
          `expected cycle decision event for ${config.label}`,
        ).toBeDefined();
        expect(event?.payload.reasoning).toBe(config.reason);
      }
    });

    it("should produce distinguishable payloads when blocked and complete run on the same project", async () => {
      emittedEvents = [];
      vi.clearAllMocks();

      const blockedTool = createTool(
        {
          ok: true,
          project_id: "project-same",
          decision: "blocked",
          reason: "First: blocked by external system",
          persisted: true,
          duplicate: false,
        },
        false,
      );
      await blockedTool.execute(context, {
        ...baseParams,
        project_id: "project-same",
        decision: "blocked",
      });

      // Wait a millisecond to guarantee the second emission receives a
      // different Date.now() value in the eventId. The production eventId
      // is timestamp-based so two events emitted in the same millisecond
      // would share an id; the test does not assert id uniqueness anyway
      // but the small delay avoids any cross-test pollution.
      await new Promise((resolve) => setTimeout(resolve, 2));

      const completeTool = createTool(
        {
          ok: true,
          project_id: "project-same",
          decision: "complete",
          reason: "Second: all goals met",
          persisted: true,
          duplicate: false,
        },
        false,
      );
      await completeTool.execute(context, {
        ...baseParams,
        project_id: "project-same",
        decision: "complete",
      });

      const cycleEvents = emittedEvents.filter(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      expect(cycleEvents).toHaveLength(2);
      expect(cycleEvents[0].payload.decision).toBe("blocked");
      expect(cycleEvents[1].payload.decision).toBe("complete");
      // The reasoning field must also differ so a downstream consumer can
      // tell the two events apart.
      expect(cycleEvents[0].payload.reasoning).not.toBe(
        cycleEvents[1].payload.reasoning,
      );
      // Both events must share the same projectId.
      expect(cycleEvents[0].payload.projectId).toBe("project-same");
      expect(cycleEvents[1].payload.projectId).toBe("project-same");
      // The events were emitted at different millisecond timestamps so
      // their eventIds are distinct.
      expect(cycleEvents[0].eventId).not.toBe(cycleEvents[1].eventId);
    });
  });

  // -------------------------------------------------------------------------
  // Event ordering: cycle decision event before learning candidate event
  // -------------------------------------------------------------------------

  describe("Event ordering: cycle decision event before learning candidate event", () => {
    it("should emit kanban.retrospective_cycle_decision_recorded before learning.candidate.proposed for a blocked decision", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-order-blocked",
          decision: "blocked",
          reason: "Ordering test for blocked",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-order-blocked",
        decision: "blocked",
      });

      const cycleIdx = emittedEvents.findIndex(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      const learningIdx = emittedEvents.findIndex(
        (e) => e.eventName === LEARNING_CANDIDATE_PROPOSED_EVENT,
      );

      expect(cycleIdx).toBeGreaterThanOrEqual(0);
      expect(learningIdx).toBeGreaterThanOrEqual(0);
      expect(cycleIdx).toBeLessThan(learningIdx);
    });

    it("should emit kanban.retrospective_cycle_decision_recorded before learning.candidate.proposed for a complete decision", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-order-complete",
          decision: "complete",
          reason: "Ordering test for complete",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-order-complete",
        decision: "complete",
      });

      const cycleIdx = emittedEvents.findIndex(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      const learningIdx = emittedEvents.findIndex(
        (e) => e.eventName === LEARNING_CANDIDATE_PROPOSED_EVENT,
      );

      expect(cycleIdx).toBeGreaterThanOrEqual(0);
      expect(learningIdx).toBeGreaterThanOrEqual(0);
      expect(cycleIdx).toBeLessThan(learningIdx);
    });

    it("should emit kanban.retrospective_cycle_decision_recorded before learning.candidate.proposed for a repeat-with-mutation decision", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-order-repeat",
          decision: "repeat",
          reason: "Ordering test for repeat",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-order-repeat",
        decision: "repeat",
      });

      const cycleIdx = emittedEvents.findIndex(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      const learningIdx = emittedEvents.findIndex(
        (e) => e.eventName === LEARNING_CANDIDATE_PROPOSED_EVENT,
      );

      expect(cycleIdx).toBeGreaterThanOrEqual(0);
      expect(learningIdx).toBeGreaterThanOrEqual(0);
      expect(cycleIdx).toBeLessThan(learningIdx);
    });

    it("should emit kanban.retrospective_cycle_decision_recorded before learning.candidate.proposed for a continue decision", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-order-continue",
          decision: "continue",
          reason: "Ordering test for continue",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-order-continue",
        decision: "repeat",
      });

      const cycleIdx = emittedEvents.findIndex(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      const learningIdx = emittedEvents.findIndex(
        (e) => e.eventName === LEARNING_CANDIDATE_PROPOSED_EVENT,
      );

      expect(cycleIdx).toBeGreaterThanOrEqual(0);
      expect(learningIdx).toBeGreaterThanOrEqual(0);
      expect(cycleIdx).toBeLessThan(learningIdx);
    });
  });

  // -------------------------------------------------------------------------
  // Error paths: no event emitted
  // -------------------------------------------------------------------------

  describe("Event NOT emitted on error paths", () => {
    it("should NOT emit any event when the record tool returns ok=false", async () => {
      const tool = createTool(
        {
          ok: false,
          project_id: "project-okfalse",
          decision: "blocked",
          reason: "Persistence failed upstream",
          persisted: false,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-okfalse",
        decision: "blocked",
      });

      expect(getCycleDecisionEvent()).toBeUndefined();
      expect(getLearningCandidateEvent()).toBeUndefined();
    });

    it("should NOT emit any event when the record tool returns persisted=false", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-notpersisted",
          decision: "blocked",
          reason: "Record tool did not persist",
          persisted: false,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-notpersisted",
        decision: "blocked",
      });

      expect(getCycleDecisionEvent()).toBeUndefined();
      expect(getLearningCandidateEvent()).toBeUndefined();
    });

    it("should NOT emit any event when the record tool reports a duplicate replay", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-dupe-replay",
          decision: "complete",
          reason: "Duplicate replay should not re-emit",
          persisted: true,
          duplicate: true,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        project_id: "project-dupe-replay",
        decision: "complete",
      });

      expect(getCycleDecisionEvent()).toBeUndefined();
      expect(getLearningCandidateEvent()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // boardStateSummary structure for every substantive decision
  // -------------------------------------------------------------------------

  describe("boardStateSummary structure for every substantive decision", () => {
    for (const config of SUBSTANTIVE_DECISIONS) {
      it(`should include a structured boardStateSummary for ${config.label}`, async () => {
        const tool = createTool(
          {
            ok: true,
            project_id: `project-bss-${config.label}`,
            decision: config.decision,
            reason: config.reason,
            persisted: true,
            duplicate: false,
          },
          config.mutation,
        );

        await tool.execute(context, {
          ...baseParams,
          project_id: `project-bss-${config.label}`,
          decision: config.inputDecision,
        });

        const event = getCycleDecisionEvent();
        expect(
          event,
          `expected cycle decision event for ${config.label}`,
        ).toBeDefined();

        const bss = event?.payload.boardStateSummary as Record<string, unknown>;
        expect(bss).toBeDefined();
        expect(bss).toHaveProperty("workItems");
        expect(bss).toHaveProperty("goals");

        const workItems = bss.workItems as Record<string, unknown>;
        expect(workItems).toHaveProperty("total");
        expect(typeof workItems.total).toBe("number");
        expect(workItems).toHaveProperty("countsByStatus");
        expect(typeof workItems.countsByStatus).toBe("object");

        const goals = bss.goals as Record<string, unknown>;
        expect(goals).toHaveProperty("total");
        expect(typeof goals.total).toBe("number");
        expect(goals).toHaveProperty("countsByStatus");
        expect(typeof goals.countsByStatus).toBe("object");
      });
    }
  });

  // -------------------------------------------------------------------------
  // cycleMetadata structure for every substantive decision
  // -------------------------------------------------------------------------

  describe("cycleMetadata structure for every substantive decision", () => {
    for (const config of SUBSTANTIVE_DECISIONS) {
      it(`should include the cycleMetadata workflow context for ${config.label}`, async () => {
        const tool = createTool(
          {
            ok: true,
            project_id: `project-cm-${config.label}`,
            decision: config.decision,
            reason: config.reason,
            persisted: true,
            duplicate: false,
          },
          config.mutation,
        );

        await tool.execute(context, {
          ...baseParams,
          project_id: `project-cm-${config.label}`,
          decision: config.inputDecision,
        });

        const event = getCycleDecisionEvent();
        expect(
          event,
          `expected cycle decision event for ${config.label}`,
        ).toBeDefined();

        const cycleMetadata = event?.payload.cycleMetadata as Record<
          string,
          unknown
        >;
        expect(cycleMetadata).toBeDefined();
        expect(cycleMetadata.workflowRunId).toBe(context.workflowRunId);
        expect(cycleMetadata.jobId).toBe(context.jobId);
        expect(cycleMetadata.decisionSource).toBe("orchestration_cycle");
      });
    }
  });

  // -------------------------------------------------------------------------
  // Sequential integration: all four substantive decisions
  // -------------------------------------------------------------------------

  describe("Sequential integration: all four substantive decisions emit distinct events", () => {
    it("should emit exactly four retrospective events when all four substantive decisions run in sequence", async () => {
      emittedEvents = [];
      vi.clearAllMocks();

      const projects = [
        "project-seq-1-blocked",
        "project-seq-2-complete",
        "project-seq-3-repeat-mut",
        "project-seq-4-continue",
      ];

      for (let i = 0; i < SUBSTANTIVE_DECISIONS.length; i++) {
        const config = SUBSTANTIVE_DECISIONS[i];
        const projectId = projects[i];
        if (!config || !projectId) {
          throw new Error(`Test data missing for index ${i}`);
        }

        const tool = createTool(
          {
            ok: true,
            project_id: projectId,
            decision: config.decision,
            reason: config.reason,
            persisted: true,
            duplicate: false,
          },
          config.mutation,
        );

        await tool.execute(context, {
          ...baseParams,
          project_id: projectId,
          decision: config.inputDecision,
        });
      }

      const cycleEvents = emittedEvents.filter(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      expect(cycleEvents).toHaveLength(4);

      // Each event must have a unique eventId.
      const eventIds = cycleEvents.map((e) => e.eventId);
      expect(new Set(eventIds).size).toBe(4);

      // Each event must have a unique projectId (matches the input).
      const projectIds = cycleEvents.map((e) => e.payload.projectId);
      expect(new Set(projectIds).size).toBe(4);

      // The decision field in each event payload must be one of the
      // expected enum values. 'continue' maps to 'repeat'.
      const decisions = cycleEvents.map((e) => e.payload.decision);
      expect(decisions).toEqual(
        expect.arrayContaining(["blocked", "complete", "repeat"]),
      );
      // No 'continue' value should appear in payload.decision because the
      // implementation maps it to DecisionType.REPEAT.
      expect(decisions).not.toContain("continue");
    });

    it("should emit no retrospective or learning events when only trivial repeats run", async () => {
      emittedEvents = [];
      vi.clearAllMocks();

      const trivialConfigs = [
        { project: "project-trivial-1", reason: "Trivial 1" },
        { project: "project-trivial-2", reason: "Trivial 2" },
        { project: "project-trivial-3", reason: "Trivial 3" },
      ];

      for (const config of trivialConfigs) {
        const tool = createTool(
          {
            ok: true,
            project_id: config.project,
            decision: "repeat",
            reason: config.reason,
            persisted: true,
            duplicate: false,
          },
          false, // no mutation → trivial repeat
        );

        await tool.execute(context, {
          ...baseParams,
          project_id: config.project,
          decision: "repeat",
        });
      }

      const cycleEvents = emittedEvents.filter(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      expect(cycleEvents).toHaveLength(0);

      const learningEvents = emittedEvents.filter(
        (e) => e.eventName === LEARNING_CANDIDATE_PROPOSED_EVENT,
      );
      expect(learningEvents).toHaveLength(0);
    });

    it("should emit events only for the substantive runs in a mixed sequence (trivial + substantive)", async () => {
      // Mix: trivial, substantive, trivial, substantive. Only the two
      // substantive runs should emit events.
      emittedEvents = [];
      vi.clearAllMocks();

      const mixed = [
        {
          project: "mixed-1-trivial",
          decision: "repeat" as const,
          mutation: false,
          reason: "Trivial run",
        },
        {
          project: "mixed-2-blocked",
          decision: "blocked" as const,
          mutation: false,
          reason: "Blocked run",
        },
        {
          project: "mixed-3-trivial",
          decision: "repeat" as const,
          mutation: false,
          reason: "Trivial run",
        },
        {
          project: "mixed-4-complete",
          decision: "complete" as const,
          mutation: false,
          reason: "Complete run",
        },
      ];

      for (const config of mixed) {
        const tool = createTool(
          {
            ok: true,
            project_id: config.project,
            decision: config.decision,
            reason: config.reason,
            persisted: true,
            duplicate: false,
          },
          config.mutation,
        );

        await tool.execute(context, {
          ...baseParams,
          project_id: config.project,
          decision: config.decision,
        });
      }

      const cycleEvents = emittedEvents.filter(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      expect(cycleEvents).toHaveLength(2);
      const cycleProjectIds = cycleEvents.map((e) => e.payload.projectId);
      expect(cycleProjectIds).toEqual(
        expect.arrayContaining(["mixed-2-blocked", "mixed-4-complete"]),
      );

      const learningEvents = emittedEvents.filter(
        (e) => e.eventName === LEARNING_CANDIDATE_PROPOSED_EVENT,
      );
      expect(learningEvents).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Edge case: 'pause' input
  // -------------------------------------------------------------------------

  describe("Edge case: 'pause' input is never substantive", () => {
    it("should NOT emit a retrospective event for a 'pause' decision without board mutation", async () => {
      const tool = createTool(
        {
          ok: true,
          project_id: "project-pause-nomut",
          decision: "pause",
          reason: "Pausing the cycle for review",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        project_id: "project-pause-nomut",
        decision: "pause",
      });

      expect(result.isSubstantive).toBe(false);
      expect(getCycleDecisionEvent()).toBeUndefined();
      expect(getLearningCandidateEvent()).toBeUndefined();
    });

    it("should NOT emit a retrospective event for a 'pause' decision even when board mutation is detected", async () => {
      // 'pause' is not in the substantive list regardless of mutation
      // detection. The outer isSubstantive check only treats 'blocked',
      // 'complete', 'continue', or 'repeat+mutation' as substantive.
      const tool = createTool(
        {
          ok: true,
          project_id: "project-pause-mut",
          decision: "pause",
          reason: "Pausing the cycle, but board did change",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        project_id: "project-pause-mut",
        decision: "pause",
      });

      expect(result.isSubstantive).toBe(false);
      expect(getCycleDecisionEvent()).toBeUndefined();
      expect(getLearningCandidateEvent()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // eventId stability: every substantive decision produces a deterministic
  // eventId prefix per (project, workflowRun) tuple.
  // -------------------------------------------------------------------------

  describe("eventId structure for every substantive decision", () => {
    for (const config of SUBSTANTIVE_DECISIONS) {
      it(`should produce a scoped eventId for ${config.label}`, async () => {
        const projectId = `project-eid-${config.label}`;
        const tool = createTool(
          {
            ok: true,
            project_id: projectId,
            decision: config.decision,
            reason: config.reason,
            persisted: true,
            duplicate: false,
          },
          config.mutation,
        );

        await tool.execute(context, {
          ...baseParams,
          project_id: projectId,
          decision: config.inputDecision,
        });

        const event = getCycleDecisionEvent();
        expect(event).toBeDefined();
        expect(event?.eventId).toMatch(
          new RegExp(
            `^kanban:retrospective_cycle_decision:${projectId}:${context.workflowRunId}:\\d+$`,
          ),
        );
      });
    }
  });
});

// =============================================================================
// BoardStateService → cycle-decision converter helpers (M5)
//
// These tests exercise the extractBoardStateSummary helper directly with
// service-shaped BoardStateSummary inputs to lock in the contract that the
// helper reads `work_item_counts` and `goal_coverage` when present, and
// falls back to zero / empty when they are absent. The downstream event-
// shaped BoardStateSummary is what the retrospective event consumers see.
// =============================================================================

describe("BoardStateService → cycle-decision converter helpers (M5)", () => {
  it("extractBoardStateSummary reads work_item_counts and goal_coverage from a fully-populated service-shaped BoardStateSummary", () => {
    const serviceSummary: ServiceBoardStateSummary = {
      projectId: "proj-m5-full",
      totalTasks: 17,
      completedTasks: 8,
      blockedTasks: 1,
      inProgressTasks: 3,
      pendingTasks: 5,
      lastActivityAt: new Date("2024-06-15T12:00:00Z"),
      work_item_counts: {
        total: 17,
        byStatus: { done: 8, todo: 5, "in-progress": 3, blocked: 1 },
        activeCount: 9,
        doneCount: 8,
      },
      goal_coverage: {
        total: 3,
        active: 2,
        completed: 1,
        coveragePercentage: 33.33,
      },
    };

    const result = extractBoardStateSummary(serviceSummary);

    expect(result.workItems.total).toBe(17);
    expect(result.workItems.countsByStatus).toEqual({
      done: 8,
      todo: 5,
      "in-progress": 3,
      blocked: 1,
    });
    expect(result.goals.total).toBe(3);
    // goals.countsByStatus is intentionally hardcoded to {} by the
    // extractor (M0 discovery) — preserve that contract here.
    expect(result.goals.countsByStatus).toEqual({});
  });

  it("extractBoardStateSummary falls back to zero when work_item_counts and goal_coverage are undefined", () => {
    const serviceSummary: ServiceBoardStateSummary = {
      projectId: "proj-m5-empty",
      totalTasks: 0,
      completedTasks: 0,
      blockedTasks: 0,
      inProgressTasks: 0,
      pendingTasks: 0,
      lastActivityAt: null,
      work_item_counts: undefined,
      goal_coverage: undefined,
    };

    const result = extractBoardStateSummary(serviceSummary);

    expect(result.workItems.total).toBe(0);
    expect(result.workItems.countsByStatus).toEqual({});
    expect(result.goals.total).toBe(0);
    expect(result.goals.countsByStatus).toEqual({});
  });
});
