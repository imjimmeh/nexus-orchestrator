import { Test, type TestingModule } from "@nestjs/testing";
import { BaseRequestContextService } from "@nexus/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { CoreWorkflowClientService } from "../../src/core/core-workflow-client.service";
import { KanbanProjectRepository } from "../../src/database/repositories/kanban-project.repository";
import { KanbanSettingRepository } from "../../src/database/repositories/kanban-setting.repository";
import { KanbanWorkItemRepository } from "../../src/database/repositories/kanban-work-item.repository";
import { DispatchService } from "../../src/dispatch/dispatch.service";
import { OrchestrationLeaseService } from "../../src/orchestration/control-plane/orchestration-lease.service";
import { OrchestrationContinuationReconcilerService } from "../../src/orchestration/orchestration-continuation-reconciler.service";
import { OrchestrationService } from "../../src/orchestration/orchestration.service";
import { ProjectOrchestrationWakeupService } from "../../src/orchestration/project-orchestration-wakeup.service";
import { ProjectService } from "../../src/project/project.service";
import { KanbanSettingsService } from "../../src/settings/kanban-settings.service";
import { WorkItemService } from "../../src/work-item/work-item.service";
import { getCycleRequestsForProject } from "./project-orchestration-cycle-request-test.helpers";

const MAX_ACTIVE_KEY = "work_item_dispatch_max_active_per_project";
const PROJECT_ID = "p1";
const ENV_KEYS = [
  "KANBAN_MCP_SERVER_ID",
  "KANBAN_MCP_SERVER_IDS",
  "KANBAN_MCP_URL",
  "KANBAN_SERVICE_BEARER_TOKEN",
] as const;

type WorkItemFixture = {
  id: string;
  project_id: string;
  status: string;
  linked_run_id: string | null;
  current_execution_id: string | null;
  assigned_agent_id: string | null;
  execution_config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

function makeWorkItem(
  overrides: Partial<WorkItemFixture> = {},
): WorkItemFixture {
  return {
    id: "wi-unknown",
    project_id: PROJECT_ID,
    status: "todo",
    linked_run_id: null,
    current_execution_id: null,
    assigned_agent_id: null,
    execution_config: null,
    metadata: null,
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createInMemorySettingRepository(): KanbanSettingRepository {
  const rows = new Map<
    string,
    { value: unknown; description: string | null; createdAt: Date }
  >();
  const now = () => new Date("2026-06-01T00:00:00.000Z");
  return {
    findAll: vi.fn(() =>
      Promise.resolve(
        [...rows.entries()]
          .map(([key, v]) => ({
            key,
            value: v.value,
            description: v.description,
            createdAt: v.createdAt,
            updatedAt: now(),
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      ),
    ),
    findByKey: vi.fn((key: string) => {
      const r = rows.get(key);
      return Promise.resolve(
        r
          ? {
              key,
              value: r.value,
              description: r.description,
              createdAt: r.createdAt,
              updatedAt: now(),
            }
          : null,
      );
    }),
    upsert: vi.fn(
      (key: string, value: unknown, description?: string | null) => {
        const existing = rows.get(key);
        const row = {
          value,
          description:
            description === undefined
              ? (existing?.description ?? null)
              : description,
          createdAt: existing?.createdAt ?? now(),
        };
        rows.set(key, row);
        return { key, ...row, updatedAt: now() };
      },
    ),
  } as unknown as KanbanSettingRepository;
}

class InMemoryWorkItemRepository {
  private readonly items = new Map<string, WorkItemFixture>();

  seed(item: WorkItemFixture): void {
    this.items.set(item.id, item);
  }

  findByproject_id(project_id: string): Promise<WorkItemFixture[]> {
    return Promise.resolve(
      [...this.items.values()].filter((item) => item.project_id === project_id),
    );
  }

  findByProjectAndId(
    _project_id: string,
    workItemId: string,
  ): Promise<WorkItemFixture | null> {
    return Promise.resolve(this.items.get(workItemId) ?? null);
  }
}

describe("WIP cap reconciler integration (AC-2)", () => {
  let moduleRef: TestingModule;
  let reconciler: OrchestrationContinuationReconcilerService;
  let settingsService: KanbanSettingsService;
  let workItemRepo: InMemoryWorkItemRepository;
  let coreClient: {
    emitDomainEventOrThrow: Mock<(event: unknown) => Promise<void>>;
    // Shared backing store so `getCycleRequestsForProject` (which inspects
    // `emitDomainEvent.mock.calls`) sees the events emitted via
    // `emitDomainEventOrThrow` — the dispatch service uses the throwing
    // variant in production, but the test helper was written against the
    // non-throwing variant.
    emitDomainEvent: Mock<(event: unknown) => Promise<void>>;
  };
  let orchestrationService: {
    findOrchestratingStatesForContinuationCleanup: Mock<
      () => Promise<unknown[]>
    >;
    clearCycleDecision: Mock<
      (project_id: string, input: { reason: string }) => Promise<void>
    >;
    markPendingConsecutiveFailure: Mock<
      (
        project_id: string,
        input: { failedRunCount: number; reason: string },
      ) => Promise<void>
    >;
    getAutoWakeSuppressionState: Mock<
      (project_id: string) => Promise<{ suppressed: boolean }>
    >;
    getWakeupCooldownState: Mock<(project_id: string) => Promise<unknown>>;
    recordWakeup: Mock<
      (
        project_id: string,
        input: { source: string; reason: string },
      ) => Promise<void>
    >;
  };
  let leaseService: {
    acquireCycleLease: Mock<
      (
        project_id: string,
        correlationId: string,
      ) => Promise<{ acquired: boolean }>
    >;
    releaseCycleLease: Mock<(project_id: string) => Promise<void>>;
    heartbeatCycleLease: Mock<(project_id: string) => Promise<void>>;
  };
  let reconcileProjectLinkedRunsSpy: Mock<
    (projectId: string) => Promise<{
      reconciled: Array<{ status: string }>;
      skipped: Array<unknown>;
      orphanReconciled: Array<{ id: string }>;
    }>
  >;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      process.env[key] = "";
    }
    // Disable the reconciler's setInterval poll during the test — we drive
    // `reconcileStaleContinuations()` directly. Mirrors the unit spec at
    // `orchestration-continuation-reconciler.service.spec.ts:33`.
    process.env["KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS"] = "999999999";

    const repository = createInMemorySettingRepository();
    settingsService = new KanbanSettingsService(repository);
    await settingsService.seedDefaults();
    workItemRepo = new InMemoryWorkItemRepository();

    reconcileProjectLinkedRunsSpy = vi.fn(() =>
      Promise.resolve({ reconciled: [], skipped: [], orphanReconciled: [] }),
    );

    orchestrationService = {
      findOrchestratingStatesForContinuationCleanup: vi.fn(() =>
        Promise.resolve([]),
      ),
      clearCycleDecision: vi.fn(
        (_pid: string, _i: { reason: string }): Promise<void> =>
          Promise.resolve(),
      ),
      markPendingConsecutiveFailure: vi.fn(
        (
          _pid: string,
          _i: { failedRunCount: number; reason: string },
        ): Promise<void> => Promise.resolve(),
      ),
      getAutoWakeSuppressionState: vi.fn(
        (_pid: string): Promise<{ suppressed: boolean }> =>
          Promise.resolve({ suppressed: false }),
      ),
      getWakeupCooldownState: vi.fn(
        (_pid: string): Promise<unknown> => Promise.resolve(null),
      ),
      recordWakeup: vi.fn(
        (_pid: string, _i: { source: string; reason: string }): Promise<void> =>
          Promise.resolve(),
      ),
    };
    leaseService = {
      acquireCycleLease: vi.fn(
        (_pid: string, _cid: string): Promise<{ acquired: boolean }> =>
          Promise.resolve({ acquired: true }),
      ),
      releaseCycleLease: vi.fn(
        (_pid: string): Promise<void> => Promise.resolve(),
      ),
      heartbeatCycleLease: vi.fn(
        (_pid: string): Promise<void> => Promise.resolve(),
      ),
    };
    {
      // Share a single mock fn between both emit methods so the test
      // helper `getCycleRequestsForProject` (which inspects
      // `emitDomainEvent.mock.calls`) sees events emitted via the throwing
      // variant `DispatchService.requestOrchestrationCycle` uses.
      const emitMock = vi.fn(
        (_event: unknown): Promise<void> => Promise.resolve(),
      );
      coreClient = {
        emitDomainEventOrThrow: emitMock,
        emitDomainEvent: emitMock,
      };
    }

    moduleRef = await Test.createTestingModule({
      providers: [
        // SUT — real reconciler wired with the real DispatchService +
        // real ProjectOrchestrationWakeupService + real KanbanSettingsService
        // so the cap read sites are the same path production uses.
        OrchestrationContinuationReconcilerService,
        ProjectOrchestrationWakeupService,
        DispatchService,
        { provide: KanbanSettingsService, useValue: settingsService },
        { provide: KanbanSettingRepository, useValue: repository },
        { provide: KanbanWorkItemRepository, useValue: workItemRepo },
        // OrchestrationService has many deps (TypeORM repos, CycleDecisionService,
        // observers). Stub the methods the reconciler + wakeup service touch.
        { provide: OrchestrationService, useValue: orchestrationService },
        // OrchestrationLeaseService is TypeORM-backed; stub lease primitives.
        { provide: OrchestrationLeaseService, useValue: leaseService },
        // WorkItemService is only used by the dispatch core for refinement / orphan
        // / provision-failure recovery. The reconciler never reaches it directly
        // because `reconcileProjectLinkedRuns` is stubbed to return empty arrays.
        {
          provide: WorkItemService,
          useValue: { updateStatus: vi.fn(() => Promise.resolve(undefined)) },
        },
        // ProjectService is only used by `DispatchService.requestOrchestrationCycle`,
        // which tolerates a null project (falls through to null basePath/url).
        {
          provide: ProjectService,
          useValue: { get: vi.fn(() => Promise.resolve(null)) },
        },
        // KanbanProjectRepository is only consulted for the dispatched
        // project's `runtime_toolchains` launch input (Task 16); the
        // reconciler never dispatches real work here, so a null-returning
        // stub is sufficient.
        {
          provide: KanbanProjectRepository,
          useValue: { findById: vi.fn(() => Promise.resolve(null)) },
        },
        // Core workflow client is an HTTP collaborator — capture
        // `emitDomainEventOrThrow` calls so we can assert wakeup events.
        { provide: CoreWorkflowClientService, useValue: coreClient },
        {
          provide: BaseRequestContextService,
          useValue: {
            getRequestId: () => "corr-test",
            getCausationId: () => "cause-test",
          },
        },
      ],
    }).compile();

    reconciler = moduleRef.get(OrchestrationContinuationReconcilerService);

    // Replace the real `reconcileProjectLinkedRuns` with a spy so the
    // orphan-recovery escape hatch can be exercised deterministically. The
    // real method touches TypeORM repos we are not wiring here.
    const dispatchService = moduleRef.get(DispatchService);
    (
      dispatchService as unknown as { reconcileProjectLinkedRuns: Mock }
    ).reconcileProjectLinkedRuns = reconcileProjectLinkedRunsSpy;
  });

  afterEach(async () => {
    // The reconciler schedules a setInterval in `onModuleInit` — clear it
    // explicitly so it cannot leak across tests.
    reconciler.onModuleDestroy();
    await moduleRef?.close();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) process.env[key] = undefined;
      else process.env[key] = savedEnv[key];
    }
    delete process.env["KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS"];
    vi.clearAllMocks();
  });

  it("at capacity with no orphans suppresses the stale wakeup", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    workItemRepo.seed(
      makeWorkItem({
        id: "wi-active",
        status: "in-progress",
        linked_run_id: "run-active",
      }),
    );
    orchestrationService.findOrchestratingStatesForContinuationCleanup.mockResolvedValue(
      [{ project_id: PROJECT_ID, linked_run_id: null }] as never,
    );

    const result = await reconciler.reconcileStaleContinuations();

    expect(result).toEqual({ evaluated: 1 });
    // Suppress path: no wakeup requested, no clearCycleDecision fired.
    expect(
      getCycleRequestsForProject(coreClient as never, PROJECT_ID),
    ).toHaveLength(0);
    expect(coreClient.emitDomainEventOrThrow).not.toHaveBeenCalled();
    expect(orchestrationService.clearCycleDecision).not.toHaveBeenCalled();
    // `reconcileProjectLinkedRuns` is always called — the orphan check
    // happens before the cap check.
    expect(reconcileProjectLinkedRunsSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("below capacity with a stale continuation requests the wakeup", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 2);
    orchestrationService.findOrchestratingStatesForContinuationCleanup.mockResolvedValue(
      [{ project_id: PROJECT_ID, linked_run_id: null }] as never,
    );

    const result = await reconciler.reconcileStaleContinuations();

    expect(result).toEqual({ evaluated: 1 });
    // Happy path: a wakeup is emitted for p1.
    expect(
      getCycleRequestsForProject(coreClient as never, PROJECT_ID),
    ).toHaveLength(1);
    expect(coreClient.emitDomainEventOrThrow).toHaveBeenCalledTimes(1);
    // No orphans → no clearCycleDecision call.
    expect(orchestrationService.clearCycleDecision).not.toHaveBeenCalled();
  });

  it("at capacity but with orphan recovery still requests the wakeup (escape hatch)", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    workItemRepo.seed(
      makeWorkItem({
        id: "wi-active",
        status: "in-progress",
        linked_run_id: "run-active",
      }),
    );
    orchestrationService.findOrchestratingStatesForContinuationCleanup.mockResolvedValue(
      [{ project_id: PROJECT_ID, linked_run_id: null }] as never,
    );
    reconcileProjectLinkedRunsSpy.mockResolvedValue({
      reconciled: [],
      skipped: [],
      orphanReconciled: [{ id: "orphan-1" }],
    });

    const result = await reconciler.reconcileStaleContinuations();

    expect(result).toEqual({ evaluated: 1 });
    // Escape hatch: wakeup is emitted *even though* the project is at cap.
    expect(
      getCycleRequestsForProject(coreClient as never, PROJECT_ID),
    ).toHaveLength(1);
    expect(coreClient.emitDomainEventOrThrow).toHaveBeenCalledTimes(1);
    // Orphan recovery path: clearCycleDecision is called to wipe the
    // prior stop decision so the next cycle can resume dispatch.
    expect(orchestrationService.clearCycleDecision).toHaveBeenCalledTimes(1);
    expect(orchestrationService.clearCycleDecision).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        reason: expect.stringContaining("orphaned in-progress"),
      }),
    );
  });

  it("capacity resolution failure is non-fatal and the wakeup is still requested", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    workItemRepo.seed(
      makeWorkItem({
        id: "wi-active",
        status: "in-progress",
        linked_run_id: "run-active",
      }),
    );
    orchestrationService.findOrchestratingStatesForContinuationCleanup.mockResolvedValue(
      [{ project_id: PROJECT_ID, linked_run_id: null }] as never,
    );
    // Simulate a transport failure inside the real
    // `DispatchService.resolveProjectDispatchCapacity` by short-circuiting
    // the in-memory repository's `findByproject_id` to reject.
    const original = workItemRepo.findByproject_id.bind(workItemRepo);
    workItemRepo.findByproject_id = vi.fn((project_id: string) =>
      project_id === PROJECT_ID
        ? Promise.reject(new Error("settings unavailable"))
        : original(project_id),
    );

    const result = await reconciler.reconcileStaleContinuations();

    expect(result).toEqual({ evaluated: 1 });
    // Non-fatal: the reconciler logs the failure and still requests the
    // wakeup for p1 (mirrors the unit spec case at line 540 —
    // `shouldSuppressForProjectCapacity` catches and returns `false`).
    expect(
      getCycleRequestsForProject(coreClient as never, PROJECT_ID),
    ).toHaveLength(1);
    expect(coreClient.emitDomainEventOrThrow).toHaveBeenCalledTimes(1);
    // No orphans were reported, so clearCycleDecision stays untouched.
    expect(orchestrationService.clearCycleDecision).not.toHaveBeenCalled();
  });

  it("delegates the cap decision to DispatchService.resolveProjectDispatchCapacity (single source of truth)", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    orchestrationService.findOrchestratingStatesForContinuationCleanup.mockResolvedValue(
      [{ project_id: PROJECT_ID, linked_run_id: null }] as never,
    );

    // Case A: capacity reports `canLaunchNewWork: true` — reconciler
    // must NOT suppress and a wakeup must be emitted.
    const dispatchService = moduleRef.get(DispatchService);
    const capacitySpy = vi.spyOn(
      dispatchService,
      "resolveProjectDispatchCapacity",
    );
    capacitySpy.mockResolvedValueOnce({
      maxActive: 1,
      activeCount: 0,
      availableSlots: 1,
      projectAvailableSlots: 1,
      canLaunchNewWork: true,
    });

    await reconciler.reconcileStaleContinuations();

    expect(capacitySpy).toHaveBeenCalledWith(PROJECT_ID);
    expect(
      getCycleRequestsForProject(coreClient as never, PROJECT_ID),
    ).toHaveLength(1);

    // Case B: same wiring, capacity reports `canLaunchNewWork: false`
    // — reconciler MUST suppress and no wakeup must be emitted. This
    // proves the reconciler delegates the cap decision rather than
    // re-implementing the read site.
    vi.clearAllMocks();
    orchestrationService.findOrchestratingStatesForContinuationCleanup.mockResolvedValue(
      [{ project_id: PROJECT_ID, linked_run_id: null }] as never,
    );
    capacitySpy.mockResolvedValueOnce({
      maxActive: 1,
      activeCount: 1,
      availableSlots: 0,
      projectAvailableSlots: 0,
      canLaunchNewWork: false,
    });

    await reconciler.reconcileStaleContinuations();

    expect(
      getCycleRequestsForProject(coreClient as never, PROJECT_ID),
    ).toHaveLength(0);
    expect(coreClient.emitDomainEventOrThrow).not.toHaveBeenCalled();
  });
});
