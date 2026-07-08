import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { KanbanOrchestrationFactEntity } from "../../database/entities/kanban-orchestration-fact.entity";
import { KanbanOrchestrationIntentEntity } from "../../database/entities/kanban-orchestration-intent.entity";
import { KanbanOrchestrationLaunchAttemptEntity } from "../../database/entities/kanban-orchestration-launch-attempt.entity";
import { KanbanOrchestrationSchedulerOutcomeEntity } from "../../database/entities/kanban-orchestration-scheduler-outcome.entity";
import { KanbanOrchestrationFactRepository } from "../../database/repositories/kanban-orchestration-fact.repository";
import { KanbanOrchestrationIntentRepository } from "../../database/repositories/kanban-orchestration-intent.repository";
import { KanbanOrchestrationLaunchAttemptRepository } from "../../database/repositories/kanban-orchestration-launch-attempt.repository";
import { KanbanOrchestrationSchedulerOutcomeRepository } from "../../database/repositories/kanban-orchestration-scheduler-outcome.repository";
import { ControlPlaneBoardService } from "./control-plane-board.service";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("ControlPlaneBoardService", () => {
  let intentRepository: {
    listByProject: Mock;
  };
  let factRepository: {
    listByProject: Mock;
  };
  let outcomeRepository: {
    listByIntent: Mock;
  };
  let launchAttemptRepository: {
    listByIntent: Mock;
  };
  let service: ControlPlaneBoardService;

  beforeEach(() => {
    intentRepository = { listByProject: vi.fn() };
    factRepository = { listByProject: vi.fn() };
    outcomeRepository = { listByIntent: vi.fn() };
    launchAttemptRepository = { listByIntent: vi.fn() };
    service = new ControlPlaneBoardService(
      intentRepository as unknown as KanbanOrchestrationIntentRepository,
      factRepository as unknown as KanbanOrchestrationFactRepository,
      outcomeRepository as unknown as KanbanOrchestrationSchedulerOutcomeRepository,
      launchAttemptRepository as unknown as KanbanOrchestrationLaunchAttemptRepository,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates lanes, latest outcomes, no-launch reasons, facts, stale links, and launch attempts", async () => {
    const dispatchIntent = buildIntent({
      id: "intent-dispatch",
      lane: "dispatch",
      type: "dispatch_candidates",
      status: "blocked",
      priority: 10,
      reason: "dispatch is blocked",
      conflict_keys: [{ kind: "workflow_scope", value: "dispatch:project" }],
    });
    const repairIntent = buildIntent({
      id: "intent-repair",
      lane: "repair",
      type: "repair_failed_run",
      status: "pending",
      priority: 3,
      reason: "repair failed event",
    });
    intentRepository.listByProject.mockResolvedValue([
      dispatchIntent,
      repairIntent,
    ]);
    factRepository.listByProject.mockResolvedValue([
      buildFact({ id: "fact-stale", fact_type: "stale_link_detected" }),
      buildFact({ id: "fact-fresh", fact_type: "event_delivery_failed" }),
    ]);
    outcomeRepository.listByIntent.mockImplementation((intentId: string) => {
      if (intentId === "intent-dispatch") {
        return Promise.resolve([
          buildOutcome({
            id: "outcome-older",
            intent_id: intentId,
            status: "launchable",
            reason: "no_conflicts",
            evaluated_at: new Date("2026-05-18T19:00:00.000Z"),
            created_at: new Date("2026-05-18T19:00:00.000Z"),
          }),
          buildOutcome({
            id: "outcome-latest",
            intent_id: intentId,
            status: "blocked",
            reason: "conflict_key_active",
            active_conflicts: [
              { kind: "workflow_scope", value: "dispatch:project" },
            ],
            evaluated_at: new Date("2026-05-18T20:00:00.000Z"),
            created_at: new Date("2026-05-18T20:00:00.000Z"),
          }),
        ]);
      }
      return Promise.resolve([]);
    });
    launchAttemptRepository.listByIntent.mockImplementation(
      (intentId: string) => {
        if (intentId === "intent-dispatch") {
          return Promise.resolve([
            buildLaunchAttempt({
              id: "attempt-1",
              intent_id: intentId,
              workflow_id: "dispatch_candidates",
              workflow_run_id: "run-1",
              status: "failed",
              failure_reason: "container unavailable",
            }),
          ]);
        }
        return Promise.resolve([]);
      },
    );

    const board = await service.getProjectBoard(PROJECT_ID);

    expect(intentRepository.listByProject).toHaveBeenCalledWith(PROJECT_ID);
    expect(factRepository.listByProject).toHaveBeenCalledWith(PROJECT_ID);
    expect(board.projectId).toBe(PROJECT_ID);
    expect(board.lanes).toEqual([
      {
        lane: "dispatch",
        activeCount: 0,
        pendingCount: 0,
        blockedCount: 1,
        intents: [
          expect.objectContaining({
            id: "intent-dispatch",
            latestOutcome: expect.objectContaining({
              id: "outcome-latest",
              status: "blocked",
              reason: "conflict_key_active",
              evaluatedAt: "2026-05-18T20:00:00.000Z",
            }),
            launchAttempts: [
              expect.objectContaining({
                id: "attempt-1",
                workflowId: "dispatch_candidates",
                workflowRunId: "run-1",
                status: "failed",
                failureReason: "container unavailable",
              }),
            ],
          }),
        ],
      },
      {
        lane: "repair",
        activeCount: 1,
        pendingCount: 1,
        blockedCount: 0,
        intents: [expect.objectContaining({ id: "intent-repair" })],
      },
    ]);
    expect(board.facts).toEqual([
      expect.objectContaining({
        id: "fact-stale",
        type: "stale_link_detected",
      }),
      expect.objectContaining({
        id: "fact-fresh",
        type: "event_delivery_failed",
      }),
    ]);
    expect(board.noLaunchReasons).toEqual([
      expect.objectContaining({ id: "outcome-latest", status: "blocked" }),
    ]);
    expect(board.staleLinks).toEqual([
      expect.objectContaining({
        id: "fact-stale",
        type: "stale_link_detected",
      }),
    ]);
  });

  it("defensively maps nullable JSONB arrays and string dates from persistence", async () => {
    intentRepository.listByProject.mockResolvedValue([
      buildIntent({
        conflict_keys: null,
        created_at: "2026-05-18T20:00:00.000Z",
        updated_at: "2026-05-18T20:01:00.000Z",
      } as unknown as Partial<KanbanOrchestrationIntentEntity>),
    ]);
    factRepository.listByProject.mockResolvedValue([
      buildFact({
        observed_at: "2026-05-18T20:02:00.000Z",
        expires_at: null,
      } as unknown as Partial<KanbanOrchestrationFactEntity>),
    ]);
    outcomeRepository.listByIntent.mockResolvedValue([
      buildOutcome({
        active_conflicts: null,
        evaluated_at: "2026-05-18T20:03:00.000Z",
      } as unknown as Partial<KanbanOrchestrationSchedulerOutcomeEntity>),
    ]);
    launchAttemptRepository.listByIntent.mockResolvedValue([]);

    const board = await service.getProjectBoard(PROJECT_ID);

    expect(board.lanes[0]?.intents[0]).toMatchObject({
      conflictKeys: [],
      createdAt: "2026-05-18T20:00:00.000Z",
      updatedAt: "2026-05-18T20:01:00.000Z",
      latestOutcome: {
        id: "outcome-1",
        status: "launchable",
        reason: "no_conflicts",
        activeConflicts: [],
        evaluatedAt: "2026-05-18T20:03:00.000Z",
      },
    });
    expect(board.facts[0]).toMatchObject({
      observedAt: "2026-05-18T20:02:00.000Z",
      expiresAt: null,
    });
  });
});

function buildIntent(
  overrides: Partial<KanbanOrchestrationIntentEntity> = {},
): KanbanOrchestrationIntentEntity {
  return {
    id: "intent-1",
    project_id: PROJECT_ID,
    lane: "dispatch",
    type: "dispatch_candidates",
    status: "pending",
    requester: "test",
    reason: "test reason",
    priority: 0,
    evidence: [],
    resource_refs: [],
    conflict_keys: [],
    workflow_id: "workflow-dispatch",
    workflow_scope: "scope-1",
    idempotency_key: "intent-key",
    supersedes_intent_id: null,
    freshness_requirements: {},
    terminal_outcome: null,
    metadata: null,
    created_at: nowDate(),
    updated_at: nowDate(),
    ...overrides,
  };
}

function buildFact(
  overrides: Partial<KanbanOrchestrationFactEntity> = {},
): KanbanOrchestrationFactEntity {
  return {
    id: "fact-1",
    project_id: PROJECT_ID,
    fact_type: "project_spec_current",
    subject_kind: "project",
    subject_id: PROJECT_ID,
    source_type: "test",
    source_id: "test-source",
    confidence: 1,
    freshness_status: "fresh",
    observed_at: nowDate(),
    expires_at: null,
    invalidated_at: null,
    invalidated_by_event_id: null,
    payload_json: {},
    evidence: [],
    metadata: null,
    created_at: nowDate(),
    updated_at: nowDate(),
    ...overrides,
  };
}

function buildOutcome(
  overrides: Partial<KanbanOrchestrationSchedulerOutcomeEntity> = {},
): KanbanOrchestrationSchedulerOutcomeEntity {
  return {
    id: "outcome-1",
    intent_id: "intent-1",
    project_id: PROJECT_ID,
    status: "launchable",
    reason: "no_conflicts",
    conflict_keys: [],
    active_conflicts: [],
    evaluated_at: nowDate(),
    policy_snapshot: {},
    metadata: null,
    created_at: nowDate(),
    ...overrides,
  };
}

function buildLaunchAttempt(
  overrides: Partial<KanbanOrchestrationLaunchAttemptEntity> = {},
): KanbanOrchestrationLaunchAttemptEntity {
  return {
    id: "attempt-1",
    intent_id: "intent-1",
    outcome_id: "outcome-1",
    project_id: PROJECT_ID,
    workflow_id: "workflow-dispatch",
    workflow_scope: "scope-1",
    workflow_run_id: null,
    idempotency_key: "attempt-key",
    status: "accepted",
    failure_reason: null,
    requested_at: nowDate(),
    completed_at: null,
    response_payload: null,
    metadata: null,
    created_at: nowDate(),
    updated_at: nowDate(),
    ...overrides,
  };
}

function nowDate(): Date {
  return new Date("2026-05-18T20:00:00.000Z");
}
