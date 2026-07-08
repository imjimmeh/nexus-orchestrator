import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import type { KanbanOrchestrationEntity } from "../database/entities/kanban-orchestration.entity";
import type { KanbanRetrospectiveRunEntity } from "../database/entities/kanban-retrospective-run.entity";
import type { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import type { KanbanRetrospectiveRunRepository } from "../database/repositories/kanban-retrospective-run.repository";
import type { CycleDecisionEventHandler } from "./events/cycle-decision-event.handler";
import { KanbanRetrospectiveEvidenceService } from "./kanban-retrospective-evidence.service";
import {
  FAILURE_TIMESTAMPS_METADATA_KEY,
  LAST_EMITTED_AT_METADATA_KEY,
  LAST_EMITTED_WINDOW_METADATA_KEY,
} from "./kanban-retrospective-failure-threshold.helpers";
import { KanbanRetrospectiveFailureThresholdService } from "./kanban-retrospective-failure-threshold.service";
import { KanbanRetrospectiveService } from "./kanban-retrospective.service";
import type {
  KanbanRetrospectiveDeltaSnapshot,
} from "./retrospective.types";

// The default beforeEach system time is `2026-06-13T12:00:00.000Z`
// (= epoch seconds 1781352000). With the default sliding window of
// 600s, the deterministic window-start epoch seconds is
// Math.floor((1781352000 - 600) / 60) * 60 = 1781351400.
const INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS = 1781352000;
const INTEGRATION_WINDOW_START_EPOCH_SECONDS = 1781351400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneOrchestration(
  state: KanbanOrchestrationEntity,
): KanbanOrchestrationEntity {
  return {
    project_id: state.project_id,
    goals: state.goals,
    mode: state.mode,
    status: state.status,
    linked_run_id: state.linked_run_id,
    decision_log:
      state.decision_log === null ? null : [...state.decision_log],
    action_requests:
      state.action_requests === null ? null : [...state.action_requests],
    metadata: state.metadata === null ? null : { ...state.metadata },
    created_at: state.created_at,
    updated_at: state.updated_at,
  };
}

function makeOrchestrationEntity(
  overrides: Partial<KanbanOrchestrationEntity> = {},
): KanbanOrchestrationEntity {
  return {
    project_id: "project-1",
    goals: "ship it",
    mode: "autonomous",
    status: "orchestrating",
    linked_run_id: "run-1",
    decision_log: null,
    action_requests: null,
    metadata: {},
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRetrospectiveRunEntity(
  overrides: Partial<KanbanRetrospectiveRunEntity> = {},
): KanbanRetrospectiveRunEntity {
  return {
    id: "retro-run-1",
    idempotency_key: "kanban-retrospective:completion_event:project-1:rev-1",
    project_id: "project-1",
    orchestration_id: "orchestration-1",
    trigger_type: "completion_event",
    trigger_revision_marker: "rev-1",
    replay_of_run_id: null,
    status: "running",
    skip_reason: null,
    failure_reason: null,
    candidate_count: 0,
    learning_candidate_ids: [],
    delta_snapshot_json: null,
    diagnostics_json: null,
    started_at: new Date("2026-06-01T12:00:00.000Z"),
    completed_at: null,
    created_at: new Date("2026-06-01T12:00:00.000Z"),
    updated_at: new Date("2026-06-01T12:00:00.000Z"),
    ...overrides,
  };
}

function makeDeltaSnapshot(
  overrides: Partial<KanbanRetrospectiveDeltaSnapshot> = {},
): KanbanRetrospectiveDeltaSnapshot {
  return {
    project: { id: "project-1", name: "Project One" },
    orchestration: {
      projectId: "project-1",
      mode: "autonomous",
      status: "orchestrating",
      linkedRunId: null,
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    workItems: {
      total: 3,
      countsByStatus: { todo: 1, in_progress: 1, done: 1 },
    },
    decisions: {
      total: 1,
      latestCycleDecision: {
        decision: "complete",
        reasoning: "done",
        timestamp: "2026-06-01T00:00:00.000Z",
        idempotencyKey: "cycle-1",
      },
      markers: {
        hasDecisionLog: true,
        hasCycleDecision: true,
        hasCycleDecisionIdempotencyKey: true,
        hasCycleDecisionRecordedAt: true,
      },
    },
    actionRequests: {
      total: 1,
      countsByStatus: { executed: 1 },
      countsByAction: { complete_orchestration: 1 },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("KanbanRetrospectiveService failure_threshold integration", () => {
  let service: KanbanRetrospectiveService;
  let failureThresholdService: KanbanRetrospectiveFailureThresholdService;

  // Orchestration state (in-memory, manipulated by both recordWorkflowFailure
  // and the orchestration repository mock).
  let orchestrationState: KanbanOrchestrationEntity;

  // Retrospective run storage (in-memory, populated by the run repository mock).
  let runStore: Map<string, KanbanRetrospectiveRunEntity>;

  // Spies / mocks (typed as plain object literals with `Mock` methods so that
  // the @typescript-eslint/unbound-method rule does not flag the dot access
  // used to assert call counts. The cast to the concrete service / repository
  // type is performed at the constructor call site below.)
  let runsRepo: {
    createRun: ReturnType<typeof vi.fn>;
    findByIdempotencyKey: ReturnType<typeof vi.fn>;
    findLatestByProject: ReturnType<typeof vi.fn>;
    findLatestCompletedByProject: ReturnType<typeof vi.fn>;
    markCompleted: ReturnType<typeof vi.fn>;
    markSkipped: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let orchestrationsRepo: {
    findByproject_id: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findByLinkedRunId: ReturnType<typeof vi.fn>;
    clearLinkedRunIfMatches: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findByStatus: ReturnType<typeof vi.fn>;
    deleteByproject_id: ReturnType<typeof vi.fn>;
  };
  let evidenceSvc: {
    collectProjectEvidence: ReturnType<typeof vi.fn>;
  };
  let coreClient: {
    emitDomainEvent: ReturnType<typeof vi.fn>;
    emitDomainEventOrThrow: ReturnType<typeof vi.fn>;
  };
  let cycleDecisionHandler: {
    register: ReturnType<typeof vi.fn>;
    getDecisionsForProject: ReturnType<typeof vi.fn>;
  };

  const DEFAULT_THRESHOLD = 3;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));

    // ------------------------------------------------------------------
    // Orchestration repository – backed by a plain state object so that
    // consecutive writes survive across calls.
    // ------------------------------------------------------------------
    orchestrationState = makeOrchestrationEntity();

    orchestrationsRepo = {
      findByproject_id: vi.fn((projectId: string) => {
        if (orchestrationState.project_id === projectId) {
          // Return a shallow copy so callers see current state.
          return cloneOrchestration(orchestrationState);
        }
        return null;
      }),
      save: vi.fn((input: Partial<KanbanOrchestrationEntity>) => {
        const updated = cloneOrchestration(orchestrationState);
        Object.assign(updated, input);
        orchestrationState = updated;
        return orchestrationState;
      }),
      // Unused stubs
      findByLinkedRunId: vi.fn().mockResolvedValue(null),
      clearLinkedRunIfMatches: vi.fn().mockResolvedValue(true),
      findAll: vi.fn().mockResolvedValue([]),
      findByStatus: vi.fn().mockResolvedValue([]),
      deleteByproject_id: vi.fn().mockResolvedValue(undefined),
    };

    // ------------------------------------------------------------------
    // Retrospective run repository – backed by an in-memory Map.
    // ------------------------------------------------------------------
    runStore = new Map<string, KanbanRetrospectiveRunEntity>();

    runsRepo = {
      createRun: vi.fn((input: any) => {
        const entity = makeRetrospectiveRunEntity({
          id: `run-${runStore.size + 1}`,
          idempotency_key: input.idempotency_key,
          project_id: input.project_id,
          orchestration_id: input.orchestration_id,
          trigger_type: input.trigger_type,
          trigger_revision_marker: input.trigger_revision_marker,
          replay_of_run_id: input.replay_of_run_id ?? null,
          status: "running",
          diagnostics_json: input.diagnostics_json ?? null,
          started_at: input.started_at ?? new Date(),
        });
        runStore.set(entity.id, entity);
        return entity;
      }),
      findByIdempotencyKey: vi.fn((key: string) => {
        for (const run of runStore.values()) {
          if (run.idempotency_key === key) return run;
        }
        return null;
      }),
      findLatestByProject: vi.fn((projectId: string) => {
        const runs = [...runStore.values()]
          .filter((r) => r.project_id === projectId)
          .sort(
            (a, b) =>
              b.created_at.getTime() - a.created_at.getTime(),
          );
        return runs[0] ?? null;
      }),
      findLatestCompletedByProject: vi.fn((projectId: string) => {
        const runs = [...runStore.values()]
          .filter((r) => r.project_id === projectId && r.status === "completed")
          .sort(
            (a, b) =>
              (b.completed_at?.getTime() ?? 0) -
              (a.completed_at?.getTime() ?? 0),
          );
        return runs[0] ?? null;
      }),
      markCompleted: vi.fn((id: string, input: any) => {
        const run = runStore.get(id);
        if (run) {
          run.status = "completed";
          run.candidate_count = input.candidate_count;
          run.learning_candidate_ids = input.learning_candidate_ids ?? [];
          run.delta_snapshot_json = input.delta_snapshot_json ?? null;
          run.diagnostics_json = input.diagnostics_json ?? null;
          run.completed_at = input.completed_at ?? new Date();
        }
      }),
      markSkipped: vi.fn((id: string, input: any) => {
        const run = runStore.get(id);
        if (run) {
          run.status = "skipped";
          run.skip_reason = input.skip_reason;
          run.diagnostics_json = input.diagnostics_json ?? null;
          run.completed_at = input.completed_at ?? new Date();
        }
      }),
      markFailed: vi.fn((id: string, input: any) => {
        const run = runStore.get(id);
        if (run) {
          run.status = "failed";
          run.failure_reason = input.failure_reason;
          run.diagnostics_json = input.diagnostics_json ?? null;
          run.completed_at = input.completed_at ?? new Date();
        }
      }),
      list: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
    };

    // ------------------------------------------------------------------
    // Evidence service – always returns a "ready" delta so we don't hit
    // insufficient-evidence / missing-project short-circuits.
    // ------------------------------------------------------------------
    evidenceSvc = {
      collectProjectEvidence: vi.fn((_projectId: string) => ({
        state: "ready" as const,
        projectId: _projectId,
        deltaSnapshot: makeDeltaSnapshot(),
        cycleDecisionEvents: [],
      })),
    };

    // ------------------------------------------------------------------
    // Core client – only emitDomainEventOrThrow is used by executeRun.
    // ------------------------------------------------------------------
    coreClient = {
      emitDomainEvent: vi.fn().mockResolvedValue(undefined),
      emitDomainEventOrThrow: vi.fn().mockResolvedValue(undefined),
    };

    // ------------------------------------------------------------------
    // Cycle decision handler – no decisions for these scenarios.
    // ------------------------------------------------------------------
    cycleDecisionHandler = {
      register: vi.fn(),
      getDecisionsForProject: vi.fn().mockReturnValue([]),
    };

    // ------------------------------------------------------------------
    // Construct the real KanbanRetrospectiveService with mocked deps.
    // ------------------------------------------------------------------
    service = new KanbanRetrospectiveService(
      runsRepo as unknown as KanbanRetrospectiveRunRepository,
      orchestrationsRepo as unknown as KanbanOrchestrationRepository,
      evidenceSvc as unknown as KanbanRetrospectiveEvidenceService,
      coreClient as unknown as CoreWorkflowClientService,
      cycleDecisionHandler as unknown as CycleDecisionEventHandler,
    );
    // The failure-threshold service sits on top of the retrospective
    // service; it owns the consecutive-failure counter and delegates the
    // actual run execution to the retrospective service.
    failureThresholdService = new KanbanRetrospectiveFailureThresholdService(
      orchestrationsRepo as unknown as KanbanOrchestrationRepository,
      service,
    );
  });

  // -------------------------------------------------------------------
  // Scenario 1: below threshold → no retrospective
  // -------------------------------------------------------------------

  it("does NOT create a run when the incremented count is below the default threshold", async () => {
    // Start with metadata at 0; one call brings it to 1 (below default 3).
    await failureThresholdService.checkFailureThreshold("project-1");

    // Assert: no run was created, and the counter is persisted
    expect(vi.mocked(runsRepo.createRun)).not.toHaveBeenCalled();
    expect(runStore.size).toBe(0);
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 1,
      [FAILURE_TIMESTAMPS_METADATA_KEY]: [INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS],
    });
  });

  // -------------------------------------------------------------------
  // Scenario 2: at threshold → run created with correct trigger_type
  // -------------------------------------------------------------------

  it("creates a run with trigger_type='failure_threshold' when at the threshold", async () => {
    // Seed two prior in-window timestamps so the post-prune count
    // reaches 3 (the default threshold) after the new call.
    orchestrationState = makeOrchestrationEntity({
      metadata: {
        consecutive_failure_count: DEFAULT_THRESHOLD - 1,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 20,
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      },
    });

    await failureThresholdService.checkFailureThreshold("project-1");

    // A run should exist
    expect(runStore.size).toBe(1);
    const createdRun = [...runStore.values()][0];
    expect(createdRun.trigger_type).toBe("failure_threshold");
    expect(createdRun.project_id).toBe("project-1");
    expect(createdRun.orchestration_id).toBeNull();
  });

  it("completes the retrospective run when evidence is available", async () => {
    orchestrationState = makeOrchestrationEntity({
      metadata: {
        consecutive_failure_count: DEFAULT_THRESHOLD - 1,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 20,
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      },
    });

    await failureThresholdService.checkFailureThreshold("project-1");

    // Evidence service should have been called
    expect(vi.mocked(evidenceSvc.collectProjectEvidence)).toHaveBeenCalledWith(
      "project-1",
    );

    // Core event should have been emitted
    expect(vi.mocked(coreClient.emitDomainEventOrThrow)).toHaveBeenCalledTimes(1);
    const emitted = vi.mocked(coreClient.emitDomainEventOrThrow).mock
      .calls[0][0];
    expect(emitted.payload.provenance).toMatchObject({
      project_id: "project-1",
      orchestration_id: null,
      trigger: { type: "failure_threshold" },
    });

    // Run should be marked completed
    const createdRun = [...runStore.values()][0];
    expect(createdRun.status).toBe("completed");
    expect(createdRun.candidate_count).toBe(1);
  });

  // -------------------------------------------------------------------
  // Scenario 3: idempotency key format
  // -------------------------------------------------------------------

  it("uses the deterministic idempotency key 'failure-threshold:<projectId>:<windowStartEpoch>'", async () => {
    orchestrationState = makeOrchestrationEntity({
      project_id: "project-abc",
      metadata: {
        consecutive_failure_count: 6,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 50,
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 40,
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 30,
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 20,
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      },
    });

    await failureThresholdService.checkFailureThreshold("project-abc");

    const createdRun = [...runStore.values()][0];
    expect(createdRun.idempotency_key).toBe(
      `failure-threshold:project-abc:${INTEGRATION_WINDOW_START_EPOCH_SECONDS}`,
    );
  });

  // -------------------------------------------------------------------
  // Scenario 4: above threshold still fires
  // -------------------------------------------------------------------

  it("fires when the in-window count exceeds the threshold", async () => {
    // Seed 4 timestamps within the window so the post-prune count
    // reaches 5 after the new call (above the default threshold of 3).
    orchestrationState = makeOrchestrationEntity({
      metadata: {
        consecutive_failure_count: 4,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 40,
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 30,
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 20,
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      },
    });

    await failureThresholdService.checkFailureThreshold("project-1");

    expect(runStore.size).toBe(1);
    const createdRun = [...runStore.values()][0];
    expect(createdRun.trigger_type).toBe("failure_threshold");
    expect(createdRun.idempotency_key).toBe(
      `failure-threshold:project-1:${INTEGRATION_WINDOW_START_EPOCH_SECONDS}`,
    );
    expect(createdRun.status).toBe("completed");
  });

  // -------------------------------------------------------------------
  // Scenario 5: duplicate idempotency key (re-testing after first fire)
  // is skipped
  // -------------------------------------------------------------------

  it("skips a duplicate idempotency key and returns the existing run ID", async () => {
    // Seed an existing completed retrospective run with the same
    // deterministic idempotency key the next call would generate. The
    // findByIdempotencyKey repo method short-circuits and returns the
    // existing run, so no second run is created.
    const deterministicIdempotencyKey = `failure-threshold:project-1:${INTEGRATION_WINDOW_START_EPOCH_SECONDS}`;
    const existingRun = makeRetrospectiveRunEntity({
      id: "existing-run",
      idempotency_key: deterministicIdempotencyKey,
      trigger_type: "failure_threshold",
      status: "completed",
    });
    runStore.set(existingRun.id, existingRun);
    // Seed two prior in-window timestamps so the post-prune count
    // reaches 3 (= default threshold) after the new call.
    orchestrationState = makeOrchestrationEntity({
      metadata: {
        consecutive_failure_count: DEFAULT_THRESHOLD - 1,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 20,
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      },
    });

    // Capture the state before re-call
    const createRunCallsBefore = vi.mocked(runsRepo.createRun).mock.calls.length;

    // The service reads the prior timestamps, appends the new failure
    // for an in-window count of 3, hits the threshold, and attempts to
    // create a new run with the deterministic idempotency key. The
    // repo's findByIdempotencyKey returns the existing run, so no new
    // run is created.
    await failureThresholdService.checkFailureThreshold("project-1");

    // No new createRun call
    expect(vi.mocked(runsRepo.createRun).mock.calls.length).toBe(
      createRunCallsBefore,
    );
    // Still only one run in the store
    expect(runStore.size).toBe(1);
    // The idempotency key lookup returned the existing run
    expect(vi.mocked(runsRepo.findByIdempotencyKey)).toHaveBeenCalledWith(
      deterministicIdempotencyKey,
    );
  });

  // -------------------------------------------------------------------
  // Full end-to-end: workflow failures increment → threshold triggers
  // -------------------------------------------------------------------

  it("end-to-end: increments consecutive_failure_count across multiple workflow failures and triggers at the third", async () => {
    // Setup: project starts with 0 consecutive failures
    orchestrationState = makeOrchestrationEntity({
      metadata: {},
    });

    // ── Failure 1 ────────────────────────────────────────────────────
    await failureThresholdService.checkFailureThreshold("project-1");
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 1,
      [FAILURE_TIMESTAMPS_METADATA_KEY]: [INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS],
    });
    expect(runStore.size).toBe(0);

    // ── Failure 2 ────────────────────────────────────────────────────
    await failureThresholdService.checkFailureThreshold("project-1");
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 2,
      [FAILURE_TIMESTAMPS_METADATA_KEY]: [
        INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS,
        INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS,
      ],
    });
    expect(runStore.size).toBe(0);

    // ── Failure 3 ────────────────────────────────────────────────────
    await failureThresholdService.checkFailureThreshold("project-1");
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 3,
      [FAILURE_TIMESTAMPS_METADATA_KEY]: [
        INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS,
        INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS,
        INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS,
      ],
      [LAST_EMITTED_WINDOW_METADATA_KEY]: `project-1:${INTEGRATION_WINDOW_START_EPOCH_SECONDS}`,
      [LAST_EMITTED_AT_METADATA_KEY]: INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS,
    });

    // Verify the retrospective run was created
    expect(runStore.size).toBe(1);
    const run = [...runStore.values()][0];
    expect(run.trigger_type).toBe("failure_threshold");
    expect(run.project_id).toBe("project-1");
    expect(run.orchestration_id).toBeNull();
    expect(run.idempotency_key).toBe(
      `failure-threshold:project-1:${INTEGRATION_WINDOW_START_EPOCH_SECONDS}`,
    );
    expect(run.status).toBe("completed");
    expect(run.candidate_count).toBe(1);

    // Verify core event was emitted with the right trigger type in
    // provenance
    expect(vi.mocked(coreClient.emitDomainEventOrThrow)).toHaveBeenCalledTimes(1);
    const emitted = vi.mocked(coreClient.emitDomainEventOrThrow).mock
      .calls[0][0];
    expect(emitted.payload.provenance).toMatchObject({
      project_id: "project-1",
      orchestration_id: null,
      trigger: { type: "failure_threshold" },
    });

    // Additional assertion: verify the deterministic
    // "failure-threshold:<projectId>:<windowStartEpoch>" idempotency
    // key shape per WI-2026-063 OPEN_QUESTIONS K5.
    expect(run.idempotency_key).toMatch(
      /^failure-threshold:project-1:\d+$/,
    );
  });

  // -------------------------------------------------------------------
  // null metadata starts at 1
  // -------------------------------------------------------------------

  it("initialises count to 1 when metadata is null", async () => {
    orchestrationState = makeOrchestrationEntity({
      metadata: null,
    });

    await failureThresholdService.checkFailureThreshold("project-1");
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 1,
      [FAILURE_TIMESTAMPS_METADATA_KEY]: [INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS],
    });
  });

  // -------------------------------------------------------------------
  // returns early when no orchestration exists
  // -------------------------------------------------------------------

  it("is a no-op when no orchestration exists for the project", async () => {
    (orchestrationsRepo.findByproject_id as any).mockResolvedValueOnce(null);

    await failureThresholdService.checkFailureThreshold("project-nonexistent");
    expect(vi.mocked(runsRepo.createRun)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // Custom FAILURE_THRESHOLD_COUNT env override
  // -------------------------------------------------------------------

  it("respects FAILURE_THRESHOLD_COUNT env var for the threshold check", async () => {
    process.env.FAILURE_THRESHOLD_COUNT = "5";
    try {
      // Re-construct the failure-threshold service so resolveSettings()
      // picks up the freshly-set env var on the first call.
      failureThresholdService = new KanbanRetrospectiveFailureThresholdService(
        orchestrationsRepo as unknown as KanbanOrchestrationRepository,
        service,
      );
      orchestrationState = makeOrchestrationEntity({ metadata: {} });

      // Failures 1-4: below custom threshold
      for (let i = 1; i <= 4; i++) {
        await failureThresholdService.checkFailureThreshold("project-1");
        expect(orchestrationState.metadata).toEqual({
          consecutive_failure_count: i,
          [FAILURE_TIMESTAMPS_METADATA_KEY]: Array(i).fill(
            INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS,
          ),
        });
        expect(runStore.size).toBe(0);
      }

      // Failure 5: at custom threshold, should fire
      await failureThresholdService.checkFailureThreshold("project-1");
      expect(orchestrationState.metadata).toEqual({
        consecutive_failure_count: 5,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: Array(5).fill(
          INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS,
        ),
        [LAST_EMITTED_WINDOW_METADATA_KEY]: `project-1:${INTEGRATION_WINDOW_START_EPOCH_SECONDS}`,
        [LAST_EMITTED_AT_METADATA_KEY]: INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS,
      });
      expect(runStore.size).toBe(1);

      const run = [...runStore.values()][0];
      expect(run.trigger_type).toBe("failure_threshold");
      expect(run.idempotency_key).toBe(
        `failure-threshold:project-1:${INTEGRATION_WINDOW_START_EPOCH_SECONDS}`,
      );
    } finally {
      delete process.env.FAILURE_THRESHOLD_COUNT;
    }
  });

  // -------------------------------------------------------------------
  // preserves other metadata keys
  // -------------------------------------------------------------------

  it("does not erase other metadata keys when incrementing the counter", async () => {
    orchestrationState = makeOrchestrationEntity({
      metadata: {
        consecutive_failure_count: 1,
        last_dead_letter_id: "dl-abc",
        custom_field: 42,
      },
    });

    await failureThresholdService.checkFailureThreshold("project-1");
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 2,
      last_dead_letter_id: "dl-abc",
      custom_field: 42,
      [FAILURE_TIMESTAMPS_METADATA_KEY]: [INTEGRATION_SYSTEM_TIME_EPOCH_SECONDS],
    });
  });

  // -------------------------------------------------------------------
  // resetConsecutiveFailureCount
  // -------------------------------------------------------------------

  it("resetConsecutiveFailureCount returns the counter to 0", async () => {
    orchestrationState = makeOrchestrationEntity({
      metadata: {
        consecutive_failure_count: 4,
        custom_field: 42,
      },
    });

    await failureThresholdService.resetConsecutiveFailureCount("project-1");
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 0,
      custom_field: 42,
    });
  });

  it("resetConsecutiveFailureCount is a no-op when the counter is already 0", async () => {
    orchestrationState = makeOrchestrationEntity({
      metadata: { consecutive_failure_count: 0 },
    });

    await failureThresholdService.resetConsecutiveFailureCount("project-1");
    // Persisted metadata must remain unchanged.
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 0,
    });
  });

  it("resetConsecutiveFailureCount is a no-op when no orchestration exists", async () => {
    const initialMetadata = orchestrationState.metadata;
    (orchestrationsRepo.findByproject_id as any).mockResolvedValueOnce(null);

    await failureThresholdService.resetConsecutiveFailureCount("project-nonexistent");
    // No orchestration means the repo save must not be called and
    // orchestrationState is unchanged.
    expect(orchestrationState.metadata).toBe(initialMetadata);
  });
});
