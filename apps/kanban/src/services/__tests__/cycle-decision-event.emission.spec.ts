/**
 * Unit tests for kanban.retrospective_cycle_decision_recorded event emission.
 *
 * Tests the event emission behavior of the CompleteOrchestrationCycleDecisionTool,
 * verifying that events are emitted for substantive decisions and contain the correct payload.
 *
 * Event emission rules:
 * - IS emitted for: 'blocked', 'complete', and 'repeat' with boardMutationDetected=true
 * - NOT emitted for: 'repeat' with boardMutationDetected=false (trivial repeat)
 */

import { Test } from "@nestjs/testing";
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CompleteOrchestrationCycleDecisionTool } from "../../mcp/tools/mutation/complete-orchestration-cycle-decision.tool";
import { OrchestrationRecordCycleDecisionTool } from "../../mcp/tools/mutation/orchestration-record-cycle-decision.tool";
import { BoardStateService } from "../board-state.service";
import { CoreWorkflowClientService } from "../../core/core-workflow-client.service";
import { KanbanRetrospectiveEvidenceService } from "../../retrospectives/kanban-retrospective-evidence.service";
import { BoardStateRepository } from "../../database/repositories/kanban-board-state-snapshot.repository";
import { KanbanProjectRepository } from "../../database/repositories/kanban-project.repository";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository";
import { KanbanProjectGoalRepository } from "../../database/repositories/kanban-project-goal.repository";
import type { KanbanBoardStateSnapshotEntity } from "../../database/entities/kanban-board-state-snapshot.entity";
import type { KanbanProjectEntity } from "../../database/entities/kanban-project.entity";
import type { KanbanWorkItemEntity } from "../../database/entities/kanban-work-item.entity";
import type { BoardStateSummary } from "../../retrospectives/types/cycle-decision.types";
import { DecisionType } from "../../retrospectives/types/cycle-decision.types";

// Test constants
const RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT =
  "kanban.retrospective_cycle_decision_recorded.v1";

interface EmittedEvent {
  eventName: string;
  eventId: string;
  payload: {
    eventName?: string;
    projectId?: string;
    decision?: DecisionType | string;
    reasoning?: string;
    idempotencyKey?: string | null;
    boardStateSummary?: BoardStateSummary;
    timestamp?: string;
    cycleMetadata?: {
      workflowRunId: string | null;
      jobId: string | null;
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

interface MockBoardStateRepository {
  findLatestByProjectIdAndIdempotencyKeyPrefix: ReturnType<typeof vi.fn>;
  findLatestByProjectId: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

interface MockKanbanProjectRepository {
  findById: ReturnType<typeof vi.fn>;
}

interface MockKanbanWorkItemRepository {
  findByproject_id: ReturnType<typeof vi.fn>;
}

interface MockKanbanProjectGoalRepository {
  findByproject_id: ReturnType<typeof vi.fn>;
}

// Deterministic work items used across all tests
// Total of 17 items: 5 todo, 3 in-progress, 8 done, 1 blocked
function makeWorkItems(projectId: string): Partial<KanbanWorkItemEntity>[] {
  const items: Partial<KanbanWorkItemEntity>[] = [];
  const timestamp = new Date("2024-06-15T12:00:00Z");
  for (let i = 0; i < 5; i++) {
    items.push({
      id: `${projectId}-todo-${i}`,
      project_id: projectId,
      status: "todo",
      title: `Todo ${i}`,
      description: null,
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  for (let i = 0; i < 3; i++) {
    items.push({
      id: `${projectId}-in-progress-${i}`,
      project_id: projectId,
      status: "in-progress",
      title: `InProgress ${i}`,
      description: null,
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  for (let i = 0; i < 8; i++) {
    items.push({
      id: `${projectId}-done-${i}`,
      project_id: projectId,
      status: "done",
      title: `Done ${i}`,
      description: null,
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  for (let i = 0; i < 1; i++) {
    items.push({
      id: `${projectId}-blocked-${i}`,
      project_id: projectId,
      status: "blocked",
      title: `Blocked ${i}`,
      description: null,
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  return items;
}

function makeProject(projectId: string): Partial<KanbanProjectEntity> {
  return {
    id: projectId,
    name: "Test Project",
    goals: null,
    repository_url: null,
    base_path: null,
    github_secret_id: null,
    description: null,
    source_type: null,
    copy_to_workspace: null,
    allow_host_mounts: null,
    deny_host_mounts: null,
    allow_host_mount_rw: null,
    repository_workflow_settings: { enabled: true, overrides: {} },
    created_at: new Date("2024-01-01T00:00:00Z"),
    updated_at: new Date("2024-01-01T00:00:00Z"),
  };
}

describe("CycleDecisionEventEmission", () => {
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

  // Mock repositories used for the real BoardStateService
  let mockBoardStateRepository: MockBoardStateRepository;
  let mockProjects: MockKanbanProjectRepository;
  let mockWorkItems: MockKanbanWorkItemRepository;
  let mockGoals: MockKanbanProjectGoalRepository;
  // Real BoardStateService wired via Test.createTestingModule
  let boardStateService: BoardStateService;

  // Mock factories for the tool's other dependencies
  function createMockRecordTool(result: MockRecordToolResult) {
    return {
      execute: vi.fn().mockResolvedValue(result),
    } as unknown as OrchestrationRecordCycleDecisionTool;
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

  /**
   * Configure the real BoardStateService to either detect or skip a board
   * mutation. Detection is driven by the contents of the previous snapshot
   * returned from findLatestByProjectIdAndIdempotencyKeyPrefix:
   *   - mutationDetected=true:  return a previous snapshot with stale
   *                             snapshot_data so deep-equal reports a change.
   *   - mutationDetected=false: return null (no previous snapshot, so the
   *                             service short-circuits with hasMutations=false).
   */
  function configureBoardMutation(mutationDetected: boolean): void {
    if (mutationDetected) {
      mockBoardStateRepository.findLatestByProjectIdAndIdempotencyKeyPrefix.mockResolvedValue(
        {
          id: "previous-snapshot",
          project_id: "project-abc",
          idempotency_key: "cycle-2024-001",
          snapshot_data: {
            workItems: [],
            timestamp: "2020-01-01T00:00:00.000Z",
            summary: { totalWorkItems: 0, columnDistribution: {} },
          },
          work_item_count: 0,
          column_distribution: {},
          created_at: new Date("2020-01-01T00:00:00Z"),
          updated_at: new Date("2020-01-01T00:00:00Z"),
        },
      );
    } else {
      mockBoardStateRepository.findLatestByProjectIdAndIdempotencyKeyPrefix.mockResolvedValue(
        null,
      );
    }
  }

  function createTool(
    recordToolResult: MockRecordToolResult,
    mutationDetected: boolean,
  ): {
    tool: CompleteOrchestrationCycleDecisionTool;
    recordTool: OrchestrationRecordCycleDecisionTool;
    coreClient: CoreWorkflowClientService;
  } {
    const recordTool = createMockRecordTool(recordToolResult);
    const coreClient = createMockCoreClient();
    const evidenceService = createMockEvidenceService();

    configureBoardMutation(mutationDetected);

    const tool = new CompleteOrchestrationCycleDecisionTool(
      recordTool,
      coreClient,
      evidenceService,
      boardStateService,
    );

    return { tool, recordTool, coreClient };
  }

  function getEmittedCycleDecisionEvent(): EmittedEvent | undefined {
    return emittedEvents.find(
      (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
    );
  }

  beforeEach(async () => {
    emittedEvents = [];
    vi.clearAllMocks();

    mockBoardStateRepository = {
      findLatestByProjectIdAndIdempotencyKeyPrefix: vi.fn(),
      findLatestByProjectId: vi.fn(),
      save: vi.fn(),
    };
    mockProjects = {
      findById: vi.fn(),
    };
    mockWorkItems = {
      findByproject_id: vi.fn(),
    };
    mockGoals = {
      findByproject_id: vi.fn(),
    };

    // Default deterministic data: 17 work items, project exists,
    // snapshots persist successfully, no previous snapshot by default,
    // and no goals (per-test overrides can populate goals via
    // mockResolvedValueOnce).
    mockWorkItems.findByproject_id.mockResolvedValue(
      makeWorkItems("project-abc"),
    );
    mockProjects.findById.mockResolvedValue(makeProject("project-abc"));
    mockGoals.findByproject_id.mockResolvedValue([]);
    mockBoardStateRepository.save.mockImplementation(
      (snapshot: Partial<KanbanBoardStateSnapshotEntity>) => ({
        id: `${snapshot.project_id}-snapshot`,
        project_id: snapshot.project_id ?? "project-abc",
        idempotency_key: snapshot.idempotency_key ?? "test-key",
        snapshot_data: snapshot.snapshot_data ?? {},
        work_item_count: snapshot.work_item_count ?? 0,
        column_distribution: snapshot.column_distribution ?? {},
        created_at: new Date("2024-06-15T12:00:00Z"),
        updated_at: new Date("2024-06-15T12:00:00Z"),
      }),
    );
    mockBoardStateRepository.findLatestByProjectIdAndIdempotencyKeyPrefix.mockResolvedValue(
      null,
    );

    const module = await Test.createTestingModule({
      providers: [
        BoardStateService,
        { provide: BoardStateRepository, useValue: mockBoardStateRepository },
        { provide: KanbanProjectRepository, useValue: mockProjects },
        { provide: KanbanWorkItemRepository, useValue: mockWorkItems },
        { provide: KanbanProjectGoalRepository, useValue: mockGoals },
      ],
    }).compile();

    boardStateService = module.get(BoardStateService);
  });

  // =============================================================================
  // Test Suite 1: Event IS emitted for substantive decisions with boardMutation=true
  // =============================================================================

  describe("Event IS emitted for substantive decisions (boardMutation=true)", () => {
    it("should emit event for decision='blocked' with boardMutation=true", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Human intervention required",
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
      expect(event).toBeDefined();
      expect(event?.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should emit event for decision='complete' with boardMutation=true", async () => {
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

    it("should emit event for decision='repeat' with boardMutation=true", async () => {
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

    it("should emit event for decision='blocked' even when boardMutation=false (always substantive)", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Blocked without mutation",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event).toBeDefined();
    });

    it("should emit event for decision='complete' even when boardMutation=false (always substantive)", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Complete without mutation",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event).toBeDefined();
    });
  });

  // =============================================================================
  // Test Suite 2: Event is NOT emitted for repeat with boardMutation=false
  // =============================================================================

  describe("Event is NOT emitted for trivial decisions (boardMutation=false for repeat)", () => {
    it("should NOT emit event for decision='repeat' with boardMutation=false", async () => {
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

    it("should NOT emit any kanban.retrospective_cycle_decision_recorded event for trivial repeat", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "repeat",
          reason: "No board changes",
          persisted: true,
          duplicate: false,
        },
        false,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "repeat",
      });

      const relevantEvents = emittedEvents.filter(
        (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
      expect(relevantEvents).toHaveLength(0);
    });
  });

  // =============================================================================
  // Test Suite 3: Event payload contains all required fields
  // =============================================================================

  describe("Event payload contains all required fields", () => {
    it("should include eventName as 'kanban.retrospective_cycle_decision_recorded.v1'", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Payload verification test",
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
      expect(event?.payload.eventName).toBe(
        RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      );
    });

    it("should include projectId from input params", async () => {
      const projectId = "project-test-123";
      mockWorkItems.findByproject_id.mockResolvedValue(
        makeWorkItems(projectId),
      );
      mockProjects.findById.mockResolvedValue(makeProject(projectId));
      const { tool } = createTool(
        {
          ok: true,
          project_id: projectId,
          decision: "complete",
          reason: "Project ID verification",
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

    it("should include decision matching the recorded decision", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Decision field verification",
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
      // Decision is the DecisionType enum value derived from the record result
      expect(event?.payload.decision).toBe(DecisionType.COMPLETE);
    });

    it("should include reasoning from input params", async () => {
      const reason = "All objectives achieved, cycle complete";
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

    it("should include idempotencyKey from input params", async () => {
      const idempotencyKey = "cycle-2024-06-15-abc123";
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Idempotency key verification",
          persisted: true,
          duplicate: false,
        },
        true,
      );

      await tool.execute(context, {
        ...baseParams,
        decision: "blocked",
        idempotency_key: idempotencyKey,
      });

      const event = getEmittedCycleDecisionEvent();
      expect(event?.payload.idempotencyKey).toBe(idempotencyKey);
    });

    it("should include boardStateSummary with workItems and goals populated by the real service", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "blocked",
          reason: "Board state summary verification",
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
      // The real BoardStateService populates work_item_counts and
      // goal_coverage from the underlying work-item and goal repositories.
      // With 17 default work items (5 todo, 3 in-progress, 8 done, 1
      // blocked) and no goals, the extractBoardStateSummary helper maps
      // these into the event's boardStateSummary shape: a non-zero work
      // item histogram and an empty goal taxonomy.
      expect(event?.payload.boardStateSummary).toBeDefined();
      expect(event?.payload.boardStateSummary?.workItems).toBeDefined();
      expect(event?.payload.boardStateSummary?.workItems.total).toBe(17);
      expect(
        event?.payload.boardStateSummary?.workItems.countsByStatus,
      ).toEqual({
        todo: 5,
        "in-progress": 3,
        done: 8,
        blocked: 1,
      });
      expect(event?.payload.boardStateSummary?.goals).toBeDefined();
      expect(event?.payload.boardStateSummary?.goals.total).toBe(0);
      expect(event?.payload.boardStateSummary?.goals.countsByStatus).toEqual(
        {},
      );
    });

    it("should include timestamp in ISO 8601 format", async () => {
      const beforeTest = new Date();
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Timestamp format verification",
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
      const timestamp = event?.payload.timestamp;

      // Verify ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);

      // Verify timestamp is within test window
      const eventDate = new Date(timestamp ?? "");
      expect(eventDate.getTime()).toBeGreaterThanOrEqual(
        beforeTest.getTime() - 1000,
      );
      expect(eventDate.getTime()).toBeLessThanOrEqual(
        afterTest.getTime() + 1000,
      );
    });

    it("should include cycleMetadata with workflowRunId, jobId, and decisionSource", async () => {
      const { tool } = createTool(
        {
          ok: true,
          project_id: "project-abc",
          decision: "complete",
          reason: "Cycle metadata verification",
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
      expect(event?.payload.cycleMetadata).toBeDefined();
      expect(event?.payload.cycleMetadata?.workflowRunId).toBe("test-run-123");
      expect(event?.payload.cycleMetadata?.jobId).toBe("ceo_cycle_decision");
      expect(event?.payload.cycleMetadata?.decisionSource).toBe(
        "orchestration_cycle",
      );
    });
  });

  // =============================================================================
  // Additional tests: step_complete is called
  // =============================================================================

  describe("step_complete is called after event emission", () => {
    it("should not call stepComplete directly and return next_action='call_step_complete'", async () => {
      const stepCompleteSpy = vi.fn().mockResolvedValue({ ok: true });
      const coreClient = createMockCoreClient();
      (coreClient as { stepComplete: unknown }).stepComplete = stepCompleteSpy;

      const recordTool = createMockRecordTool({
        ok: true,
        project_id: "project-abc",
        decision: "complete",
        reason: "Step complete verification",
        persisted: true,
        duplicate: false,
      });

      const evidenceService = createMockEvidenceService();

      configureBoardMutation(true);

      const tool = new CompleteOrchestrationCycleDecisionTool(
        recordTool,
        coreClient,
        evidenceService,
        boardStateService,
      );

      const result = await tool.execute(context, {
        ...baseParams,
        decision: "complete",
      });

      expect(stepCompleteSpy).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        next_action: "call_step_complete",
        step_complete_called: false,
      });
    });
  });
});
