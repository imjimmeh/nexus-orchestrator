import { Test, type TestingModule } from "@nestjs/testing";
import {
  BaseRequestContextService,
  type WorkflowRunAcceptedV1,
  type WorkflowRunRequestV1,
  type WorkflowRunStatusV1,
} from "@nexus/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { CoreWorkflowClientService } from "../../src/core/core-workflow-client.service";
import { KanbanProjectRepository } from "../../src/database/repositories/kanban-project.repository";
import { KanbanSettingRepository } from "../../src/database/repositories/kanban-setting.repository";
import { KanbanWorkItemRepository } from "../../src/database/repositories/kanban-work-item.repository";
import { DispatchService } from "../../src/dispatch/dispatch.service";
import { ProjectService } from "../../src/project/project.service";
import { KanbanSettingsService } from "../../src/settings/kanban-settings.service";
import { WorkItemService } from "../../src/work-item/work-item.service";

const MAX_ACTIVE_KEY = "work_item_dispatch_max_active_per_project";
const PROJECT_ID = "p1";
const WORKFLOW_ID = "implement-work-item";
const NOW = "2026-06-01T00:00:00.000Z";
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
  [key: string]: unknown;
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
    created_at: new Date(NOW),
    updated_at: new Date(NOW),
    ...overrides,
  };
}

function createInMemorySettingRepository(): KanbanSettingRepository {
  const rows = new Map<
    string,
    { value: unknown; description: string | null; createdAt: Date }
  >();
  const now = () => new Date(NOW);
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

  findByIds(workItemIds: string[]): Promise<WorkItemFixture[]> {
    return Promise.resolve(
      workItemIds
        .map((id) => this.items.get(id))
        .filter((item): item is WorkItemFixture => item !== undefined),
    );
  }

  findDependenciesByWorkItemIds(
    _workItemIds: string[],
  ): Promise<Array<{ work_item_id: string; depends_on_work_item_id: string }>> {
    return Promise.resolve([]);
  }

  save(input: Partial<WorkItemFixture>): Promise<WorkItemFixture> {
    if (typeof input.id !== "string") throw new Error("save() requires an id");
    const existing = this.items.get(input.id);
    const merged: WorkItemFixture = {
      ...(existing ?? makeWorkItem({ id: input.id })),
      ...input,
      id: input.id,
      updated_at: new Date(NOW),
    };
    this.items.set(input.id, merged);
    return Promise.resolve(merged);
  }

  linkRunIfUnlinked(params: {
    project_id: string;
    workItemId: string;
    runId: string;
  }): Promise<boolean> {
    const item = this.items.get(params.workItemId);
    if (!item || item.project_id !== params.project_id)
      return Promise.resolve(false);
    if (item.linked_run_id !== null || item.current_execution_id !== null)
      return Promise.resolve(false);
    this.items.set(params.workItemId, {
      ...item,
      linked_run_id: params.runId,
      current_execution_id: params.runId,
    });
    return Promise.resolve(true);
  }

  clearRunLinksIfMatches(
    project_id: string,
    workItemId: string,
    runId: string,
    lastExecutionStatus: string,
  ): Promise<boolean> {
    const item = this.items.get(workItemId);
    if (!item || item.project_id !== project_id) return Promise.resolve(false);
    if (item.linked_run_id !== runId) return Promise.resolve(false);
    if (
      item.current_execution_id !== null &&
      item.current_execution_id !== runId
    )
      return Promise.resolve(false);
    this.items.set(workItemId, {
      ...item,
      linked_run_id: null,
      current_execution_id: null,
      last_execution_status: lastExecutionStatus,
    });
    return Promise.resolve(true);
  }
}

describe("WIP cap DispatchService integration (AC-3)", () => {
  let moduleRef: TestingModule;
  let dispatchService: DispatchService;
  let settingsService: KanbanSettingsService;
  let workItemRepo: InMemoryWorkItemRepository;
  let requestWorkflowRun: Mock<
    (request: WorkflowRunRequestV1) => Promise<WorkflowRunAcceptedV1>
  >;
  let updateWorkItemStatus: Mock<
    (project_id: string, workItemId: string, status: string) => Promise<unknown>
  >;
  // Reset env vars read by `resolveKanbanExternalMcpMounts` so the run
  // requests remain deterministic across test runs.
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      process.env[key] = "";
    }

    const repository = createInMemorySettingRepository();
    settingsService = new KanbanSettingsService(repository);
    await settingsService.seedDefaults();
    workItemRepo = new InMemoryWorkItemRepository();
    requestWorkflowRun = vi.fn(
      (request: WorkflowRunRequestV1): Promise<WorkflowRunAcceptedV1> => {
        const workItemId =
          (request.input["workItemId"] as string | undefined) ??
          (request.input["contextId"] as string | undefined) ??
          "unknown";
        return Promise.resolve({
          run_id: `run-${workItemId}`,
          workflow_id: request.workflow_id,
          status: "accepted",
          accepted_at: NOW,
          metadata: { correlation_id: "corr-test" },
        });
      },
    );
    updateWorkItemStatus = vi.fn(
      (
        _project_id: string,
        _workItemId: string,
        _status: string,
      ): Promise<unknown> => Promise.resolve(undefined),
    );
    const getWorkflowRunStatus: Mock<
      (runId: string, correlationId: string) => Promise<WorkflowRunStatusV1>
    > = vi.fn(
      (runId: string): Promise<WorkflowRunStatusV1> =>
        Promise.resolve({
          run_id: runId,
          workflow_id: WORKFLOW_ID,
          status: "RUNNING",
          current_step_id: null,
          updated_at: NOW,
          metadata: { correlation_id: "corr-test" },
        }),
    );
    const projectGet: Mock<(project_id: string) => Promise<unknown>> = vi.fn(
      (_project_id: string): Promise<unknown> => Promise.resolve(null),
    );

    moduleRef = await Test.createTestingModule({
      providers: [
        // SUT — real DispatchService wired with the real KanbanSettingsService
        // singleton so the cap read sites (`this.kanbanSettings.getNumber` /
        // `getBoolean`) are the same path production uses.
        DispatchService,
        { provide: KanbanSettingsService, useValue: settingsService },
        { provide: KanbanSettingRepository, useValue: repository },
        {
          provide: KanbanWorkItemRepository,
          useValue: workItemRepo,
        },
        // WorkItemService is a peer service used by the dispatch core for
        // refinement / orphan / provision-failure recovery. The core only
        // calls `updateStatus`; stub it so any accidental call surfaces.
        {
          provide: WorkItemService,
          useValue: { updateStatus: updateWorkItemStatus },
        },
        // ProjectService is only used by `requestOrchestrationCycle`, which
        // tolerates a null project (falls through to null basePath/url).
        { provide: ProjectService, useValue: { get: projectGet } },
        // KanbanProjectRepository is only consulted for the dispatched
        // project's `runtime_toolchains` launch input (Task 16); a
        // null-returning stub keeps this suite's assertions unaffected.
        {
          provide: KanbanProjectRepository,
          useValue: { findById: vi.fn(() => Promise.resolve(null)) },
        },
        // Core workflow client + request context are external HTTP
        // collaborators — stub the methods the dispatch core touches.
        {
          provide: CoreWorkflowClientService,
          useValue: {
            requestWorkflowRun,
            getWorkflowRunStatus,
            emitDomainEventOrThrow: vi.fn(() => Promise.resolve()),
          },
        },
        {
          provide: BaseRequestContextService,
          useValue: {
            getRequestId: () => "corr-test",
            getCausationId: () => "cause-test",
          },
        },
      ],
    }).compile();

    dispatchService = moduleRef.get(DispatchService);
  });

  afterEach(async () => {
    await moduleRef?.close();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) process.env[key] = undefined;
      else process.env[key] = savedEnv[key];
    }
    vi.clearAllMocks();
  });

  it("resolveProjectDispatchCapacity returns the live snapshot from settings + work items", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 2);
    workItemRepo.seed(
      makeWorkItem({
        id: "wi-active",
        status: "in-progress",
        linked_run_id: "run-active",
      }),
    );

    const capacity =
      await dispatchService.resolveProjectDispatchCapacity(PROJECT_ID);

    expect(capacity).toEqual({
      maxActive: 2,
      activeCount: 1,
      availableSlots: 1,
      projectAvailableSlots: 1,
      canLaunchNewWork: true,
    });
  });

  it("resolveProjectDispatchCapacity reflects a settings write without re-initialisation", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 2);
    workItemRepo.seed(
      makeWorkItem({
        id: "wi-active",
        status: "in-progress",
        linked_run_id: "run-active",
      }),
    );

    const initial =
      await dispatchService.resolveProjectDispatchCapacity(PROJECT_ID);
    expect(initial.maxActive).toBe(2);

    // Same shared service instance — no module re-init. The cap is read
    // live, so a smaller value must shrink the budget.
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    const updated =
      await dispatchService.resolveProjectDispatchCapacity(PROJECT_ID);
    expect(updated.maxActive).toBe(1);
    expect(updated.activeCount).toBe(1);
    expect(updated.availableSlots).toBe(0);
    expect(updated.canLaunchNewWork).toBe(false);
  });

  it("dispatchReadyWorkItems skips at capacity with reason project_wip_limit_reached", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    workItemRepo.seed(
      makeWorkItem({
        id: "wi-active",
        status: "in-progress",
        linked_run_id: "run-active",
      }),
    );
    workItemRepo.seed(makeWorkItem({ id: "wi-2", status: "todo" }));
    workItemRepo.seed(makeWorkItem({ id: "wi-3", status: "todo" }));

    const result = await dispatchService.dispatchReadyWorkItems({
      project_id: PROJECT_ID,
      workflowId: WORKFLOW_ID,
    });

    // The already-linked in-progress item is recorded as an idempotent
    // dispatch (it is *not* a fresh launch — it just reports its
    // current linked run). The cap-bound ready items are the ones that
    // actually get rejected.
    expect(result.dispatched).toEqual([
      expect.objectContaining({ workItemId: "wi-active", idempotent: true }),
    ]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workItemId: "wi-2",
          reason: "project_wip_limit_reached",
        }),
        expect.objectContaining({
          workItemId: "wi-3",
          reason: "project_wip_limit_reached",
        }),
      ]),
    );
    expect(requestWorkflowRun).not.toHaveBeenCalled();
    // The cap fires before any refinement / orphan / provision-failure
    // recovery — the work-item service must not be touched.
    expect(updateWorkItemStatus).not.toHaveBeenCalled();
  });

  it("dispatchSelectedWorkItems skips at capacity with reason project_wip_limit_reached", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    workItemRepo.seed(
      makeWorkItem({
        id: "wi-active",
        status: "in-progress",
        linked_run_id: "run-active",
      }),
    );
    workItemRepo.seed(makeWorkItem({ id: "wi-2", status: "todo" }));
    workItemRepo.seed(makeWorkItem({ id: "wi-3", status: "todo" }));

    const result = await dispatchService.dispatchSelectedWorkItems({
      projectId: PROJECT_ID,
      workItemIds: ["wi-2", "wi-3"],
      workflowId: WORKFLOW_ID,
    });

    // Selected mode never observes the out-of-scope active item, so the
    // dispatched array is empty (no idempotent entries for unrelated items).
    expect(result.dispatched).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workItemId: "wi-2",
          reason: "project_wip_limit_reached",
        }),
        expect.objectContaining({
          workItemId: "wi-3",
          reason: "project_wip_limit_reached",
        }),
      ]),
    );
    expect(requestWorkflowRun).not.toHaveBeenCalled();
    expect(updateWorkItemStatus).not.toHaveBeenCalled();
  });

  it("at capacity, dispatchSelectedWorkItems skips the one launchable item — cap is 1 = 1 active + 0 launches", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    workItemRepo.seed(
      makeWorkItem({
        id: "wi-active",
        status: "in-progress",
        linked_run_id: "run-active",
      }),
    );
    workItemRepo.seed(makeWorkItem({ id: "wi-2", status: "todo" }));

    const result = await dispatchService.dispatchSelectedWorkItems({
      projectId: PROJECT_ID,
      workItemIds: ["wi-2"],
      workflowId: WORKFLOW_ID,
    });

    // Cap is 1 active in-progress → availableSlots = 0 → the selected
    // ready item cannot be launched even though it is the only candidate.
    expect(result.dispatched).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        workItemId: "wi-2",
        reason: "project_wip_limit_reached",
      }),
    ]);
    expect(requestWorkflowRun).not.toHaveBeenCalled();
  });

  it("below capacity, dispatchReadyWorkItems launches the expected count and skips the rest with project_wip_limit_reached", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 3);
    for (const id of ["wi-1", "wi-2", "wi-3", "wi-4", "wi-5"]) {
      workItemRepo.seed(makeWorkItem({ id, status: "todo" }));
    }

    const result = await dispatchService.dispatchReadyWorkItems({
      project_id: PROJECT_ID,
      workflowId: WORKFLOW_ID,
    });

    expect(result.dispatched).toHaveLength(3);
    expect(result.dispatched.map((entry) => entry.workItemId)).toEqual([
      "wi-1",
      "wi-2",
      "wi-3",
    ]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workItemId: "wi-4",
          reason: "project_wip_limit_reached",
        }),
        expect.objectContaining({
          workItemId: "wi-5",
          reason: "project_wip_limit_reached",
        }),
      ]),
    );
    // Three launch requests fired; the 4th and 5th were rejected before
    // requestWorkflowRun.
    expect(requestWorkflowRun).toHaveBeenCalledTimes(3);
  });

  it("done items do not count as active — the cap is unaffected by a terminal item", async () => {
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    // A `done` item with a stale run link must not consume a dispatch
    // slot — the terminal-status override wins.
    workItemRepo.seed(
      makeWorkItem({
        id: "wi-done",
        status: "done",
        linked_run_id: "run-stale",
        current_execution_id: "run-stale",
      }),
    );
    workItemRepo.seed(makeWorkItem({ id: "wi-ready", status: "todo" }));

    const capacity =
      await dispatchService.resolveProjectDispatchCapacity(PROJECT_ID);
    expect(capacity).toEqual({
      maxActive: 1,
      activeCount: 0,
      availableSlots: 1,
      projectAvailableSlots: 1,
      canLaunchNewWork: true,
    });

    const result = await dispatchService.dispatchReadyWorkItems({
      project_id: PROJECT_ID,
      workflowId: WORKFLOW_ID,
    });

    // The done item is reported as an idempotent dispatch (it has a
    // linked run, so the dispatch loop records it for visibility) but
    // it does NOT count as active. The ready item is launched.
    expect(result.dispatched).toHaveLength(2);
    expect(result.dispatched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workItemId: "wi-done", idempotent: true }),
        expect.objectContaining({ workItemId: "wi-ready", idempotent: false }),
      ]),
    );
    expect(result.skipped).toEqual([]);
    expect(requestWorkflowRun).toHaveBeenCalledTimes(1);
  });
});
