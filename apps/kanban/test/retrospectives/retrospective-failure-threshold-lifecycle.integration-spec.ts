import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreWorkflowClientService } from "../../src/core/core-workflow-client.service";
import type { KanbanOrchestrationEntity } from "../../src/database/entities/kanban-orchestration.entity";
import type { KanbanRetrospectiveRunEntity } from "../../src/database/entities/kanban-retrospective-run.entity";
import type { KanbanOrchestrationRepository } from "../../src/database/repositories/kanban-orchestration.repository";
import type { KanbanRetrospectiveRunRepository } from "../../src/database/repositories/kanban-retrospective-run.repository";
import {
  FAILURE_TIMESTAMPS_METADATA_KEY,
  LAST_EMITTED_AT_METADATA_KEY,
  LAST_EMITTED_WINDOW_METADATA_KEY,
} from "../../src/retrospectives/kanban-retrospective-failure-threshold.helpers";
import { KanbanRetrospectiveFailureThresholdService } from "../../src/retrospectives/kanban-retrospective-failure-threshold.service";
import { KanbanRetrospectiveService } from "../../src/retrospectives/kanban-retrospective.service";
import type {
  KanbanRetrospectiveDeltaSnapshot,
} from "../../src/retrospectives/retrospective.types";
import type { ISystemSettingsReader } from "../../src/retrospectives/kanban-retrospective-failure-threshold.types";
import type { CycleDecisionEventHandler } from "../../src/retrospectives/events/cycle-decision-event.handler";
import { getKanbanEventEmitter } from "../../src/events/kanban-event-emitter";
import {
  KANBAN_RETROSPECTIVE_COOLDOWN_SKIPPED_EVENT,
} from "../../src/retrospectives/kanban-retrospective.service";

// The beforeEach system time is `2026-06-13T12:00:00.000Z` (= epoch
// seconds 1781352000). This integration spec uses the 60s sliding
// window, so the deterministic window-start epoch seconds is
// Math.floor((1781352000 - 60) / 60) * 60 = 1781351940.
const LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS = 1781352000;
const LIFECYCLE_WINDOW_START_EPOCH_SECONDS = 1781351940;

type MockSystemSettingsReader = {
  get: ReturnType<typeof vi.fn>;
};

/**
 * Builds a `ISystemSettingsReader` mock whose `.get(key, defaultValue)`
 * resolves to the entry from `overrides` when the key is present, or
 * `defaultValue` otherwise. Mirrors the production
 * `SystemSettingsService.get<T>(key, defaultValue)` behaviour so the
 * integration spec can exercise the settings-driven resolution chain
 * against a real `KanbanRetrospectiveFailureThresholdService` +
 * `KanbanRetrospectiveService` stack.
 */
function buildSystemSettingsReader(
  overrides: Record<string, unknown> = {},
): MockSystemSettingsReader {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue: unknown) =>
      Object.prototype.hasOwnProperty.call(overrides, key)
        ? Promise.resolve(overrides[key])
        : Promise.resolve(defaultValue),
    ),
  };
}

function makeOrchestration(
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
    created_at: new Date("2026-06-13T00:00:00.000Z"),
    updated_at: new Date("2026-06-13T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRetrospectiveRun(
  overrides: Partial<KanbanRetrospectiveRunEntity> = {},
): KanbanRetrospectiveRunEntity {
  return {
    id: "failure-threshold-run-1",
    idempotency_key: `failure-threshold:project-1:${LIFECYCLE_WINDOW_START_EPOCH_SECONDS}`,
    project_id: "project-1",
    orchestration_id: null,
    trigger_type: "failure_threshold",
    trigger_revision_marker: `failure-threshold:project-1:${LIFECYCLE_WINDOW_START_EPOCH_SECONDS}`,
    replay_of_run_id: null,
    replay_of_run_id: null,
    status: "running",
    skip_reason: null,
    failure_reason: null,
    candidate_count: 0,
    learning_candidate_ids: [],
    delta_snapshot_json: null,
    diagnostics_json: null,
    started_at: new Date("2026-06-13T12:00:00.000Z"),
    completed_at: null,
    created_at: new Date("2026-06-13T12:00:00.000Z"),
    updated_at: new Date("2026-06-13T12:00:00.000Z"),
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
      updatedAt: "2026-06-13T00:00:00.000Z",
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
        timestamp: "2026-06-13T00:00:00.000Z",
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

describe(
  "KanbanRetrospectiveFailureThresholdService lifecycle " +
    "(deterministic marker + cooldown dedupe + bypass paths)",
  () => {
    let service: KanbanRetrospectiveService;
    let failureThresholdService: KanbanRetrospectiveFailureThresholdService;

    // Backing state for the in-memory repositories.
    let orchestrationState: KanbanOrchestrationEntity;
    let runStore: Map<string, KanbanRetrospectiveRunEntity>;

    let orchestrationsRepo: {
      findByproject_id: ReturnType<typeof vi.fn>;
      save: ReturnType<typeof vi.fn>;
      findByLinkedRunId: ReturnType<typeof vi.fn>;
      clearLinkedRunIfMatches: ReturnType<typeof vi.fn>;
      findAll: ReturnType<typeof vi.fn>;
      findByStatus: ReturnType<typeof vi.fn>;
      deleteByproject_id: ReturnType<typeof vi.fn>;
    };
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
    let coreClient: {
      emitDomainEvent: ReturnType<typeof vi.fn>;
      emitDomainEventOrThrow: ReturnType<typeof vi.fn>;
    };
    let cycleDecisionHandler: {
      register: ReturnType<typeof vi.fn>;
      getDecisionsForProject: ReturnType<typeof vi.fn>;
    };
    let systemSettings: MockSystemSettingsReader;
    let emitSpy: ReturnType<typeof vi.spyOn>;

    /**
     * Build a fresh `KanbanRetrospectiveFailureThresholdService` with
     * a controlled `ISystemSettingsReader` mock. Each test calls this
     * to wire the settings it cares about (e.g. `BypassCooldown`).
     */
    function buildFailureThresholdService(
      settingsOverrides: Record<string, unknown> = {},
    ): KanbanRetrospectiveFailureThresholdService {
      systemSettings = buildSystemSettingsReader(settingsOverrides);
      return new KanbanRetrospectiveFailureThresholdService(
        orchestrationsRepo as unknown as KanbanOrchestrationRepository,
        service,
        systemSettings as unknown as ISystemSettingsReader,
      );
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));

      orchestrationState = makeOrchestration();
      runStore = new Map<string, KanbanRetrospectiveRunEntity>();

      orchestrationsRepo = {
        findByproject_id: vi.fn((projectId: string) => {
          if (orchestrationState.project_id === projectId) {
            return Promise.resolve(
              Object.assign({}, orchestrationState),
            );
          }
          return Promise.resolve(null);
        }),
        save: vi.fn((input: Partial<KanbanOrchestrationEntity>) => {
          orchestrationState = Object.assign(
            {},
            orchestrationState,
            input,
          );
          return Promise.resolve(orchestrationState);
        }),
        // Unused by the failure-threshold code path.
        findByLinkedRunId: vi.fn().mockResolvedValue(null),
        clearLinkedRunIfMatches: vi.fn().mockResolvedValue(true),
        findAll: vi.fn().mockResolvedValue([]),
        findByStatus: vi.fn().mockResolvedValue([]),
        deleteByproject_id: vi.fn().mockResolvedValue(undefined),
      };

      runsRepo = {
        createRun: vi.fn((input) => {
          const entity = makeRetrospectiveRun({
            id: `failure-threshold-run-${runStore.size + 1}`,
            idempotency_key: input.idempotency_key,
            project_id: input.project_id,
            orchestration_id: input.orchestration_id ?? null,
            trigger_type: input.trigger_type,
            trigger_revision_marker:
              input.trigger_revision_marker ?? null,
            replay_of_run_id: input.replay_of_run_id ?? null,
            status: "running",
            skip_reason: null,
            failure_reason: null,
            candidate_count: 0,
            learning_candidate_ids: [],
            delta_snapshot_json: null,
            diagnostics_json: input.diagnostics_json ?? null,
            started_at: input.started_at ?? new Date(),
            completed_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          });
          runStore.set(entity.id, entity);
          return Promise.resolve(entity);
        }),
        findByIdempotencyKey: vi.fn((key: string) => {
          for (const run of runStore.values()) {
            if (run.idempotency_key === key) {
              return Promise.resolve(run);
            }
          }
          return Promise.resolve(null);
        }),
        findLatestByProject: vi.fn((projectId: string) => {
          const matching = [...runStore.values()]
            .filter((r) => r.project_id === projectId)
            .sort(
              (a, b) =>
                b.created_at.getTime() - a.created_at.getTime(),
            );
          return Promise.resolve(matching[0] ?? null);
        }),
        findLatestCompletedByProject: vi.fn((projectId: string) => {
          const matching = [...runStore.values()]
            .filter(
              (r) => r.project_id === projectId && r.status === "completed",
            )
            .sort((a, b) => {
              const aTs = a.completed_at?.getTime() ?? 0;
              const bTs = b.completed_at?.getTime() ?? 0;
              return bTs - aTs;
            });
          return Promise.resolve(matching[0] ?? null);
        }),
        markCompleted: vi.fn((id: string, input) => {
          const run = runStore.get(id);
          if (run) {
            run.status = "completed";
            run.candidate_count = input.candidate_count;
            run.learning_candidate_ids = input.learning_candidate_ids ?? [];
            run.delta_snapshot_json = input.delta_snapshot_json ?? null;
            run.diagnostics_json = input.diagnostics_json ?? null;
            run.completed_at = input.completed_at ?? new Date();
            run.updated_at = new Date();
          }
          return Promise.resolve();
        }),
        markSkipped: vi.fn((id: string, input) => {
          const run = runStore.get(id);
          if (run) {
            run.status = "skipped";
            run.skip_reason = input.skip_reason;
            run.diagnostics_json = input.diagnostics_json ?? null;
            run.completed_at = input.completed_at ?? new Date();
            run.updated_at = new Date();
          }
          return Promise.resolve();
        }),
        markFailed: vi.fn((id: string, input) => {
          const run = runStore.get(id);
          if (run) {
            run.status = "failed";
            run.failure_reason = input.failure_reason;
            run.diagnostics_json = input.diagnostics_json ?? null;
            run.completed_at = input.completed_at ?? new Date();
            run.updated_at = new Date();
          }
          return Promise.resolve();
        }),
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(null),
      };

      coreClient = {
        emitDomainEvent: vi.fn().mockResolvedValue(undefined),
        emitDomainEventOrThrow: vi.fn().mockResolvedValue(undefined),
      };

      cycleDecisionHandler = {
        register: vi.fn(),
        getDecisionsForProject: vi.fn().mockReturnValue([]),
      };

      // The real KanbanRetrospectiveService is constructed with the
      // evidence-service stubbed to return a "ready" delta so the
      // failure-threshold run flows to completion.
      const evidenceSvc = {
        collectProjectEvidence: vi.fn((projectIdArg: string) =>
          Promise.resolve({
            state: "ready" as const,
            projectId: projectIdArg,
            deltaSnapshot: makeDeltaSnapshot(),
            cycleDecisionEvents: [],
          }),
        ),
      };
      service = new KanbanRetrospectiveService(
        runsRepo as unknown as KanbanRetrospectiveRunRepository,
        orchestrationsRepo as unknown as KanbanOrchestrationRepository,
        evidenceSvc as unknown as Parameters<
          typeof KanbanRetrospectiveService
        >[2],
        coreClient as unknown as CoreWorkflowClientService,
        cycleDecisionHandler as unknown as CycleDecisionEventHandler,
      );

      emitSpy = vi
        .spyOn(getKanbanEventEmitter(), "emit")
        .mockReturnValue(true);
    });

    afterEach(() => {
      delete process.env.FAILURE_THRESHOLD_COUNT;
      delete process.env.RETROSPECTIVE_FAILURE_THRESHOLD_COUNT;
      delete process.env.RETROSPECTIVE_FAILURE_THRESHOLD_ENABLED;
      delete process.env.RETROSPECTIVE_FAILURE_THRESHOLD_COOLDOWN_SECONDS;
      delete process.env.RETROSPECTIVE_FAILURE_THRESHOLD_BYPASS_COOLDOWN;
      vi.useRealTimers();
      emitSpy.mockRestore();
    });

    it(
      "5 failures within a 60s window -> 1 fire with deterministic marker " +
        "-> 2 dedupes within the same window/cooldown -> 1 fire with bypass " +
        "(new window, new deterministic marker)",
      async () => {
        // The settings reader keeps the operator-tunable knobs under
        // explicit control: 60s window, 3-failure threshold, 900s
        // cooldown, bypass-off by default. This matches the
        // "5 failures within 60s -> 1 fire" path described in the
        // work item's AC-5.
        failureThresholdService = buildFailureThresholdService({
          retrospective_failure_threshold_window_seconds: 60,
          retrospective_failure_threshold_count: 3,
          retrospective_failure_threshold_cooldown_seconds: 900,
          retrospective_failure_threshold_bypass_cooldown: false,
        });

        // ── Step 1: seed 5 consecutive failures within the 60s
        //          sliding window. The first 2 calls land below the
        //          threshold (in-window count 1, 2); the 3rd call
        //          fires. Calls 4 + 5 fall within the 900s cooldown
        //          and must be deduped.
        await failureThresholdService.checkFailureThreshold("project-1");
        await failureThresholdService.checkFailureThreshold("project-1");
        await failureThresholdService.checkFailureThreshold("project-1");
        await failureThresholdService.checkFailureThreshold("project-1");
        await failureThresholdService.checkFailureThreshold("project-1");

        // ── Assert: exactly one run was created with the deterministic
        //          trigger revision marker.
        expect(runStore.size).toBe(1);
        const firstRun = [...runStore.values()][0];
        expect(firstRun.trigger_type).toBe("failure_threshold");
        expect(firstRun.trigger_revision_marker).toBe(
          `failure-threshold:project-1:${LIFECYCLE_WINDOW_START_EPOCH_SECONDS}`,
        );
        expect(firstRun.idempotency_key).toBe(
          `failure-threshold:project-1:${LIFECYCLE_WINDOW_START_EPOCH_SECONDS}`,
        );
        expect(firstRun.status).toBe("completed");
        expect(firstRun.candidate_count).toBe(1);

        // The orchestration metadata must carry the deterministic
        // last-emitted bookkeeping keys, ready to dedupe the next
        // emission within the same window.
        expect(orchestrationState.metadata).toEqual(
          expect.objectContaining({
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
              LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
              LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
              LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
              LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
            ],
            [LAST_EMITTED_WINDOW_METADATA_KEY]:
              `project-1:${LIFECYCLE_WINDOW_START_EPOCH_SECONDS}`,
            [LAST_EMITTED_AT_METADATA_KEY]:
              LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
          }),
        );

        // ── Step 2: simulate a retried emission within the cooldown.
        //          The service must NOT create a new run.
        const createRunCallsBefore =
          vi.mocked(runsRepo.createRun).mock.calls.length;
        await failureThresholdService.checkFailureThreshold("project-1");
        await failureThresholdService.checkFailureThreshold("project-1");
        expect(vi.mocked(runsRepo.createRun).mock.calls.length).toBe(
          createRunCallsBefore,
        );
        expect(runStore.size).toBe(1);

        // ── Step 3: flip BypassCooldown=true and advance the system
        //          clock past the 60s window so the next call lands
        //          in a fresh window. The trigger fires AGAIN with a
        //          new trigger revision marker (still deterministic
        //          for the new windowStartEpochSeconds).
        vi.setSystemTime(new Date("2026-06-13T12:01:00.000Z"));
        failureThresholdService = buildFailureThresholdService({
          retrospective_failure_threshold_window_seconds: 60,
          retrospective_failure_threshold_count: 3,
          retrospective_failure_threshold_cooldown_seconds: 900,
          retrospective_failure_threshold_bypass_cooldown: true,
        });
        // Seed enough in-window timestamps so the post-prune count
        // meets the new window's threshold.
        orchestrationState = makeOrchestration({
          metadata: {
            consecutive_failure_count: 3,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              LIFECYCLE_WINDOW_START_EPOCH_SECONDS + 70,
              LIFECYCLE_WINDOW_START_EPOCH_SECONDS + 80,
              LIFECYCLE_WINDOW_START_EPOCH_SECONDS + 90,
            ],
          },
        });
        await failureThresholdService.checkFailureThreshold("project-1");

        const newWindowStartEpochSeconds =
          LIFECYCLE_WINDOW_START_EPOCH_SECONDS + 60;
        expect(runStore.size).toBe(2);
        const secondRun = [...runStore.values()][1];
        expect(secondRun.trigger_type).toBe("failure_threshold");
        expect(secondRun.trigger_revision_marker).toBe(
          `failure-threshold:project-1:${newWindowStartEpochSeconds}`,
        );
        expect(secondRun.idempotency_key).toBe(
          `failure-threshold:project-1:${newWindowStartEpochSeconds}`,
        );

        // The retrospective service must surface a
        // `kanban.retrospective.cooldown_skipped` audit event when
        // the bypass path is taken. This pins the OPEN_QUESTIONS K2
        // contract end-to-end.
        const cooldownSkippedPayload = emitSpy.mock.calls
          .filter(
            (call) => call[0] === KANBAN_RETROSPECTIVE_COOLDOWN_SKIPPED_EVENT,
          )
          .map((call) => call[1] as Record<string, unknown> | undefined)
          .filter((payload): payload is Record<string, unknown> =>
            payload !== undefined,
          );
        expect(cooldownSkippedPayload.length).toBeGreaterThanOrEqual(1);
        const lastSkipped = cooldownSkippedPayload.at(-1);
        expect(lastSkipped).toEqual(
          expect.objectContaining({
            event_name: KANBAN_RETROSPECTIVE_COOLDOWN_SKIPPED_EVENT,
            scope_id: "project-1",
            bypass_cooldown: true,
            trigger_revision_marker: `failure-threshold:project-1:${newWindowStartEpochSeconds}`,
            window_start_epoch_seconds: newWindowStartEpochSeconds,
            recorded_at: expect.stringMatching(
              /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            ),
          }),
        );
      },
    );

    it("dedupes by (projectId, windowStartEpochSeconds) so retried emissions within the same window do not fire", async () => {
      failureThresholdService = buildFailureThresholdService({
        retrospective_failure_threshold_window_seconds: 60,
        retrospective_failure_threshold_count: 3,
        retrospective_failure_threshold_cooldown_seconds: 900,
        retrospective_failure_threshold_bypass_cooldown: true,
      });

      // Seed two prior in-window timestamps so the post-prune count
      // reaches 3 (= threshold) after the first call.
      orchestrationState = makeOrchestration({
        metadata: {
          consecutive_failure_count: 2,
          [FAILURE_TIMESTAMPS_METADATA_KEY]: [
            LIFECYCLE_WINDOW_START_EPOCH_SECONDS + 10,
            LIFECYCLE_WINDOW_START_EPOCH_SECONDS + 20,
          ],
        },
      });

      // First call: fires (window dedupe is empty).
      await failureThresholdService.checkFailureThreshold("project-1");
      const createRunCallsAfterFirst =
        vi.mocked(runsRepo.createRun).mock.calls.length;
      expect(runStore.size).toBe(1);

      // Second call within the same window: the (projectId,
      // windowStartEpochSeconds) dedupe short-circuits BEFORE the
      // cooldown / bypass checks, so even with BypassCooldown=true
      // the trigger must NOT fire again.
      await failureThresholdService.checkFailureThreshold("project-1");
      expect(vi.mocked(runsRepo.createRun).mock.calls.length).toBe(
        createRunCallsAfterFirst,
      );
      expect(runStore.size).toBe(1);
    });
  },
);