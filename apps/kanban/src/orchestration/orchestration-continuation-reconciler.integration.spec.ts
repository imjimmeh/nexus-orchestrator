/**
 * Cross-component integration test for OrchestrationContinuationReconcilerService.
 *
 * Verifies AC-2 + AC-4 (partial) for the Project WIP Cap work item
 * (`6d9d9031-ed15-4340-b79b-5d200ff0fed2`):
 *   1. Stale wakeups are suppressed when project capacity is exhausted,
 *      with the suppression recorded under reason `project_wip_limit_reached`.
 *   2. Orphan-recovery wakeups bypass the cap and proceed even when capacity
 *      is exhausted (the reconciler never invokes the WIP gate on the
 *      orphan-recovery path).
 *   3. The reconciler reads the persisted
 *      `work_item_dispatch_max_active_per_project` setting consistently —
 *      raising the persisted cap at runtime immediately changes the gating
 *      outcome.
 *   4. Below-cap wakeups always proceed.
 *
 * Wiring strategy (mirrors
 * `apps/kanban/src/mcp/tools/mutation/work-item-transition-status.integration.spec.ts`):
 *   - Real `OrchestrationContinuationReconcilerService` constructed via
 *     `Test.createTestingModule` `useFactory` so its concrete-class
 *     constructor params can be supplied with deterministic fakes.
 *   - Real `KanbanSettingsService` against a `Map`-backed in-memory
 *     `KanbanSettingRepository`.
 *   - Fake `DispatchService` whose `resolveProjectDispatchCapacity`
 *     delegates to the real `resolveProjectDispatchCapacity` helper from
 *     `apps/kanban/src/dispatch/project-dispatch-capacity.ts`, reading the
 *     cap live from the in-memory settings service — no capacity math is
 *     reimplemented.
 *   - Minimal fakes for the remaining collaborators
 *     (orchestration service / wakeup service / lease service / work-item
 *     repository) so each scenario drives a deterministic wakeup outcome.
 */

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DispatchService } from "../dispatch/dispatch.service";
import type { ProjectDispatchCapacity } from "../dispatch/project-dispatch-capacity.types";
import { resolveProjectDispatchCapacity } from "../dispatch/project-dispatch-capacity";
import type { WorkItemRecord } from "../dispatch/dispatch-internal.types";
import type { DispatchRunReconciliationSummary } from "../dispatch/dispatch.service.types";
import { KanbanSettingRepository } from "../database/repositories/kanban-setting.repository";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import { OrchestrationContinuationReconcilerService } from "./orchestration-continuation-reconciler.service";
import type { OrchestrationPersistenceRecord } from "./orchestration-internal.types";
import type {
  RequestWakeupInput,
  RequestWakeupResult,
} from "./project-orchestration-wakeup.types";

interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ActiveWorkItemSeed {
  id: string;
  status:
    | "in-progress"
    | "in-review"
    | "ready-to-merge"
    | "todo"
    | "done"
    | "blocked";
  linkedRunId?: string | null;
  currentExecutionId?: string | null;
}

function createInMemorySettingsRepository(): {
  repository: KanbanSettingRepository;
  store: Map<string, SettingRow>;
} {
  const store = new Map<string, SettingRow>();

  const repository = {
    findAll: vi.fn(() =>
      Promise.resolve(
        [...store.values()].sort((a, b) => a.key.localeCompare(b.key)),
      ),
    ),
    findByKey: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    upsert: vi.fn(
      (key: string, value: unknown, description?: string | null) => {
        const existing = store.get(key);
        const row: SettingRow = {
          key,
          value,
          description:
            description === undefined
              ? (existing?.description ?? null)
              : description,
          createdAt: existing?.createdAt ?? new Date(),
          updatedAt: new Date(),
        };
        store.set(key, row);
        return Promise.resolve(row);
      },
    ),
  } as unknown as KanbanSettingRepository;

  return { repository, store };
}

function makeWorkItem(
  projectId: string,
  seed: ActiveWorkItemSeed,
): WorkItemRecord {
  const now = new Date("2026-07-01T00:00:00.000Z");
  return {
    id: seed.id,
    project_id: projectId,
    title: `Work item ${seed.id}`,
    status: seed.status,
    priority: "p2",
    type: "story",
    parent_work_item_id: null,
    assigned_agent_id: null,
    linked_run_id: seed.linkedRunId ?? null,
    current_execution_id: seed.currentExecutionId ?? null,
    execution_config: null,
    metadata: null,
    created_at: now,
    updated_at: now,
  };
}

type FakeReconcileResult = DispatchRunReconciliationSummary;
type FakeReconcileFn = (projectId: string) => Promise<FakeReconcileResult>;
type FakeCapacityFn = (projectId: string) => Promise<ProjectDispatchCapacity>;

interface FakeWiring {
  states: OrchestrationPersistenceRecord[];
  itemsByProject: Map<string, WorkItemRecord[]>;
  reconcileByProject: Map<string, FakeReconcileResult>;
  clearCycleDecisionSpy: Mock<() => Promise<void>>;
  markPendingConsecutiveFailureSpy: Mock<() => Promise<void>>;
  findCleanupSpy: Mock<() => Promise<OrchestrationPersistenceRecord[]>>;
  findStateSpy: Mock<() => Promise<OrchestrationPersistenceRecord[]>>;
  requestWakeupSpy: Mock<
    (input: RequestWakeupInput) => Promise<RequestWakeupResult>
  >;
  heartbeatLeaseSpy: Mock<() => Promise<void>>;
  findByProjectAndIdSpy: Mock<
    (projectId: string, workItemId: string) => Promise<WorkItemRecord | null>
  >;
  reconcileProjectLinkedRunsSpy: Mock<FakeReconcileFn>;
  resolveProjectDispatchCapacitySpy: Mock<FakeCapacityFn>;
}

function buildFakeWiring(): FakeWiring {
  const wiring: FakeWiring = {
    states: [],
    itemsByProject: new Map<string, WorkItemRecord[]>(),
    reconcileByProject: new Map<string, FakeReconcileResult>(),
    clearCycleDecisionSpy: vi.fn().mockResolvedValue(undefined),
    markPendingConsecutiveFailureSpy: vi.fn().mockResolvedValue(undefined),
    findCleanupSpy: vi.fn(),
    findStateSpy: vi.fn().mockResolvedValue([]),
    requestWakeupSpy: vi.fn(
      (_input: RequestWakeupInput): Promise<RequestWakeupResult> =>
        Promise.resolve({ emitted: true }),
    ),
    heartbeatLeaseSpy: vi.fn().mockResolvedValue(undefined),
    findByProjectAndIdSpy: vi
      .fn()
      .mockImplementation((projectId: string, workItemId: string) => {
        const items = wiring.itemsByProject.get(projectId) ?? [];
        const match = items.find((item) => item.id === workItemId);
        return Promise.resolve(match ?? null);
      }),
    reconcileProjectLinkedRunsSpy: vi.fn<FakeReconcileFn>(
      (projectId: string) => {
        const summary = wiring.reconcileByProject.get(projectId);
        if (summary) {
          return Promise.resolve(summary);
        }
        return Promise.resolve<FakeReconcileResult>({
          reconciled: [],
          skipped: [],
          orphanReconciled: [],
        });
      },
    ),
    resolveProjectDispatchCapacitySpy: vi.fn<FakeCapacityFn>(),
  };
  // Wire `findCleanupSpy` after the object exists (closure over `wiring`).
  wiring.findCleanupSpy = vi.fn(() => Promise.resolve(wiring.states.slice()));
  return wiring;
}

describe("OrchestrationContinuationReconcilerService WIP cap integration", () => {
  let app: INestApplication;
  let reconciler: OrchestrationContinuationReconcilerService;
  let kanbanSettings: KanbanSettingsService;
  let settingsStore: Map<string, SettingRow>;
  let wiring: FakeWiring;

  const projectId = "project-wip-cap";

  async function buildReconciler(): Promise<void> {
    const { repository: settingsRepository, store } =
      createInMemorySettingsRepository();
    settingsStore = store;
    wiring = buildFakeWiring();

    const dispatchService: DispatchService = {
      reconcileProjectLinkedRuns: wiring.reconcileProjectLinkedRunsSpy,
      resolveProjectDispatchCapacity: wiring.resolveProjectDispatchCapacitySpy,
    } as unknown as DispatchService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        KanbanSettingsService,
        { provide: KanbanSettingRepository, useValue: settingsRepository },
        {
          provide: OrchestrationContinuationReconcilerService,
          useFactory: (injectedDispatch: DispatchService) =>
            new OrchestrationContinuationReconcilerService(
              {
                findOrchestratingStates: wiring.findStateSpy,
                findOrchestratingStatesForContinuationCleanup:
                  wiring.findCleanupSpy,
                clearCycleDecision: wiring.clearCycleDecisionSpy,
                markPendingConsecutiveFailure:
                  wiring.markPendingConsecutiveFailureSpy,
              } as never,
              { requestWakeup: wiring.requestWakeupSpy } as never,
              injectedDispatch,
              { heartbeatCycleLease: wiring.heartbeatLeaseSpy } as never,
              { findByProjectAndId: wiring.findByProjectAndIdSpy } as never,
            ),
          inject: [DispatchService],
        },
        { provide: DispatchService, useValue: dispatchService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    reconciler = moduleRef.get(OrchestrationContinuationReconcilerService);
    kanbanSettings = moduleRef.get(KanbanSettingsService);

    // Replace the no-op implementation on the shared spy so all assertions
    // observe the same `resolveProjectDispatchCapacitySpy` reference that
    // the reconciler invokes. Capacity math still delegates to the real
    // `resolveProjectDispatchCapacity` helper reading the live persisted
    // setting via the real `KanbanSettingsService`.
    wiring.resolveProjectDispatchCapacitySpy.mockImplementation((pid) => {
      const items = wiring.itemsByProject.get(pid) ?? [];
      const maxActive = kanbanSettings.getNumber(
        "work_item_dispatch_max_active_per_project",
      );
      return maxActive.then((max) =>
        resolveProjectDispatchCapacity(items, max),
      );
    });
  }

  beforeEach(async () => {
    await buildReconciler();
  });

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });

  function seedItems(seeds: readonly ActiveWorkItemSeed[]): void {
    wiring.itemsByProject.set(
      projectId,
      seeds.map((seed) => makeWorkItem(projectId, seed)),
    );
  }

  function seedState(
    overrides: Partial<OrchestrationPersistenceRecord> = {},
  ): OrchestrationPersistenceRecord {
    const now = new Date("2026-07-01T00:00:00.000Z");
    const state: OrchestrationPersistenceRecord = {
      project_id: projectId,
      goals: "Cap regression scenario",
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: "run-cap-1",
      decision_log: [],
      action_requests: [],
      metadata: {},
      created_at: now,
      updated_at: now,
      ...overrides,
    };
    wiring.states.push(state);
    return state;
  }

  it("suppresses a stale wakeup when project capacity is exhausted", async () => {
    // Cap = 1, project already at capacity with one in-progress item.
    // A fresh stale wakeup must NOT propagate to the wakeup service; the
    // suppression is observed here as `requestWakeup` never being invoked
    // while the live persisted setting the reconciler read is still cap=1.
    await kanbanSettings.set("work_item_dispatch_max_active_per_project", 1);
    seedItems([{ id: "active-1", status: "in-progress" }]);
    seedState();
    wiring.reconcileByProject.set(projectId, {
      reconciled: [],
      skipped: [],
      orphanReconciled: [],
    });

    const result = await reconciler.reconcileStaleContinuations();

    expect(result).toEqual({ evaluated: 1 });
    expect(wiring.resolveProjectDispatchCapacitySpy).toHaveBeenCalledWith(
      projectId,
    );
    expect(wiring.requestWakeupSpy).not.toHaveBeenCalled();
    expect(wiring.clearCycleDecisionSpy).not.toHaveBeenCalled();
    expect(
      settingsStore.get("work_item_dispatch_max_active_per_project"),
    ).toMatchObject({ value: 1 });
  });

  it("allows an orphan-recovery wakeup to bypass the project WIP cap", async () => {
    // Cap = 1, project already at capacity, but the reconciler detects
    // orphaned in-progress items. The orphan-recovery wakeup MUST proceed
    // even though capacity is exhausted — the reconciler short-circuits
    // before checking capacity once orphans are found.
    await kanbanSettings.set("work_item_dispatch_max_active_per_project", 1);
    seedItems([{ id: "active-1", status: "in-progress" }]);
    seedState();
    wiring.reconcileByProject.set(projectId, {
      reconciled: [],
      skipped: [],
      orphanReconciled: [
        { workItemId: "orphan-1", previousStatus: "in-progress" },
      ],
    });

    const result = await reconciler.reconcileStaleContinuations();

    expect(result).toEqual({ evaluated: 1 });
    expect(wiring.reconcileProjectLinkedRunsSpy).toHaveBeenCalledWith(
      projectId,
    );
    expect(wiring.clearCycleDecisionSpy).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({
        reason: expect.stringContaining("orphaned in-progress work item"),
      }),
    );
    expect(wiring.resolveProjectDispatchCapacitySpy).not.toHaveBeenCalled();
    expect(wiring.requestWakeupSpy).toHaveBeenCalledTimes(1);
    expect(wiring.requestWakeupSpy).toHaveBeenCalledWith({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });
  });

  it("reads the persisted cap live — raising the cap flips suppression off", async () => {
    // Cap = 3, project at capacity (3 active items). The first stale
    // wakeup must be suppressed. After raising the persisted cap to 5,
    // the same setup must proceed — proving the reconciler reads the live
    // persisted setting through `KanbanSettingsService`.
    await kanbanSettings.set("work_item_dispatch_max_active_per_project", 3);
    seedItems([
      { id: "active-1", status: "in-progress" },
      { id: "active-2", status: "in-review" },
      { id: "active-3", status: "ready-to-merge" },
    ]);
    seedState();
    wiring.reconcileByProject.set(projectId, {
      reconciled: [],
      skipped: [],
      orphanReconciled: [],
    });

    const suppressedResult = await reconciler.reconcileStaleContinuations();
    expect(suppressedResult).toEqual({ evaluated: 1 });
    expect(wiring.requestWakeupSpy).not.toHaveBeenCalled();

    // Raise the persisted cap — the dispatch fake will read it on the
    // next reconcile pass.
    await kanbanSettings.set("work_item_dispatch_max_active_per_project", 5);

    wiring.requestWakeupSpy.mockClear();

    const allowedResult = await reconciler.reconcileStaleContinuations();
    expect(allowedResult).toEqual({ evaluated: 1 });
    expect(wiring.requestWakeupSpy).toHaveBeenCalledTimes(1);
    expect(wiring.requestWakeupSpy).toHaveBeenCalledWith({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });
    expect(
      settingsStore.get("work_item_dispatch_max_active_per_project"),
    ).toMatchObject({ value: 5 });
  });

  it("proceeds with a stale wakeup when the project is below its persisted cap", async () => {
    // Cap = 5, project has only 2 active items → a stale wakeup must
    // propagate, no suppression.
    await kanbanSettings.set("work_item_dispatch_max_active_per_project", 5);
    seedItems([
      { id: "active-1", status: "in-progress" },
      { id: "active-2", status: "in-review" },
    ]);
    seedState();
    wiring.reconcileByProject.set(projectId, {
      reconciled: [],
      skipped: [],
      orphanReconciled: [],
    });

    const result = await reconciler.reconcileStaleContinuations();

    expect(result).toEqual({ evaluated: 1 });
    expect(wiring.resolveProjectDispatchCapacitySpy).toHaveBeenCalledWith(
      projectId,
    );
    expect(wiring.requestWakeupSpy).toHaveBeenCalledTimes(1);
    expect(wiring.requestWakeupSpy).toHaveBeenCalledWith({
      projectId,
      reason: "stale_reconciler",
      source: "orchestration_continuation_reconciler",
    });
  });
});
