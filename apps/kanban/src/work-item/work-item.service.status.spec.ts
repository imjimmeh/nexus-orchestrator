import { BadRequestException } from "@nestjs/common";
import type { BaseRequestContextService } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FailVisibleLifecycleEventDeliveryError } from "./kanban-lifecycle-event-publisher";
import { WorkItemService } from "./work-item.service";
import type { WorkItemRecord, WorkItemStatus } from "./work-item.types";

type EmitStatusChangedParams = {
  projectId: string;
  workItemId: string;
  status: string;
  previousStatus: string | null;
  actor: string;
  updatedAt: string;
  resource: WorkItemRecord;
};

type WorkItemEntity = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  scope: "standard" | "large";
  assigned_agent_id: string | null;
  token_spend: number;
  current_execution_id: string | null;
  waiting_for_input: boolean;
  execution_config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  linked_run_id: string | null;
  created_at: Date;
  updated_at: Date;
};

describe("WorkItemService status updates", () => {
  let service: WorkItemService;
  let projectsMock: { findById: ReturnType<typeof vi.fn> };
  const items = new Map<string, WorkItemEntity>();
  const workItemRepository = {
    save: vi.fn((input: WorkItemEntity) => {
      const updated = {
        ...input,
        updated_at: new Date("2026-04-15T00:10:00.000Z"),
      };
      items.set(`${updated.project_id}:${updated.id}`, updated);
      return Promise.resolve(updated);
    }),
    findByProjectAndId: vi.fn((projectId: string, workItemId: string) =>
      Promise.resolve(items.get(`${projectId}:${workItemId}`) ?? null),
    ),
    findDependenciesByWorkItemIds: vi.fn(() => Promise.resolve([])),
    findSubtasksByWorkItemIds: vi.fn(() => Promise.resolve([])),
    linkRunIfUnlinked: vi.fn(
      (params: { project_id: string; workItemId: string; runId: string }) => {
        const key = `${params.project_id}:${params.workItemId}`;
        const existing = items.get(key);
        if (!existing) return Promise.resolve(false);
        if (
          existing.linked_run_id !== null ||
          existing.current_execution_id !== null
        ) {
          return Promise.resolve(false);
        }
        existing.linked_run_id = params.runId;
        existing.current_execution_id = params.runId;
        items.set(key, existing);
        return Promise.resolve(true);
      },
    ),
    findByProjectAndIdForUpdate: vi.fn(
      (project_id: string, workItemId: string) =>
        Promise.resolve(items.get(`${project_id}:${workItemId}`) ?? null),
    ),
  };
  const lifecycleEventPublisherMock: {
    emitStatusChanged: ReturnType<
      typeof vi.fn<(params: EmitStatusChangedParams) => Promise<void>>
    >;
  } = {
    emitStatusChanged: vi.fn(() => Promise.resolve()),
  };

  const runLeaseServiceMock = {
    acquireRunLease: vi.fn(() =>
      Promise.resolve({
        acquired: true as const,
        leaseIds: ["lease-status"],
      }),
    ),
    releaseRunLease: vi.fn(() => Promise.resolve(undefined)),
    deriveOwnerId: vi.fn(
      (projectId: string, workItemId: string, action: string) =>
        `kanban:work-item-run:${projectId}:${workItemId}:${action}`,
    ),
    buildConflictKey: vi.fn((projectId: string, workItemId: string) => ({
      kind: "work_item" as const,
      value: `work_item_dispatch:${projectId}:${workItemId}`,
    })),
  };

  beforeEach(() => {
    items.clear();
    vi.clearAllMocks();
    projectsMock = {
      findById: vi.fn().mockResolvedValue({
        id: "project-id",
        repository_workflow_settings: { enabled: false },
      }),
    };
    service = new WorkItemService(
      { requestWorkflowRun: vi.fn(), getProjectMountPolicy: vi.fn() } as never,
      {
        getRequestId: () => "corr-kanban-work-item",
        getCausationId: () => "cause-kanban-work-item",
      } as never,
      workItemRepository as never,
      lifecycleEventPublisherMock as never,
      projectsMock as never,
      { publish: vi.fn().mockResolvedValue(undefined) } as never,
      { broadcastWorkItemUpdated: vi.fn() } as never,
      runLeaseServiceMock as never,
      // Lease rollback flag enabled (default). See the rollback
      // runbook at docs/operations/README.md#work-item-run-link-lease-contention.
      {
        getBoolean: vi.fn((key: string) =>
          Promise.resolve(key === "work_item_run_lease_enabled"),
        ),
        getNumber: vi.fn(),
        get: vi.fn(),
        getAll: vi.fn(),
        set: vi.fn(),
        seedDefaults: vi.fn(),
        onModuleInit: vi.fn(),
      } as never,
      { estimate: vi.fn() } as never,
      { findAllForBucketAggregation: vi.fn() } as never,
    );
  });

  function addItem(overrides: Partial<WorkItemEntity>): WorkItemEntity {
    const item: WorkItemEntity = {
      id: "work-item-1",
      project_id: "project-1",
      title: "Work item",
      description: null,
      status: "todo",
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      token_spend: 0,
      current_execution_id: null,
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      linked_run_id: null,
      created_at: new Date("2026-04-15T00:00:00.000Z"),
      updated_at: new Date("2026-04-15T00:00:00.000Z"),
      ...overrides,
    };
    items.set(`${item.project_id}:${item.id}`, item);
    return item;
  }

  it("allows flexible status transitions locally", async () => {
    addItem({ id: "work-item-status", status: "blocked" });

    const result = await service.updateStatus(
      "project-1",
      "work-item-status",
      "ready-to-merge",
    );

    expect(result.status).toBe("ready-to-merge");
    await expect(
      service.updateStatus("project-1", "work-item-status", "todo"),
    ).resolves.toMatchObject({ status: "todo" });
  });

  it("allows formerly non-canonical lifecycle transitions", async () => {
    addItem({ id: "from-backlog", status: "backlog" });
    addItem({ id: "from-refinement", status: "refinement" });
    addItem({ id: "from-blocked", status: "blocked" });

    await expect(
      service.updateStatus("project-1", "from-refinement", "in-progress"),
    ).resolves.toMatchObject({ status: "in-progress" });
    await expect(
      service.updateStatus("project-1", "from-blocked", "ready-to-merge"),
    ).resolves.toMatchObject({ status: "ready-to-merge" });
    await expect(
      service.updateStatus("project-1", "from-backlog", "in-progress"),
    ).resolves.toMatchObject({ status: "in-progress" });
  });

  it("rejects unknown status values", async () => {
    addItem({ id: "unknown-status-item", status: "todo" });

    await expect(
      service.updateStatus(
        "project-1",
        "unknown-status-item",
        "not-a-status" as WorkItemStatus,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(workItemRepository.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "not-a-status" }),
    );
  });

  it("rejects unsupported same-status input instead of accepting it as a no-op", async () => {
    addItem({ id: "unsupported-same-status-item", status: "archived" });

    await expect(
      service.updateStatus(
        "project-1",
        "unsupported-same-status-item",
        "archived" as WorkItemStatus,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(workItemRepository.save).not.toHaveBeenCalled();
    expect(
      lifecycleEventPublisherMock.emitStatusChanged,
    ).not.toHaveBeenCalled();
  });

  it("allows any known status to move to any other known status", async () => {
    addItem({ id: "flexible-status-item", status: "done" });

    await service.updateStatus("project-1", "flexible-status-item", "backlog");

    expect(workItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: "backlog" }),
    );
  });

  it("emits lifecycle events when status transitions occur", async () => {
    addItem({ id: "work-item-1", status: "todo" });

    await service.updateStatus("project-1", "work-item-1", "in-progress");

    expect(lifecycleEventPublisherMock.emitStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        workItemId: "work-item-1",
        status: "in-progress",
        previousStatus: "todo",
        actor: "system",
      }),
    );
  });

  it("keeps the persisted status when lifecycle publishing is durably fail-visible", async () => {
    addItem({ id: "fail-visible-status-item", status: "todo" });
    lifecycleEventPublisherMock.emitStatusChanged.mockRejectedValueOnce(
      new FailVisibleLifecycleEventDeliveryError(
        "Core unavailable after delivery failure was recorded",
      ),
    );

    await expect(
      service.updateStatus(
        "project-1",
        "fail-visible-status-item",
        "in-progress",
      ),
    ).resolves.toMatchObject({
      id: "fail-visible-status-item",
      status: "in-progress",
    });

    expect(workItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fail-visible-status-item",
        status: "in-progress",
      }),
    );
  });

  it("fails the status update response when lifecycle publishing is not fail-visible", async () => {
    addItem({ id: "untracked-publish-failure-item", status: "todo" });
    lifecycleEventPublisherMock.emitStatusChanged.mockRejectedValueOnce(
      new Error("delivery failure was not recorded"),
    );

    await expect(
      service.updateStatus(
        "project-1",
        "untracked-publish-failure-item",
        "in-progress",
      ),
    ).rejects.toThrow("delivery failure was not recorded");
  });

  it("does not emit lifecycle events when status persistence fails", async () => {
    addItem({ id: "failed-save-status-item", status: "todo" });
    workItemRepository.save.mockRejectedValueOnce(new Error("save failed"));

    await expect(
      service.updateStatus("project-1", "failed-save-status-item", "done"),
    ).rejects.toThrow("save failed");

    expect(
      lifecycleEventPublisherMock.emitStatusChanged,
    ).not.toHaveBeenCalled();
  });

  it("does not emit lifecycle events for same-status updates", async () => {
    addItem({ id: "work-item-2", status: "in-progress" });

    await service.updateStatus("project-1", "work-item-2", "in-progress");

    expect(workItemRepository.save).not.toHaveBeenCalled();
    expect(
      lifecycleEventPublisherMock.emitStatusChanged,
    ).not.toHaveBeenCalled();
  });

  it("emits correct event payloads for canonical status transitions", async () => {
    const statusTransitions: Array<[string, string]> = [
      ["todo", "in-progress"],
      ["in-progress", "in-review"],
      ["in-review", "ready-to-merge"],
      ["ready-to-merge", "done"],
    ];

    for (const [fromStatus, toStatus] of statusTransitions) {
      const workItemId = `work-item-${fromStatus}-${toStatus}`;
      addItem({ id: workItemId, status: fromStatus });

      vi.clearAllMocks();

      await service.updateStatus(
        "project-1",
        workItemId,
        toStatus as WorkItemStatus,
      );

      expect(
        lifecycleEventPublisherMock.emitStatusChanged,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          workItemId,
          status: toStatus,
          previousStatus: fromStatus,
          actor: "system",
          updatedAt: "2026-04-15T00:10:00.000Z",
        }),
      );
      const emittedParams =
        lifecycleEventPublisherMock.emitStatusChanged.mock.calls[0]?.[0];
      expect(emittedParams?.resource).toMatchObject({
        id: workItemId,
        project_id: "project-1",
        status: toStatus,
      });
    }
  });
});
