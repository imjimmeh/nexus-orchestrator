import { BadRequestException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import type { InternalToolExecutionContext } from "@nexus/core";
import type { WorkItemRecord } from "@nexus/kanban-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { KanbanSettingRepository } from "../../src/database/repositories/kanban-setting.repository";
import { OrchestrationDecisionExecutorService } from "../../src/orchestration/control-plane/orchestration-decision-executor.service";
import { OrchestrationFactSnapshotService } from "../../src/orchestration/control-plane/orchestration-fact-snapshot.service";
import { WorkItemTransitionStatusTool } from "../../src/mcp/tools/mutation/work-item-transition-status.tool";
import { KanbanSettingsService } from "../../src/settings/kanban-settings.service";
import { WorkItemService } from "../../src/work-item/work-item.service";

const MAX_ACTIVE_KEY = "work_item_dispatch_max_active_per_project";

type SettingRow = {
  key: string;
  value: unknown;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createInMemorySettingRepository(): {
  repository: KanbanSettingRepository;
  rows: Map<string, SettingRow>;
} {
  const rows = new Map<string, SettingRow>();
  const now = () => new Date("2026-06-01T00:00:00.000Z");
  const repository = {
    findAll: vi.fn(() =>
      Promise.resolve(
        [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)),
      ),
    ),
    findByKey: vi.fn((key: string) => Promise.resolve(rows.get(key) ?? null)),
    upsert: vi.fn(
      (key: string, value: unknown, description?: string | null) => {
        const existing = rows.get(key);
        const row: SettingRow = {
          key,
          value,
          description:
            description === undefined
              ? (existing?.description ?? null)
              : description,
          createdAt: existing?.createdAt ?? now(),
          updatedAt: now(),
        };
        rows.set(key, row);
        return row;
      },
    ),
  } as unknown as KanbanSettingRepository;
  return { repository, rows };
}

/**
 * Build a contract-shape work item suitable for `WorkItemService.listWorkItems`.
 * Mirrors `WorkItemRecord` (camelCase) — see
 * `packages/kanban-contracts/src/work-item.schema.ts`.
 */
function makeWorkItemRecord(overrides: {
  id: string;
  project_id: string;
  status: WorkItemRecord["status"];
  linkedRunId?: string | null;
  currentExecutionId?: string | null;
  metadata?: Record<string, unknown> | null;
}): WorkItemRecord {
  const now = "2026-06-01T00:00:00.000Z";
  return {
    id: overrides.id,
    project_id: overrides.project_id,
    title: `Work item ${overrides.id}`,
    description: null,
    status: overrides.status,
    scope: "standard",
    priority: "p2",
    assignedAgentId: null,
    tokenSpend: 0,
    currentExecutionId: overrides.currentExecutionId ?? null,
    waitingForInput: false,
    executionConfig: null,
    metadata: overrides.metadata ?? null,
    dependsOn: [],
    blockedBy: [],
    blocks: [],
    blockers: [],
    subtasks: [],
    createdAt: now,
    updatedAt: now,
    linkedRunId: overrides.linkedRunId ?? null,
  };
}

async function setMaxActive(
  settings: KanbanSettingsService,
  value: number,
): Promise<void> {
  await settings.set(MAX_ACTIVE_KEY, value);
}

describe("WIP cap transition tool integration (AC-1)", () => {
  let moduleRef: TestingModule;
  let tool: WorkItemTransitionStatusTool;
  let settingsService: KanbanSettingsService;
  let workItems: {
    listWorkItems: Mock<(project_id: string) => Promise<WorkItemRecord[]>>;
    updateStatus: Mock<
      (
        project_id: string,
        id: string,
        status: string,
      ) => Promise<{ id: string; status: string }>
    >;
  };
  let decisionExecutor: {
    executeDirectMutationDecision: Mock<
      (input: { execute: () => Promise<unknown> }) => Promise<unknown>
    >;
  };
  let factSnapshot: {
    publishWorkItemState: Mock<
      (input: {
        projectId: string;
        workItemId: string;
        currentStatus: string;
      }) => Promise<void>
    >;
  };
  let projectItems: WorkItemRecord[];

  const context: InternalToolExecutionContext = { scopeId: "p1" };

  beforeEach(async () => {
    const { repository } = createInMemorySettingRepository();
    settingsService = new KanbanSettingsService(repository);
    await settingsService.seedDefaults();

    projectItems = [];

    workItems = {
      listWorkItems: vi.fn(() => Promise.resolve(projectItems)),
      updateStatus: vi.fn(
        (
          _project_id: string,
          id: string,
          status: string,
        ): Promise<{ id: string; status: string }> =>
          Promise.resolve({ id, status }),
      ),
    };

    // The decision executor's execute callback must run the real mutation
    // (mirrors the unit test at work-item-transition-status.tool.spec.ts:43).
    decisionExecutor = {
      executeDirectMutationDecision: vi.fn((input: {
        execute: () => Promise<unknown>;
      }) => input.execute()),
    };

    factSnapshot = {
      publishWorkItemState: vi.fn(() => Promise.resolve()),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        WorkItemTransitionStatusTool,
        { provide: KanbanSettingsService, useValue: settingsService },
        { provide: KanbanSettingRepository, useValue: repository },
        { provide: WorkItemService, useValue: workItems },
        {
          provide: OrchestrationDecisionExecutorService,
          useValue: decisionExecutor,
        },
        { provide: OrchestrationFactSnapshotService, useValue: factSnapshot },
      ],
    }).compile();

    tool = moduleRef.get(WorkItemTransitionStatusTool);
  });

  afterEach(async () => {
    await moduleRef?.close();
    vi.clearAllMocks();
  });

  it("rejects todo → in-progress when the project is at capacity and exposes capacity metadata in the exception", async () => {
    await setMaxActive(settingsService, 1);
    projectItems = [
      makeWorkItemRecord({
        id: "wi-active",
        project_id: "p1",
        status: "in-progress",
        linkedRunId: "run-active",
      }),
      makeWorkItemRecord({
        id: "wi-1",
        project_id: "p1",
        status: "todo",
      }),
    ];

    const rejection = tool.execute(context, {
      project_id: "p1",
      workItemId: "wi-1",
      status: "in-progress",
    });

    await expect(rejection).rejects.toBeInstanceOf(BadRequestException);
    await expect(rejection).rejects.toThrow("Project WIP limit reached");

    // Capture the exception to assert metadata is exposed in the message
    // payload. The tool surfaces capacity metadata in the BadRequestException
    // message string (the only response payload NestJS exposes for an
    // HttpException), so we assert against `message` rather than a separate
    // metadata object.
    let caught: unknown;
    try {
      await tool.execute(context, {
        project_id: "p1",
        workItemId: "wi-1",
        status: "in-progress",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const message = (caught as BadRequestException).message;
    expect(message).toContain("activeCount=1");
    expect(message).toContain("maxActive=1");
    expect(message).toContain("availableSlots=0");
    expect(message).toContain("reason=project_wip_limit_reached");

    // Side-effect guarantees: the cap is enforced before any mutation or
    // decision-executor call.
    expect(workItems.updateStatus).not.toHaveBeenCalled();
    expect(
      decisionExecutor.executeDirectMutationDecision,
    ).not.toHaveBeenCalled();
  });

  it("allows todo → in-progress when capacity is available and records the launchable decision", async () => {
    await setMaxActive(settingsService, 2);
    projectItems = [
      makeWorkItemRecord({
        id: "wi-1",
        project_id: "p1",
        status: "todo",
      }),
    ];

    await tool.execute(context, {
      project_id: "p1",
      workItemId: "wi-1",
      status: "in-progress",
    });

    // The decision executor is the canonical sign of a launchable
    // transition; assert that the right args are forwarded.
    expect(
      decisionExecutor.executeDirectMutationDecision,
    ).toHaveBeenCalledTimes(1);
    const decisionArg = (
      decisionExecutor.executeDirectMutationDecision.mock.calls[0]?.[0] ?? {}
    ) as {
      projectId: string;
      requester: string;
      structuredDecision: { target_status: string };
      failureMetadata: { activeCount: number; maxActive: number; availableSlots: number };
      execute: () => Promise<unknown>;
    };
    expect(decisionArg.projectId).toBe("p1");
    expect(decisionArg.requester).toBe("kanban.work_item_transition_status");
    expect(decisionArg.structuredDecision.target_status).toBe("in-progress");
    expect(decisionArg.failureMetadata).toMatchObject({
      activeCount: 0,
      maxActive: 2,
      availableSlots: 2,
    });

    // The decision executor's `execute` callback runs the work item update.
    expect(workItems.updateStatus).toHaveBeenCalledWith("p1", "wi-1", "in-progress");

    // The fact snapshot is published before the decision is recorded.
    expect(factSnapshot.publishWorkItemState).toHaveBeenCalledWith({
      projectId: "p1",
      workItemId: "wi-1",
      currentStatus: "todo",
    });
  });

  it("bypasses the cap for active-to-active transitions when already at capacity", async () => {
    await setMaxActive(settingsService, 1);
    projectItems = [
      makeWorkItemRecord({
        id: "wi-1",
        project_id: "p1",
        status: "in-progress",
        linkedRunId: "run-1",
      }),
    ];

    await tool.execute(context, {
      project_id: "p1",
      workItemId: "wi-1",
      status: "in-review",
    });

    // No exception; the cap is bypassed because the current item is already
    // an active item (it is in the project dispatch active set).
    expect(
      decisionExecutor.executeDirectMutationDecision,
    ).toHaveBeenCalledTimes(1);
    expect(workItems.updateStatus).toHaveBeenCalledWith("p1", "wi-1", "in-review");
  });

  it("allows non-active transitions when at capacity (cap is only enforced for non-active → active)", async () => {
    await setMaxActive(settingsService, 1);
    projectItems = [
      // The capacity ceiling is reached by a separate active item.
      makeWorkItemRecord({
        id: "wi-active",
        project_id: "p1",
        status: "in-progress",
        linkedRunId: "run-active",
      }),
      // The candidate for this transition is a `done` move — it does not
      // consume a new active slot.
      makeWorkItemRecord({
        id: "wi-1",
        project_id: "p1",
        status: "in-progress",
        linkedRunId: "run-1",
      }),
    ];

    await tool.execute(context, {
      project_id: "p1",
      workItemId: "wi-1",
      status: "done",
    });

    expect(workItems.updateStatus).toHaveBeenCalledWith("p1", "wi-1", "done");
    expect(
      decisionExecutor.executeDirectMutationDecision,
    ).toHaveBeenCalledTimes(1);
  });
});
