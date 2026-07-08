import {
  BadRequestException,
  INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { InternalToolExecutionContext } from "@nexus/core";
import type { WorkItemRecord, WorkItemStatus } from "@nexus/kanban-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestrationDecisionExecutorService } from "../../../orchestration/control-plane/orchestration-decision-executor.service";
import { OrchestrationFactSnapshotService } from "../../../orchestration/control-plane/orchestration-fact-snapshot.service";
import { KanbanSettingRepository } from "../../../database/repositories/kanban-setting.repository";
import { KanbanSettingsService } from "../../../settings/kanban-settings.service";
import { WorkItemService } from "../../../work-item/work-item.service";
import { WorkItemTransitionStatusTool } from "./work-item-transition-status.tool";

/**
 * Cross-component integration test for the work-item transition tool's
 * project WIP-cap enforcement. The tool must read the persisted Kanban
 * setting `work_item_dispatch_max_active_per_project` through the real
 * `KanbanSettingsService` (against an in-memory repository) and surface
 * the resulting capacity metadata on rejection.
 *
 * Mirrors the `orchestration-continuation.integration.spec.ts` /
 * `work-item-qa-decision.integration-spec.ts` style: `Test.createTestingModule`
 * with the production class wired up and the non-kanban collaborators
 * overridden.
 */

interface MockWorkItemService {
  listWorkItems: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
}

interface MockDecisionExecutor {
  executeDirectMutationDecision: ReturnType<typeof vi.fn>;
}

interface MockFactSnapshot {
  publishWorkItemState: ReturnType<typeof vi.fn>;
}

interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeItem(
  id: string,
  projectId: string,
  status: WorkItemStatus,
): WorkItemRecord {
  const now = "2026-06-15T00:00:00.000Z";
  return {
    id,
    project_id: projectId,
    title: `Work item ${id}`,
    description: null,
    status,
    scope: "standard",
    priority: "p2",
    metadata: null,
    linkedRunId: null,
    currentExecutionId: null,
    createdAt: now,
    updatedAt: now,
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

describe("WorkItemTransitionStatusTool WIP cap integration", () => {
  const projectId = "project-wip-cap";
  const candidateId = "candidate-wi";
  const context: InternalToolExecutionContext = { scopeId: projectId };

  let app: INestApplication;
  let tool: WorkItemTransitionStatusTool;
  let settingsService: KanbanSettingsService;
  let settingsStore: Map<string, SettingRow>;
  let workItemsStore: Map<string, WorkItemRecord>;
  let workItems: MockWorkItemService;
  let decisionExecutor: MockDecisionExecutor;
  let factSnapshot: MockFactSnapshot;

  beforeEach(async () => {
    const { repository: settingsRepository, store } =
      createInMemorySettingsRepository();
    settingsStore = store;

    workItemsStore = new Map<string, WorkItemRecord>();

    workItems = {
      listWorkItems: vi.fn((project: string) =>
        Promise.resolve(
          [...workItemsStore.values()].filter(
            (item) => item.project_id === project,
          ),
        ),
      ),
      updateStatus: vi.fn(
        (project: string, id: string, status: WorkItemStatus) => {
          const current = workItemsStore.get(id);
          if (!current || current.project_id !== project) {
            return Promise.reject(
              new Error(`work item ${id} not found in ${project}`),
            );
          }
          const next: WorkItemRecord = { ...current, status };
          workItemsStore.set(id, next);
          return Promise.resolve(next);
        },
      ),
    };

    decisionExecutor = {
      executeDirectMutationDecision: vi.fn(
        async (input: { execute: () => Promise<unknown> }) => input.execute(),
      ),
    };

    factSnapshot = {
      publishWorkItemState: vi.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkItemTransitionStatusTool,
        KanbanSettingsService,
        { provide: KanbanSettingRepository, useValue: settingsRepository },
        {
          provide: WorkItemService,
          useValue: workItems,
        },
        {
          provide: OrchestrationDecisionExecutorService,
          useValue:
            decisionExecutor,
        },
        {
          provide: OrchestrationFactSnapshotService,
          useValue:
            factSnapshot,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    tool = moduleRef.get(WorkItemTransitionStatusTool);
    settingsService = moduleRef.get(KanbanSettingsService);
  });

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });

  function seedActiveItems(
    count: number,
    statuses: readonly WorkItemStatus[] = ["in-progress", "in-progress"],
  ): void {
    const activeStatuses = statuses.slice(0, count);
    for (let index = 0; index < count; index += 1) {
      const id = `active-${index + 1}`;
      const status =
        activeStatuses[index] ?? ("in-progress");
      workItemsStore.set(
        id,
        makeItem(id, projectId, status),
      );
    }
  }

  it("rejects transitions to an active status when the persisted cap is reached", async () => {
    // Cap = 2, with 2 active items already in the project; candidate is in todo.
    await settingsService.set(
      "work_item_dispatch_max_active_per_project",
      2,
    );
    await settingsService.set("work_item_preflight_pipeline_enabled", false);
    seedActiveItems(2);
    workItemsStore.set(
      candidateId,
      makeItem(candidateId, projectId, "todo"),
    );

    let caught: unknown;
    try {
      await tool.execute(context, {
        project_id: projectId,
        workItemId: candidateId,
        status: "in-progress",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const response = (caught as BadRequestException).getResponse() as {
      message: string;
      statusCode: number;
    };
    expect(response.statusCode).toBe(400);
    expect(response.message).toContain(
      "Project WIP limit reached: activeCount=2, maxActive=2, availableSlots=0, reason=project_wip_limit_reached",
    );

    expect(settingsStore.get("work_item_dispatch_max_active_per_project")).toMatchObject({
      value: 2,
    });
    expect(workItems.updateStatus).not.toHaveBeenCalled();
    expect(decisionExecutor.executeDirectMutationDecision).not.toHaveBeenCalled();
    expect(factSnapshot.publishWorkItemState).toHaveBeenCalledWith({
      projectId,
      workItemId: candidateId,
      currentStatus: "todo",
    });
  });

  it("allows the transition once the persisted cap is raised above the active count", async () => {
    // Cap starts at 1 (overridden default), then is raised to 5 — proving the
    // tool reads the live persisted setting rather than caching it.
    await settingsService.set(
      "work_item_dispatch_max_active_per_project",
      1,
    );
    await settingsService.set("work_item_preflight_pipeline_enabled", false);
    seedActiveItems(2);
    workItemsStore.set(
      candidateId,
      makeItem(candidateId, projectId, "todo"),
    );

    // Pre-condition: cap of 1 with 2 active items blocks the transition.
    await expect(
      tool.execute(context, {
        project_id: projectId,
        workItemId: candidateId,
        status: "in-progress",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Raise the cap and retry — the same transition must now succeed and
    // surface the new capacity metadata.
    await settingsService.set(
      "work_item_dispatch_max_active_per_project",
      5,
    );

    await tool.execute(context, {
      project_id: projectId,
      workItemId: candidateId,
      status: "in-progress",
    });

    expect(workItems.updateStatus).toHaveBeenCalledWith(
      projectId,
      candidateId,
      "in-progress",
    );
    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalledTimes(
      1,
    );
    const call = decisionExecutor.executeDirectMutationDecision.mock
      .calls[0][0] as {
      failureMetadata: Record<string, unknown>;
    };
    expect(call.failureMetadata).toMatchObject({
      workItemId: candidateId,
      status: "in-progress",
      activeCount: 2,
      maxActive: 5,
      availableSlots: 3,
    });
  });

  it("permits the transition with availableSlots=1 when project state is one below the cap", async () => {
    // Cap = 4, project state at 3 active items, candidate in todo — exactly
    // one slot remains, and the transition must succeed.
    await settingsService.set(
      "work_item_dispatch_max_active_per_project",
      4,
    );
    await settingsService.set("work_item_preflight_pipeline_enabled", false);
    seedActiveItems(3, ["in-progress", "in-review", "ready-to-merge"]);
    workItemsStore.set(
      candidateId,
      makeItem(candidateId, projectId, "todo"),
    );

    await tool.execute(context, {
      project_id: projectId,
      workItemId: candidateId,
      status: "in-progress",
    });

    expect(workItems.updateStatus).toHaveBeenCalledWith(
      projectId,
      candidateId,
      "in-progress",
    );
    expect(decisionExecutor.executeDirectMutationDecision).toHaveBeenCalledTimes(
      1,
    );
    const call = decisionExecutor.executeDirectMutationDecision.mock
      .calls[0][0] as {
      failureMetadata: Record<string, unknown>;
    };
    expect(call.failureMetadata).toMatchObject({
      workItemId: candidateId,
      status: "in-progress",
      activeCount: 3,
      maxActive: 4,
      availableSlots: 1,
    });
    expect(workItemsStore.get(candidateId)?.status).toBe("in-progress");
  });
});