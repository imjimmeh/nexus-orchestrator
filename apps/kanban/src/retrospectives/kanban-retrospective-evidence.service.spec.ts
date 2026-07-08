import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanEventDeliveryProjectionRepository } from "../database/repositories/kanban-event-delivery-projection.repository";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { KanbanRetrospectiveEvidenceService } from "./kanban-retrospective-evidence.service";

type MockKanbanEventDeliveryProjectionRepository = {
  listByProject: ReturnType<typeof vi.fn>;
};

type MockKanbanProjectRepository = {
  findById: ReturnType<typeof vi.fn>;
};

type MockKanbanOrchestrationRepository = {
  findByproject_id: ReturnType<typeof vi.fn>;
};

type MockKanbanWorkItemRepository = {
  findByproject_id: ReturnType<typeof vi.fn>;
};

describe("KanbanRetrospectiveEvidenceService", () => {
  let service: KanbanRetrospectiveEvidenceService;
  let eventProjections: MockKanbanEventDeliveryProjectionRepository;
  let projects: MockKanbanProjectRepository;
  let orchestrations: MockKanbanOrchestrationRepository;
  let workItems: MockKanbanWorkItemRepository;

  beforeEach(async () => {
    eventProjections = {
      listByProject: vi.fn(),
    };
    projects = {
      findById: vi.fn(),
    };
    orchestrations = {
      findByproject_id: vi.fn(),
    };
    workItems = {
      findByproject_id: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        KanbanRetrospectiveEvidenceService,
        {
          provide: KanbanEventDeliveryProjectionRepository,
          useValue: eventProjections,
        },
        { provide: KanbanProjectRepository, useValue: projects },
        { provide: KanbanOrchestrationRepository, useValue: orchestrations },
        { provide: KanbanWorkItemRepository, useValue: workItems },
      ],
    }).compile();

    service = module.get(KanbanRetrospectiveEvidenceService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns missing_project when the project does not exist", async () => {
    projects.findById.mockResolvedValue(null);

    const result = await service.collectProjectEvidence("project-missing");

    expect(result).toEqual({
      state: "missing_project",
      projectId: "project-missing",
    });
    expect(orchestrations.findByproject_id).not.toHaveBeenCalled();
    expect(workItems.findByproject_id).not.toHaveBeenCalled();
    expect(eventProjections.listByProject).not.toHaveBeenCalled();
  });

  it("returns missing_orchestration when the project has no orchestration state", async () => {
    projects.findById.mockResolvedValue({
      id: "project-1",
      name: "Project One",
    });
    orchestrations.findByproject_id.mockResolvedValue(null);

    const result = await service.collectProjectEvidence("project-1");

    expect(result).toEqual({
      state: "missing_orchestration",
      projectId: "project-1",
    });
    expect(workItems.findByproject_id).not.toHaveBeenCalled();
    expect(eventProjections.listByProject).not.toHaveBeenCalled();
  });

  it("returns a deterministic delta snapshot for orchestration decisions and work item activity", async () => {
    projects.findById.mockResolvedValue({
      id: "project-1",
      name: "Project One",
    });
    orchestrations.findByproject_id.mockResolvedValue({
      project_id: "project-1",
      goals: "Ship retrospective evidence",
      mode: "autonomous",
      status: "completed",
      linked_run_id: "run-1",
      decision_log: [
        {
          timestamp: "2026-05-16T10:00:00.000Z",
          type: "decision",
          reasoning: "Initial triage",
          actions: ["prioritize"],
        },
        {
          timestamp: "2026-05-16T11:00:00.000Z",
          type: "cycle_decision",
          reasoning: "All ready work completed",
          actions: ["complete"],
          cycleDecision: "complete",
          idempotencyKey: "cycle-key-1",
        },
      ],
      action_requests: [
        {
          id: "request-1",
          status: "pending",
          action: "dispatch_start_work_items",
        },
        {
          id: "request-2",
          status: "executed",
          action: "complete_orchestration",
        },
        { id: "request-3", status: "failed", action: "invoke_agent_workflow" },
      ],
      metadata: {
        cycle_decision: "complete",
        cycle_decision_recorded_at: "2026-05-16T11:00:00.000Z",
      },
      created_at: new Date("2026-05-16T09:00:00.000Z"),
      updated_at: new Date("2026-05-16T11:05:00.000Z"),
    });
    workItems.findByproject_id.mockResolvedValue([
      { id: "item-1", project_id: "project-1", status: "done" },
      { id: "item-2", project_id: "project-1", status: "done" },
      { id: "item-3", project_id: "project-1", status: "blocked" },
      { id: "item-4", project_id: "project-1", status: "todo" },
    ]);
    eventProjections.listByProject.mockResolvedValue([]);

    const result = await service.collectProjectEvidence("project-1");

    expect(result).toMatchObject({
      state: "ready",
      projectId: "project-1",
      deltaSnapshot: {
        project: {
          id: "project-1",
          name: "Project One",
        },
        orchestration: {
          projectId: "project-1",
          mode: "autonomous",
          status: "completed",
          linkedRunId: "run-1",
          updatedAt: "2026-05-16T11:05:00.000Z",
        },
        workItems: {
          total: 4,
          countsByStatus: {
            blocked: 1,
            done: 2,
            todo: 1,
          },
        },
        decisions: {
          total: 2,
          latestCycleDecision: {
            decision: "complete",
            reasoning: "All ready work completed",
            timestamp: "2026-05-16T11:00:00.000Z",
            idempotencyKey: "cycle-key-1",
          },
          markers: {
            hasDecisionLog: true,
            hasCycleDecision: true,
            hasCycleDecisionIdempotencyKey: true,
            hasCycleDecisionRecordedAt: true,
          },
        },
        actionRequests: {
          total: 3,
          countsByStatus: {
            executed: 1,
            failed: 1,
            pending: 1,
          },
          countsByAction: {
            complete_orchestration: 1,
            dispatch_start_work_items: 1,
            invoke_agent_workflow: 1,
          },
        },
      },
      cycleDecisionEvents: [],
    });
  });

  it("returns cycle decision events when present", async () => {
    projects.findById.mockResolvedValue({
      id: "project-2",
      name: "Project Two",
    });
    orchestrations.findByproject_id.mockResolvedValue({
      project_id: "project-2",
      goals: "",
      mode: "autonomous",
      status: "completed",
      linked_run_id: null,
      decision_log: [],
      action_requests: [],
      metadata: null,
      created_at: new Date("2026-05-16T09:00:00.000Z"),
      updated_at: new Date("2026-05-16T09:00:00.000Z"),
    });
    workItems.findByproject_id.mockResolvedValue([]);
    eventProjections.listByProject.mockResolvedValue([
      {
        id: "event-1",
        event_id: "evt-1",
        event_name: "kanban.retrospective_cycle_decision_recorded.v1",
        project_id: "project-2",
        work_item_id: null,
        workflow_run_id: "run-123",
        dedupe_key: null,
        status: "accepted",
        replay_count: 0,
        last_attempted_at: new Date(),
        accepted_at: new Date(),
        last_error: null,
        payload_snapshot: {
          event_name: "kanban.retrospective_cycle_decision_recorded.v1",
          scope_id: "project-2",
          decision_type: "complete",
          reason: "All work items done",
          is_substantive: true,
          board_state_summary: {
            workItems: { total: 0, countsByStatus: {} },
            goals: { total: 0, countsByStatus: {} },
          },
          work_item_counts: {
            total: 5,
            byStatus: { done: 5 },
            activeCount: 0,
            doneCount: 5,
          },
          goal_coverage: {
            total: 0,
            active: 0,
            completed: 0,
            coveragePercentage: 0,
          },
          cycle_decision_recorded_at: "2026-05-16T12:00:00.000Z",
          provenance: {
            project_id: "project-2",
            workflow_run_id: "run-123",
            job_id: null,
            idempotency_key: "idempotent-key-1",
            decision_source: "orchestration_cycle",
          },
        },
        metadata: null,
        created_at: new Date("2026-05-16T12:00:00.000Z"),
        updated_at: new Date(),
      },
    ]);

    const result = await service.collectProjectEvidence("project-2");

    expect(result).toMatchObject({
      state: "ready",
      projectId: "project-2",
      cycleDecisionEvents: [
        expect.objectContaining({
          decisionType: "complete",
          reason: "All work items done",
          isSubstantive: true,
          idempotencyKey: "idempotent-key-1",
        }),
      ],
    });
  });

  it("returns insufficient_evidence when no work items, decisions, or action requests exist", async () => {
    projects.findById.mockResolvedValue({
      id: "project-1",
      name: "Project One",
    });
    orchestrations.findByproject_id.mockResolvedValue({
      project_id: "project-1",
      goals: "",
      mode: "supervised",
      status: "orchestrating",
      linked_run_id: null,
      decision_log: [],
      action_requests: [],
      metadata: null,
      created_at: new Date("2026-05-16T09:00:00.000Z"),
      updated_at: new Date("2026-05-16T09:00:00.000Z"),
    });
    workItems.findByproject_id.mockResolvedValue([]);
    eventProjections.listByProject.mockResolvedValue([]);

    const result = await service.collectProjectEvidence("project-1");

    expect(result).toEqual({
      state: "insufficient_evidence",
      projectId: "project-1",
      diagnostics: {
        actionRequestCount: 0,
        decisionCount: 0,
        workItemCount: 0,
        cycleDecisionEventCount: 0,
      },
    });
  });
});
