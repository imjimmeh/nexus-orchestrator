/**
 * Cross-component integration test for `DispatchService` project WIP-cap
 * enforcement.
 *
 * Covers AC-3 + AC-4 (partial) for the Project WIP Cap work item
 * (`6d9d9031-ed15-4340-b79b-5d200ff0fed2`):
 *   1. `dispatchReadyWorkItems` honors the persisted cap.
 *   2. `dispatchReadyWorkItems` dispatches when below the persisted cap.
 *   3. `dispatchSelectedWorkItems` honors the persisted cap.
 *   4. `dispatchSelectedWorkItems` reads the persisted cap live — raising
 *      the persisted setting at runtime immediately flips the dispatch
 *      outcome for previously-skipped items.
 *
 * Wiring strategy mirrors the in-memory settings repository pattern
 * already established in
 * `apps/kanban/src/mcp/tools/mutation/work-item-transition-status.integration.spec.ts`
 * and
 * `apps/kanban/src/orchestration/orchestration-continuation-reconciler.integration.spec.ts`:
 *   - Real `DispatchService` and real `KanbanSettingsService` constructed
 *     via `Test.createTestingModule`.
 *   - `KanbanSettingRepository` overridden with a `Map`-backed in-memory
 *     repository so `seedDefaults()` + `set(...)` mutate the same store
 *     the dispatch path reads from.
 *   - Remaining dispatch collaborators (`CoreWorkflowClientService`,
 *     `BaseRequestContextService`, `WorkItemService`, `ProjectService`,
 *     `KanbanWorkItemRepository`) stubbed with the minimum surface needed
 *     to drive `dispatchReadyWorkItems` / `dispatchSelectedWorkItems`.
 *   - Capacity math is delegated to the real
 *     `resolveProjectDispatchCapacity` helper through the under-test
 *     `DispatchService.resolveProjectDispatchCapacity` — never
 *     reimplemented.
 */

import {
  INestApplication,
  Logger,
  type Provider,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  BaseRequestContextService,
  type WorkflowRunAcceptedV1,
  type WorkflowRunStatusV1,
} from "@nexus/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import { KanbanSettingRepository } from "../database/repositories/kanban-setting.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { ProjectService } from "../project/project.service";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import { WorkItemService } from "../work-item/work-item.service";
import { DispatchService } from "./dispatch.service";
import type { WorkItemRecord } from "./dispatch-internal.types";

interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkItemSeed {
  id: string;
  project_id: string;
  status:
    | "backlog"
    | "todo"
    | "in-progress"
    | "in-review"
    | "ready-to-merge"
    | "blocked"
    | "done"
    | "refinement";
  linked_run_id?: string | null;
  current_execution_id?: string | null;
  assigned_agent_id?: string | null;
}

interface FakeRunLinker {
  linkRunIfUnlinked: ReturnType<typeof vi.fn>;
}

interface FakeWorkItemsRepo extends FakeRunLinker {
  findByproject_id: ReturnType<typeof vi.fn>;
  findByIds: ReturnType<typeof vi.fn>;
  findDependenciesByWorkItemIds: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  clearRunLinksIfMatches: ReturnType<typeof vi.fn>;
}

interface FakeCoreClient {
  requestWorkflowRun: ReturnType<typeof vi.fn>;
  getWorkflowRunStatus: ReturnType<typeof vi.fn>;
  emitDomainEventOrThrow: ReturnType<typeof vi.fn>;
}

interface FakeRequestContext {
  getRequestId: ReturnType<typeof vi.fn>;
  getCausationId: ReturnType<typeof vi.fn>;
}

interface FakeWorkItemService {
  updateStatus: ReturnType<typeof vi.fn>;
}

interface FakeProjectService {
  get: ReturnType<typeof vi.fn>;
}

interface WiringHarness {
  settingsRepository: KanbanSettingRepository;
  settingsStore: Map<string, SettingRow>;
  workItemsStore: Map<string, WorkItemRecord>;
  workItemsRepo: FakeWorkItemsRepo;
  coreClient: FakeCoreClient;
  requestContext: FakeRequestContext;
  workItemService: FakeWorkItemService;
  projectService: FakeProjectService;
  projectRepository: KanbanProjectRepository;
}

function makeWorkItemRecord(seed: WorkItemSeed): WorkItemRecord {
  const now = new Date("2026-07-01T00:00:00.000Z");
  return {
    id: seed.id,
    project_id: seed.project_id,
    title: `Work item ${seed.id}`,
    status: seed.status,
    priority: "p2",
    assigned_agent_id: seed.assigned_agent_id ?? null,
    linked_run_id: seed.linked_run_id ?? null,
    current_execution_id: seed.current_execution_id ?? null,
    execution_config: null,
    metadata: null,
    description: null,
    scope: "standard",
    token_spend: 0,
    cost_cents: 0,
    waiting_for_input: false,
    initiative_id: null,
    last_execution_status: null,
    created_at: now,
    updated_at: now,
  };
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
    findByKey: vi.fn((key: string) =>
      Promise.resolve(store.get(key) ?? null),
    ),
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

function acceptedRunFor(workItemId: string): WorkflowRunAcceptedV1 {
  return {
    run_id: `run-${workItemId}`,
    workflow_id: "implement-work-item",
    status: "accepted",
    accepted_at: "2026-07-01T00:00:00.000Z",
    metadata: { correlation_id: "corr-wip-cap" },
  };
}

function runningRunStatus(runId: string): WorkflowRunStatusV1 {
  return {
    run_id: runId,
    workflow_id: "implement-work-item",
    status: "RUNNING",
    updated_at: "2026-07-01T00:00:00.000Z",
    metadata: { correlation_id: "corr-wip-cap" },
  };
}

function buildWiring(): WiringHarness {
  const { repository: settingsRepository, store: settingsStore } =
    createInMemorySettingsRepository();
  const workItemsStore = new Map<string, WorkItemRecord>();

  const workItemsRepo: FakeWorkItemsRepo = {
    findByproject_id: vi.fn((project_id: string) => {
      const items = [...workItemsStore.values()].filter(
        (item) => item.project_id === project_id,
      );
      return Promise.resolve(items);
    }),
    findByIds: vi.fn((workItemIds: string[]) => {
      const items = workItemIds
        .map((id) => workItemsStore.get(id))
        .filter((item): item is WorkItemRecord => item !== undefined);
      return Promise.resolve(items);
    }),
    findDependenciesByWorkItemIds: vi.fn(() => Promise.resolve([])),
    linkRunIfUnlinked: vi.fn(
      (params: { project_id: string; workItemId: string; runId: string }) => {
        const item = workItemsStore.get(params.workItemId);
        if (!item || item.project_id !== params.project_id) {
          return Promise.resolve(false);
        }
        if (
          item.linked_run_id !== null ||
          item.current_execution_id !== null
        ) {
          return Promise.resolve(false);
        }
        workItemsStore.set(params.workItemId, {
          ...item,
          linked_run_id: params.runId,
          current_execution_id: params.runId,
        });
        return Promise.resolve(true);
      },
    ),
    save: vi.fn((input: Partial<WorkItemRecord>) => {
      const id = input.id;
      if (typeof id !== "string") {
        return Promise.reject(new Error("save requires item id"));
      }
      const existing = workItemsStore.get(id);
      const next: WorkItemRecord = {
        ...(existing ?? makeWorkItemRecord({
          id,
          project_id: input.project_id ?? "unknown",
          status: "todo",
        })),
        ...input,
        updated_at: new Date("2026-07-01T00:00:00.000Z"),
      };
      workItemsStore.set(id, next);
      return Promise.resolve(next as never);
    }),
    clearRunLinksIfMatches: vi.fn(
      (
        project_id: string,
        workItemId: string,
        runId: string,
      ) => {
        const item = workItemsStore.get(workItemId);
        if (!item || item.project_id !== project_id) {
          return Promise.resolve(false);
        }
        if (
          item.linked_run_id !== runId ||
          (item.current_execution_id !== null &&
            item.current_execution_id !== runId)
        ) {
          return Promise.resolve(false);
        }
        workItemsStore.set(workItemId, {
          ...item,
          linked_run_id: null,
          current_execution_id: null,
        });
        return Promise.resolve(true);
      },
    ),
  };

  const coreClient: FakeCoreClient = {
    requestWorkflowRun: vi.fn((request: unknown) => {
      const workItemId = extractWorkItemIdFromRequest(request);
      return Promise.resolve(acceptedRunFor(workItemId ?? "unknown"));
    }),
    getWorkflowRunStatus: vi.fn((runId: string) =>
      Promise.resolve(runningRunStatus(runId)),
    ),
    emitDomainEventOrThrow: vi.fn().mockResolvedValue(undefined),
  };

  const requestContext: FakeRequestContext = {
    getRequestId: vi.fn(() => "corr-wip-cap"),
    getCausationId: vi.fn(() => "cause-wip-cap"),
  };

  const workItemService: FakeWorkItemService = {
    updateStatus: vi.fn(
      (project_id: string, workItemId: string, status: string) => {
        const item = workItemsStore.get(workItemId);
        if (!item || item.project_id !== project_id) {
          return Promise.reject(
            new Error(`work item ${workItemId} not found in ${project_id}`),
          );
        }
        const next: WorkItemRecord = {
          ...item,
          status: status,
        };
        workItemsStore.set(workItemId, next);
        return Promise.resolve(next);
      },
    ),
  };

  const projectService: FakeProjectService = {
    get: vi.fn().mockResolvedValue(null),
  };

  const projectRepository = {
    findById: vi.fn().mockResolvedValue(null),
  } as unknown as KanbanProjectRepository;

  return {
    settingsRepository,
    settingsStore,
    workItemsStore,
    workItemsRepo,
    coreClient,
    requestContext,
    workItemService,
    projectService,
    projectRepository,
  };
}

/**
 * The dispatch funnel passes a fully-typed `WorkflowRunRequestV1` to
 * `requestWorkflowRun`; we only need the `workItemId` back so the fake can
 * synthesize an accepted run id. Parsing loose `unknown` here keeps the
 * test surface free of the full request schema — the strong-typed
 * guarantee is held by the production code path.
 */
function extractWorkItemIdFromRequest(request: unknown): string | null {
  if (typeof request !== "object" || request === null) return null;
  const input = (request as { input?: unknown }).input;
  if (typeof input !== "object" || input === null) return null;
  const workItemId = (input as { workItemId?: unknown }).workItemId;
  if (typeof workItemId !== "string") return null;
  return workItemId;
}

function dispatchReadyProviders(
  wiring: WiringHarness,
): Provider[] {
  return [
    DispatchService,
    KanbanSettingsService,
    { provide: KanbanSettingRepository, useValue: wiring.settingsRepository },
    { provide: KanbanProjectRepository, useValue: wiring.projectRepository },
    {
      provide: CoreWorkflowClientService,
      useValue: wiring.coreClient,
    },
    {
      provide: BaseRequestContextService,
      useValue: wiring.requestContext,
    },
    {
      provide: KanbanWorkItemRepository,
      useValue: wiring.workItemsRepo,
    },
    { provide: WorkItemService, useValue: wiring.workItemService },
    { provide: ProjectService, useValue: wiring.projectService },
  ];
}

describe("DispatchService WIP cap integration", () => {
  let app: INestApplication;
  let service: DispatchService;
  let kanbanSettings: KanbanSettingsService;
  let wiring: WiringHarness;

  const projectId = "project-wip-cap";

  beforeEach(async () => {
    // The dispatch-log noise on `Logger.warn` from reconciliation paths is
    // expected noise — silence it for cleaner test output.
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    wiring = buildWiring();

    const moduleRef = await Test.createTestingModule({
      providers: dispatchReadyProviders(wiring),
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    service = moduleRef.get(DispatchService);
    kanbanSettings = moduleRef.get(KanbanSettingsService);
  });

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  function seedProjectItems(seeds: readonly WorkItemSeed[]): void {
    for (const seed of seeds) {
      wiring.workItemsStore.set(
        seed.id,
        makeWorkItemRecord({ ...seed, project_id: seed.project_id ?? projectId }),
      );
    }
  }

  it("dispatchReadyWorkItems honors the persisted cap with project_wip_limit_reached skips", async () => {
    // Cap = 2 (set via the real KanbanSettingsService backed by the
    // in-memory repository). The project already has 2 active items
    // (in-review, no run links so the reconciliation path is a no-op) and
    // 2 ready todo items — both todo items must be skipped without any
    // dispatch attempt.
    await kanbanSettings.set(
      "work_item_dispatch_max_active_per_project",
      2,
    );
    seedProjectItems([
      { id: "active-1", project_id: projectId, status: "in-review" },
      { id: "active-2", project_id: projectId, status: "in-review" },
      { id: "ready-todo-1", project_id: projectId, status: "todo" },
      { id: "ready-todo-2", project_id: projectId, status: "todo" },
    ]);

    const result = await service.dispatchReadyWorkItems({
      project_id: projectId,
      workflowId: "implement-work-item",
    });

    expect(result.dispatched).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workItemId: "ready-todo-1",
          reason: "project_wip_limit_reached",
        }),
        expect.objectContaining({
          workItemId: "ready-todo-2",
          reason: "project_wip_limit_reached",
        }),
      ]),
    );
    expect(wiring.coreClient.requestWorkflowRun).not.toHaveBeenCalled();
    expect(
      wiring.settingsStore.get(
        "work_item_dispatch_max_active_per_project",
      ),
    ).toMatchObject({ value: 2 });

    // The dispatch path consulted the real `KanbanSettingsService` (not a
    // stub) — verify capacity resolution through the public surface.
    const capacity = await service.resolveProjectDispatchCapacity(projectId);
    expect(capacity).toEqual({
      maxActive: 2,
      activeCount: 2,
      availableSlots: 0,
      projectAvailableSlots: 0,
      canLaunchNewWork: false,
    });
  });

  it("dispatchReadyWorkItems dispatches below the persisted cap with no project_wip_limit_reached skips", async () => {
    // Cap = 5 (set via the real KanbanSettingsService backed by the
    // in-memory repository). The project has 2 active items and 1 ready
    // todo — the ready item must dispatch and no skip should carry the
    // `project_wip_limit_reached` reason.
    await kanbanSettings.set(
      "work_item_dispatch_max_active_per_project",
      5,
    );
    seedProjectItems([
      { id: "active-1", project_id: projectId, status: "in-review" },
      { id: "active-2", project_id: projectId, status: "in-review" },
      { id: "ready-todo-1", project_id: projectId, status: "todo" },
    ]);

    const result = await service.dispatchReadyWorkItems({
      project_id: projectId,
      workflowId: "implement-work-item",
    });

    expect(result.dispatched).toEqual([
      expect.objectContaining({
        workItemId: "ready-todo-1",
        runId: "run-ready-todo-1",
        linkedRunId: "run-ready-todo-1",
        status: "in-progress",
        idempotent: false,
        mutationConfirmed: true,
      }),
    ]);
    expect(result.skipped).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "project_wip_limit_reached",
        }),
      ]),
    );
    expect(wiring.coreClient.requestWorkflowRun).toHaveBeenCalledTimes(1);
    expect(
      wiring.workItemsStore.get("ready-todo-1")?.linked_run_id,
    ).toBe("run-ready-todo-1");
    expect(
      wiring.settingsStore.get(
        "work_item_dispatch_max_active_per_project",
      ),
    ).toMatchObject({ value: 5 });
  });

  it("dispatchSelectedWorkItems honors the persisted cap with project_wip_limit_reached skips", async () => {
    // Cap = 2 (set via the real KanbanSettingsService). The project has 2
    // active in-review items and 2 ready todo items; both requested ids
    // must be skipped with the WIP limit reason and no launch must fire.
    await kanbanSettings.set(
      "work_item_dispatch_max_active_per_project",
      2,
    );
    seedProjectItems([
      { id: "active-1", project_id: projectId, status: "in-review" },
      { id: "active-2", project_id: projectId, status: "in-review" },
      { id: "selected-1", project_id: projectId, status: "todo" },
      { id: "selected-2", project_id: projectId, status: "todo" },
    ]);

    const result = await service.dispatchSelectedWorkItems({
      projectId,
      workItemIds: ["selected-1", "selected-2"],
      workflowId: "implement-work-item",
    });

    expect(result.dispatched).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        workItemId: "selected-1",
        reason: "project_wip_limit_reached",
      }),
      expect.objectContaining({
        workItemId: "selected-2",
        reason: "project_wip_limit_reached",
      }),
    ]);
    expect(wiring.coreClient.requestWorkflowRun).not.toHaveBeenCalled();
    expect(
      wiring.settingsStore.get(
        "work_item_dispatch_max_active_per_project",
      ),
    ).toMatchObject({ value: 2 });
  });

  it("dispatchSelectedWorkItems reads the persisted cap live — raising the cap flips suppression off", async () => {
    // Cap = 2 initially (suppresses), project already at capacity (2 active
    // items). The first selected dispatch must skip with
    // `project_wip_limit_reached`. After raising the persisted cap to 5
    // through the real `KanbanSettingsService`, the same selected dispatch
    // must successfully launch — proving the dispatch path reads the
    // live persisted setting rather than a cached value from app start.
    await kanbanSettings.set(
      "work_item_dispatch_max_active_per_project",
      2,
    );
    seedProjectItems([
      { id: "active-1", project_id: projectId, status: "in-review" },
      { id: "active-2", project_id: projectId, status: "in-review" },
      { id: "live-selected", project_id: projectId, status: "todo" },
    ]);

    const suppressedResult = await service.dispatchSelectedWorkItems({
      projectId,
      workItemIds: ["live-selected"],
      workflowId: "implement-work-item",
    });

    expect(suppressedResult.dispatched).toEqual([]);
    expect(suppressedResult.skipped).toEqual([
      expect.objectContaining({
        workItemId: "live-selected",
        reason: "project_wip_limit_reached",
      }),
    ]);
    expect(wiring.coreClient.requestWorkflowRun).not.toHaveBeenCalled();
    expect(
      wiring.settingsStore.get(
        "work_item_dispatch_max_active_per_project",
      ),
    ).toMatchObject({ value: 2 });

    // Raise the persisted cap through the real service so the in-memory
    // repository now exposes a wider budget.
    await kanbanSettings.set(
      "work_item_dispatch_max_active_per_project",
      5,
    );

    const allowedResult = await service.dispatchSelectedWorkItems({
      projectId,
      workItemIds: ["live-selected"],
      workflowId: "implement-work-item",
    });

    expect(allowedResult.dispatched).toEqual([
      expect.objectContaining({
        workItemId: "live-selected",
        runId: "run-live-selected",
        linkedRunId: "run-live-selected",
        status: "in-progress",
        idempotent: false,
        mutationConfirmed: true,
      }),
    ]);
    expect(allowedResult.skipped).toEqual([]);
    expect(wiring.coreClient.requestWorkflowRun).toHaveBeenCalledTimes(1);
    expect(
      wiring.settingsStore.get(
        "work_item_dispatch_max_active_per_project",
      ),
    ).toMatchObject({ value: 5 });
    expect(wiring.workItemsStore.get("live-selected")?.linked_run_id).toBe(
      "run-live-selected",
    );
  });
});
