/**
 * M6 integration test: BoardStateService → complete-orchestration-cycle-decision tool.
 *
 * This is the end-to-end regression test that exercises the real
 * BoardStateService (with all four repository dependencies mocked at the
 * boundary) through the real CompleteOrchestrationCycleDecisionTool
 * (constructed via NestJS DI, with its other dependencies mocked).
 *
 * Background: an earlier iteration of BoardStateService produced empty
 * `work_item_counts` and `goal_coverage` summaries, so the event payload
 * emitted by the cycle-decision tool always carried `boardStateSummary.workItems.total === 0`
 * and `boardStateSummary.goals.total === 0`. This test wires the full chain
 * — BoardStateService → tool → extractor → emitted event — with deterministic
 * fixtures (5 work items across four statuses, 3 goals across two statuses)
 * and asserts that the totals survive the entire pipeline. A regression
 * that re-introduces empty summaries would fail both assertions.
 *
 * Deterministic fixtures:
 *   - 5 work items: 2 done, 1 in-progress, 1 blocked, 1 todo
 *   - 3 goals:     1 done, 2 in-progress
 *
 * Expected event payload carries:
 *   - boardStateSummary.workItems.total        === 5
 *   - boardStateSummary.workItems.countsByStatus === { todo: 1, in-progress: 1, done: 2, blocked: 1 }
 *   - boardStateSummary.goals.total            === 3
 */

import { Test } from "@nestjs/testing";
import type { InternalToolExecutionContext } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardStateService } from "../board-state.service";
import { CompleteOrchestrationCycleDecisionTool } from "../../mcp/tools/mutation/complete-orchestration-cycle-decision.tool";
import { OrchestrationRecordCycleDecisionTool } from "../../mcp/tools/mutation/orchestration-record-cycle-decision.tool";
import { CoreWorkflowClientService } from "../../core/core-workflow-client.service";
import { KanbanRetrospectiveEvidenceService } from "../../retrospectives/kanban-retrospective-evidence.service";
import { BoardStateRepository } from "../../database/repositories/kanban-board-state-snapshot.repository";
import { KanbanProjectRepository } from "../../database/repositories/kanban-project.repository";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository";
import { KanbanProjectGoalRepository } from "../../database/repositories/kanban-project-goal.repository";
import type { KanbanBoardStateSnapshotEntity } from "../../database/entities/kanban-board-state-snapshot.entity";
import type { KanbanProjectEntity } from "../../database/entities/kanban-project.entity";
import type { KanbanProjectGoalEntity } from "../../database/entities/kanban-project-goal.entity";
import type { KanbanWorkItemEntity } from "../../database/entities/kanban-work-item.entity";
import type { BoardStateSummary } from "../../retrospectives/types/cycle-decision.types";

const RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT =
  "kanban.retrospective_cycle_decision_recorded.v1";

interface EmittedEvent {
  eventName: string;
  eventId: string;
  payload: {
    eventName?: string;
    projectId?: string;
    decision?: string;
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

/**
 * Build the deterministic M6 work-item fixture set.
 *
 * Returns five partial KanbanWorkItemEntity fixtures distributed across
 * statuses: two done, one in-progress, one blocked, one todo.
 */
function makeWorkItems(projectId: string): Partial<KanbanWorkItemEntity>[] {
  const created = new Date("2024-06-15T12:00:00Z");
  const updated = new Date("2024-06-15T12:00:00Z");
  const statuses = ["done", "done", "in-progress", "blocked", "todo"] as const;

  return statuses.map((status, index) => ({
    id: `${projectId}-wi-${index}`,
    project_id: projectId,
    status,
    title: `${projectId} item ${index} (${status})`,
    description: null,
    priority: "p2",
    scope: "standard",
    assigned_agent_id: null,
    token_spend: 0,
    cost_cents: 0,
    current_execution_id: null,
    waiting_for_input: false,
    execution_config: null,
    metadata: null,
    linked_run_id: null,
    initiative_id: null,
    created_at: created,
    updated_at: updated,
  }));
}

/**
 * Build the deterministic M6 goal fixture set.
 *
 * Returns three partial KanbanProjectGoalEntity fixtures: one done, two
 * in-progress.
 */
function makeGoals(projectId: string): Partial<KanbanProjectGoalEntity>[] {
  const timestamp = new Date("2024-06-15T12:00:00Z");
  return [
    {
      id: `${projectId}-goal-0`,
      project_id: projectId,
      status: "done",
      title: `${projectId} done goal`,
      description: null,
      moscow: null,
      priority: null,
      sort_order: 0,
      target_date: null,
      completed_at: timestamp,
      owner_agent_profile_id: null,
      metadata: null,
      is_archived: false,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: `${projectId}-goal-1`,
      project_id: projectId,
      status: "in-progress",
      title: `${projectId} active goal 1`,
      description: null,
      moscow: null,
      priority: null,
      sort_order: 1,
      target_date: null,
      completed_at: null,
      owner_agent_profile_id: null,
      metadata: null,
      is_archived: false,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: `${projectId}-goal-2`,
      project_id: projectId,
      status: "in-progress",
      title: `${projectId} active goal 2`,
      description: null,
      moscow: null,
      priority: null,
      sort_order: 2,
      target_date: null,
      completed_at: null,
      owner_agent_profile_id: null,
      metadata: null,
      is_archived: false,
      created_at: timestamp,
      updated_at: timestamp,
    },
  ];
}

function makeProject(projectId: string): Partial<KanbanProjectEntity> {
  return {
    id: projectId,
    name: "M6 Integration Project",
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

describe("BoardStateService → complete-orchestration-cycle-decision integration (M6)", () => {
  const projectId = "project-m6-integration";
  const context: InternalToolExecutionContext = {
    workflowRunId: "m6-run-001",
    jobId: "ceo_cycle_decision",
  };

  let emittedEvents: EmittedEvent[] = [];

  let mockBoardStateRepository: MockBoardStateRepository;
  let mockProjects: MockKanbanProjectRepository;
  let mockWorkItems: MockKanbanWorkItemRepository;
  let mockGoals: MockKanbanProjectGoalRepository;

  // Tool collaborators mocked at the boundary (BoardStateService is real).
  let coreClient: CoreWorkflowClientService;
  let recordTool: OrchestrationRecordCycleDecisionTool;
  let evidenceService: KanbanRetrospectiveEvidenceService;

  // Real instances under test, resolved through Test.createTestingModule.
  let boardStateService: BoardStateService;
  let tool: CompleteOrchestrationCycleDecisionTool;

  function findCycleDecisionEvent(): EmittedEvent | undefined {
    return emittedEvents.find(
      (e) => e.eventName === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
    );
  }

  beforeEach(async () => {
    emittedEvents = [];
    vi.clearAllMocks();

    // ---- M6 deterministic fixture: 5 work items, 3 goals ----
    mockBoardStateRepository = {
      // No previous snapshot for the test idempotency-key prefix → detect
      // returns hasMutations=false. With the "complete" decision path the
      // event is emitted regardless, so mutation state does not gate the
      // assertions under test.
      findLatestByProjectIdAndIdempotencyKeyPrefix: vi
        .fn()
        .mockResolvedValue(null),
      findLatestByProjectId: vi.fn().mockResolvedValue(null),
      save: vi
        .fn()
        .mockImplementation(
          (snapshot: Partial<KanbanBoardStateSnapshotEntity>) => ({
            id: `${snapshot.project_id ?? projectId}-snapshot`,
            project_id: snapshot.project_id ?? projectId,
            idempotency_key: snapshot.idempotency_key ?? "m6-key",
            snapshot_data: snapshot.snapshot_data ?? {},
            work_item_count: snapshot.work_item_count ?? 0,
            column_distribution: snapshot.column_distribution ?? {},
            created_at: new Date("2024-06-15T12:00:00Z"),
            updated_at: new Date("2024-06-15T12:00:00Z"),
          }),
        ),
    };
    mockProjects = {
      findById: vi.fn().mockResolvedValue(makeProject(projectId)),
    };
    mockWorkItems = {
      findByproject_id: vi.fn().mockResolvedValue(makeWorkItems(projectId)),
    };
    mockGoals = {
      findByproject_id: vi.fn().mockResolvedValue(makeGoals(projectId)),
    };

    // ---- Tool collaborators ----
    // The record tool reports a substantive, non-duplicate "complete"
    // decision; the core client captures emitted events into emittedEvents;
    // the evidence service returns a "ready" delta so workItemCountsSnapshot
    // is populated for the learning-candidate payload.
    recordTool = {
      execute: vi.fn().mockResolvedValue({
        ok: true,
        project_id: projectId,
        decision: "complete",
        reason: "M6 integration: all goals achieved",
        persisted: true,
        duplicate: false,
      }),
    } as unknown as OrchestrationRecordCycleDecisionTool;

    coreClient = {
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

    evidenceService = {
      collectProjectEvidence: vi.fn().mockResolvedValue({
        state: "ready",
        projectId,
        deltaSnapshot: {
          workItems: {
            total: 5,
            countsByStatus: {
              todo: 1,
              "in-progress": 1,
              done: 2,
              blocked: 1,
            },
          },
        },
      }),
    } as unknown as KanbanRetrospectiveEvidenceService;

    // ---- Real wiring via NestJS DI ----
    const moduleRef = await Test.createTestingModule({
      providers: [
        BoardStateService,
        {
          provide: BoardStateRepository,
          useValue: mockBoardStateRepository,
        },
        { provide: KanbanProjectRepository, useValue: mockProjects },
        { provide: KanbanWorkItemRepository, useValue: mockWorkItems },
        { provide: KanbanProjectGoalRepository, useValue: mockGoals },
        CompleteOrchestrationCycleDecisionTool,
        {
          provide: OrchestrationRecordCycleDecisionTool,
          useValue: recordTool,
        },
        { provide: CoreWorkflowClientService, useValue: coreClient },
        {
          provide: KanbanRetrospectiveEvidenceService,
          useValue: evidenceService,
        },
      ],
    }).compile();

    boardStateService = moduleRef.get(BoardStateService);
    tool = moduleRef.get(CompleteOrchestrationCycleDecisionTool);
  });

  it("confirms the real BoardStateService and tool resolved via DI", () => {
    // Sanity check: both instances are real classes, not mocks. This guards
    // against accidental shadowing during future refactors.
    expect(boardStateService).toBeInstanceOf(BoardStateService);
    expect(tool).toBeInstanceOf(CompleteOrchestrationCycleDecisionTool);
  });

  it("carries non-zero work item and goal totals through the entire chain on a 'complete' decision", async () => {
    const result = await tool.execute(context, {
      project_id: projectId,
      decision: "complete",
      reason: "M6 integration: all goals achieved",
      idempotency_key: "m6-cycle-complete",
    });

    // The tool completed successfully and the substantive flag is set.
    expect(result).toMatchObject({
      ok: true,
      project_id: projectId,
      decision: "complete",
      output_written: true,
      isSubstantive: true,
    });

    // The real BoardStateService was queried through the tool chain.
    // Note: the BoardStateService reads work items once for the snapshot
    // and once again inside getBoardStateSummary via the extractor, plus
    // a third call when detectBoardMutation compares distributions; we
    // assert >= 1 to remain tolerant of that internal sequencing.
    expect(mockWorkItems.findByproject_id).toHaveBeenCalled();
    expect(mockGoals.findByproject_id).toHaveBeenCalledWith(projectId, false);

    const event = findCycleDecisionEvent();
    expect(event).toBeDefined();
    expect(event?.eventName).toBe(RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT);

    const summary = event?.payload.boardStateSummary;
    expect(summary).toBeDefined();

    // Core regression assertions: the chain must carry non-zero totals.
    expect(summary?.workItems.total).toBeGreaterThan(0);
    expect(summary?.workItems.total).toBe(5);
    expect(summary?.goals.total).toBeGreaterThan(0);
    expect(summary?.goals.total).toBe(3);
  });

  it("propagates the deterministic status histogram from work-item fixtures", async () => {
    await tool.execute(context, {
      project_id: projectId,
      decision: "blocked",
      reason: "M6 integration: blocked decision",
      idempotency_key: "m6-cycle-blocked",
    });

    const event = findCycleDecisionEvent();
    expect(event).toBeDefined();

    const summary = event?.payload.boardStateSummary;
    expect(summary?.workItems.total).toBe(5);
    expect(summary?.workItems.countsByStatus).toEqual({
      todo: 1,
      "in-progress": 1,
      done: 2,
      blocked: 1,
    });
  });

  it("propagates goals.total = 3 from the goal repository", async () => {
    await tool.execute(context, {
      project_id: projectId,
      decision: "complete",
      reason: "M6 integration: goals total check",
      idempotency_key: "m6-cycle-goals",
    });

    const event = findCycleDecisionEvent();
    expect(event).toBeDefined();
    expect(event?.payload.boardStateSummary?.goals.total).toBe(3);
  });

  it("still emits boardStateSummary populated by the real service on a 'blocked' decision", async () => {
    // "blocked" is always substantive, so the chain runs regardless of
    // mutation detection. This guards the second substantive branch.
    await tool.execute(context, {
      project_id: projectId,
      decision: "blocked",
      reason: "M6 integration: blocked, awaiting human input",
      idempotency_key: "m6-cycle-blocked-2",
    });

    const event = findCycleDecisionEvent();
    expect(event).toBeDefined();
    const summary = event?.payload.boardStateSummary;
    expect(summary?.workItems.total).toBe(5);
    expect(summary?.goals.total).toBe(3);
  });

  it("calls the real BoardStateService through both work-item and goal repositories", async () => {
    // Sanity check that the value in the event payload flows through the
    // real BoardStateService call. The mocks intentionally report the
    // same totals so any drift between the service result and the event
    // payload surfaces in this assertion.
    await tool.execute(context, {
      project_id: projectId,
      decision: "complete",
      reason: "M6 integration: source verification",
      idempotency_key: "m6-cycle-source",
    });

    // The real BoardStateService was reached via the tool's
    // getBoardStateSummary path; both repository mocks were queried.
    expect(mockWorkItems.findByproject_id).toHaveBeenCalled();
    expect(mockGoals.findByproject_id).toHaveBeenCalledWith(projectId, false);

    const event = findCycleDecisionEvent();
    expect(event?.payload.boardStateSummary?.workItems.total).toBe(5);
    expect(event?.payload.boardStateSummary?.goals.total).toBe(3);
  });
});
