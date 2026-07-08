import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type {
  BaseRequestContextService,
  WorkflowLifecycleExecutionResult,
  WorkflowRunAcceptedV1,
  WorkflowRunRequestV1,
} from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemService } from "./work-item.service";

type WorkItemEntity = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  type: string;
  parent_work_item_id: string | null;
  story_points: number | null;
  assigned_agent_id: string | null;
  token_spend: number;
  cost_cents: number;
  current_execution_id: string | null;
  waiting_for_input: boolean;
  execution_config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  linked_run_id: string | null;
  subtasks?: Array<{
    id: string;
    subtask_id: string;
    work_item_id: string;
    title: string;
    status: string;
    order_index: number;
    depends_on_subtask_ids: string[] | null;
    source_path: string;
    metadata: Record<string, unknown> | null;
    updated_at: Date;
  }>;
  created_at: Date;
  updated_at: Date;
};

describe("WorkItemService", () => {
  let service: WorkItemService;
  let forbiddenCoreProjectCallMock: ReturnType<typeof vi.fn>;
  let capturedRequests: WorkflowRunRequestV1[];
  const items = new Map<string, WorkItemEntity>();
  const dependencies = new Map<string, string[]>();
  const subtasks = new Map<string, NonNullable<WorkItemEntity["subtasks"]>>();

  const workItemRepository = {
    save: vi.fn(
      (
        input: Partial<WorkItemEntity> & {
          id: string;
          project_id: string;
          title: string;
        },
      ) => {
        const key = `${input.project_id}:${input.id}`;
        const existing = items.get(key);
        const now = new Date("2026-04-15T00:10:00.000Z");
        const entity: WorkItemEntity = {
          id: input.id,
          project_id: input.project_id,
          title: input.title,
          description: input.description ?? existing?.description ?? null,
          status: input.status ?? existing?.status ?? "todo",
          priority: input.priority ?? existing?.priority ?? "p2",
          type: input.type ?? existing?.type ?? "story",
          // Every real call site passes a complete entity (spread of the
          // current record with specific fields overridden), so
          // `input.parent_work_item_id` is always authoritative — including
          // when it's explicitly `null` (e.g. detaching a parent on
          // promotion to epic). Falling back to `existing` here would mask
          // that explicit clear.
          parent_work_item_id: input.parent_work_item_id ?? null,
          story_points: input.story_points ?? existing?.story_points ?? null,
          assigned_agent_id:
            input.assigned_agent_id ?? existing?.assigned_agent_id ?? null,
          token_spend: input.token_spend ?? existing?.token_spend ?? 0,
          cost_cents: input.cost_cents ?? existing?.cost_cents ?? 0,
          current_execution_id:
            input.current_execution_id ??
            existing?.current_execution_id ??
            null,
          waiting_for_input:
            input.waiting_for_input ?? existing?.waiting_for_input ?? false,
          execution_config:
            input.execution_config ?? existing?.execution_config ?? null,
          metadata: input.metadata ?? existing?.metadata ?? null,
          linked_run_id: input.linked_run_id ?? existing?.linked_run_id ?? null,
          subtasks: input.subtasks ?? existing?.subtasks ?? [],
          created_at:
            existing?.created_at ?? new Date("2026-04-15T00:00:00.000Z"),
          updated_at: now,
        };
        items.set(key, entity);
        return Promise.resolve(entity);
      },
    ),
    findAll: vi.fn(() => Promise.resolve([...items.values()])),
    findByproject_id: vi.fn((project_id: string) =>
      Promise.resolve(
        [...items.values()].filter((item) => item.project_id === project_id),
      ),
    ),
    findByProjectAndId: vi.fn((project_id: string, workItemId: string) =>
      Promise.resolve(items.get(`${project_id}:${workItemId}`) ?? null),
    ),
    findTopByCostDesc: vi.fn(),
    deleteByProjectAndId: vi.fn((project_id: string, workItemId: string) => {
      items.delete(`${project_id}:${workItemId}`);
      dependencies.delete(workItemId);
      for (const [dependentWorkItemId, dependencyIds] of dependencies) {
        dependencies.set(
          dependentWorkItemId,
          dependencyIds.filter((dependencyId) => dependencyId !== workItemId),
        );
      }
      subtasks.delete(workItemId);
      return Promise.resolve();
    }),
    replaceDependencies: vi.fn(
      (workItemId: string, dependencyIds: string[]) => {
        dependencies.set(workItemId, dependencyIds);
        return Promise.resolve();
      },
    ),
    replaceSubtasks: vi.fn(
      (
        project_id: string,
        workItemId: string,
        entries: NonNullable<WorkItemEntity["subtasks"]>,
      ) => {
        const normalized = entries.map((entry, index) => ({
          ...entry,
          id: entry.id || `${workItemId}:${entry.subtask_id}`,
          work_item_id: workItemId,
          order_index: entry.order_index ?? index,
          updated_at: entry.updated_at ?? new Date("2026-04-15T00:10:00.000Z"),
        }));
        subtasks.set(workItemId, normalized);
        const item = items.get(`${project_id}:${workItemId}`);
        if (item) item.subtasks = normalized;
        return Promise.resolve(normalized);
      },
    ),
    findSubtasksByWorkItemIds: vi.fn((workItemIds: string[]) =>
      Promise.resolve(
        workItemIds.flatMap((workItemId) => subtasks.get(workItemId) ?? []),
      ),
    ),
    findDependenciesByWorkItemIds: vi.fn((workItemIds: string[]) =>
      Promise.resolve(
        workItemIds.flatMap((workItemId) =>
          (dependencies.get(workItemId) ?? []).map((dependsOnWorkItemId) => ({
            work_item_id: workItemId,
            depends_on_work_item_id: dependsOnWorkItemId,
          })),
        ),
      ),
    ),
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
      (project_id: string, workItemId: string) => {
        const key = `${project_id}:${workItemId}`;
        const existing = items.get(key) ?? null;
        return Promise.resolve(existing);
      },
    ),
    existsChildrenFor: vi.fn((parentIds: string[]) => {
      const found = new Set<string>();
      for (const item of items.values()) {
        if (
          item.parent_work_item_id &&
          parentIds.includes(item.parent_work_item_id)
        ) {
          found.add(item.parent_work_item_id);
        }
      }
      return Promise.resolve(found);
    }),
    findChildIds: vi.fn((parentWorkItemId: string) =>
      Promise.resolve(
        [...items.values()]
          .filter((item) => item.parent_work_item_id === parentWorkItemId)
          .map((item) => item.id),
      ),
    ),
  };

  const acceptedResponse: WorkflowRunAcceptedV1 = {
    run_id: "run-1",
    workflow_id: "wf-1",
    status: "accepted",
    accepted_at: "2026-04-13T00:00:00.000Z",
    metadata: { correlation_id: "corr-1" },
  };

  const lifecycleEventPublisherMock = {
    emitStatusChanged: vi.fn(() => Promise.resolve()),
    emitHumanFeedbackResolved: vi.fn(() => Promise.resolve()),
  };

  const listWorkflowRunsMock = vi.fn();

  const executeLifecycleWorkflowsMock =
    vi.fn<() => Promise<WorkflowLifecycleExecutionResult>>();

  const projectsMock = {
    findById: vi.fn<() => Promise<unknown>>(),
  };

  const runLeaseServiceMock = {
    acquireRunLease: vi.fn(() =>
      Promise.resolve({ acquired: true as const, leaseIds: ["lease-1"] }),
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

  const costEstimationMock = {
    estimate: vi.fn(),
  };

  const runCostsMock = {
    findAllForBucketAggregation: vi.fn(),
  };

  beforeEach(() => {
    capturedRequests = [];
    items.clear();
    dependencies.clear();
    subtasks.clear();
    vi.clearAllMocks();

    forbiddenCoreProjectCallMock = vi.fn(() => {
      throw new Error("core project/work-item endpoints are forbidden");
    });

    const requestContext = {
      getRequestId: () => "corr-kanban-work-item",
      getCausationId: () => "cause-kanban-work-item",
    } as unknown as BaseRequestContextService;

    service = new WorkItemService(
      {
        requestWorkflowRun: (
          request: WorkflowRunRequestV1,
        ): Promise<WorkflowRunAcceptedV1> => {
          capturedRequests.push(request);
          return Promise.resolve(acceptedResponse);
        },
        executeLifecycleWorkflows: executeLifecycleWorkflowsMock,
        getProjectMountPolicy: forbiddenCoreProjectCallMock,
        commitPaths: forbiddenCoreProjectCallMock,
        listWorkflowRuns: listWorkflowRunsMock,
      } as never,
      requestContext,
      workItemRepository as never,
      lifecycleEventPublisherMock as never,
      projectsMock as never,
      { publish: vi.fn().mockResolvedValue(undefined) } as never,
      { broadcastWorkItemUpdated: vi.fn() } as never,
      runLeaseServiceMock as never,
      // Lease rollback flag enabled (default). The flag is read by
      // requestWorkItemRun via `getBoolean`; the default value
      // `work_item_run_lease_enabled = true` keeps the per-work-item
      // lease in front of every request call (see
      // docs/operations/README.md#work-item-run-link-lease-contention
      // for the rollback runbook).
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
      costEstimationMock as never,
      runCostsMock as never,
    );
  });

  it("getWorkItemCostSummary includes a predicted cost per item from the estimation service", async () => {
    workItemRepository.findTopByCostDesc.mockResolvedValueOnce([
      {
        id: "wi-1",
        project_id: "proj-1",
        title: "Fix bug",
        status: "in-progress",
        cost_cents: 120,
        token_spend: 4000,
        type: "bug",
        story_points: 3,
        execution_config: { model: "model-1", workflowId: "wf-1" },
      },
    ]);
    costEstimationMock.estimate.mockResolvedValueOnce({
      available: true,
      bucketTier: "global",
      sampleCount: 10,
      estimatedCostCents: 90,
      lowCostCents: 70,
      highCostCents: 110,
      whatIf: [],
    });

    const result = await service.getWorkItemCostSummary({ limit: 20 });

    expect(costEstimationMock.estimate).toHaveBeenCalledWith({
      workflowId: "wf-1:complete",
      type: "bug",
      storyPoints: 3,
      modelId: "model-1",
    });
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: "wi-1",
        predictedRemainingCostCents: 90,
        projectedTotalCostCents: 210,
      }),
    );
  });

  it("getCostEstimateAccuracy sums retried attempts per work item, then computes MAE against each item's single predicted-vs-actual pair", async () => {
    runCostsMock.findAllForBucketAggregation.mockResolvedValueOnce([
      {
        work_item_id: "wi-1",
        workflow_id: "wf-1",
        type: "task",
        story_points: 3,
        total_cost_cents: 100,
      },
      {
        work_item_id: "wi-2",
        workflow_id: "wf-1",
        type: "task",
        story_points: 3,
        total_cost_cents: 150,
      },
      {
        work_item_id: "wi-2",
        workflow_id: "wf-1",
        type: "task",
        story_points: 3,
        total_cost_cents: 50,
      },
    ]);
    costEstimationMock.estimate
      .mockResolvedValueOnce({ available: true, estimatedCostCents: 90 })
      .mockResolvedValueOnce({ available: true, estimatedCostCents: 220 });

    const result = await (
      service as unknown as {
        getCostEstimateAccuracy(): Promise<{
          sampleCount: number;
          meanAbsoluteErrorCents: number;
          meanAbsolutePercentageError: number | null;
        }>;
      }
    ).getCostEstimateAccuracy();

    expect(costEstimationMock.estimate).toHaveBeenCalledTimes(2);
    expect(result.sampleCount).toBe(2);
    expect(result.meanAbsoluteErrorCents).toBe(15);
    expect(result.meanAbsolutePercentageError).toBeCloseTo(0.1);
  });

  it("getCostEstimateAccuracy excludes a zero-actual-cost item from MAPE but keeps it in MAE", async () => {
    runCostsMock.findAllForBucketAggregation.mockResolvedValueOnce([
      {
        work_item_id: "wi-1",
        workflow_id: "wf-1",
        type: "task",
        story_points: 3,
        total_cost_cents: 0,
      },
    ]);
    costEstimationMock.estimate.mockResolvedValueOnce({
      available: true,
      estimatedCostCents: 10,
    });

    const result = await (
      service as unknown as {
        getCostEstimateAccuracy(): Promise<{
          sampleCount: number;
          meanAbsoluteErrorCents: number;
          meanAbsolutePercentageError: number | null;
        }>;
      }
    ).getCostEstimateAccuracy();

    expect(result.sampleCount).toBe(1);
    expect(result.meanAbsoluteErrorCents).toBe(10);
    expect(result.meanAbsolutePercentageError).toBeNull();
  });

  it("creates and lists work items with contract fields from kanban persistence", async () => {
    const created = await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Implement extraction",
      description: "Build the local source of truth",
      priority: "p0",
      status: "todo",
      executionConfig: { baseBranch: "main" },
      metadata: { source: "review" },
      subtasks: [
        {
          subtaskId: "subtask-1",
          title: "Wire subtasks",
          status: "todo",
          sourcePath: "docs/plan.md",
          dependsOnSubtaskIds: [],
          metadata: { estimate: 1 },
        },
      ],
    });

    const listed = await service.listWorkItems("project-1");

    expect(created).toEqual(
      expect.objectContaining({
        description: "Build the local source of truth",
        priority: "p0",
        executionConfig: { baseBranch: "main" },
        metadata: { source: "review" },
        subtasks: [
          expect.objectContaining({
            subtaskId: "subtask-1",
            title: "Wire subtasks",
            status: "todo",
            sourcePath: "docs/plan.md",
          }),
        ],
      }),
    );
    expect(listed).toEqual([
      expect.objectContaining({
        id: "work-item-1",
        project_id: "project-1",
        title: "Implement extraction",
        status: "todo",
        subtasks: [expect.objectContaining({ subtaskId: "subtask-1" })],
      }),
    ]);
  });

  it("defaults newly created work items to backlog when status is omitted", async () => {
    const created = await service.createWorkItem("project-1", {
      id: "work-item-backlog-default",
      title: "Needs planning",
    });

    expect(created.status).toBe("backlog");
  });

  it("rejects creating an epic with story points", async () => {
    await expect(
      service.createWorkItem("project-1", {
        id: "epic-with-points",
        title: "Epic",
        type: "epic",
        storyPoints: 3,
      }),
    ).rejects.toThrow(/story points are not allowed/);
    expect(workItemRepository.save).not.toHaveBeenCalled();
  });

  it("rejects parenting a task under a task", async () => {
    const parent = await service.createWorkItem("project-1", {
      id: "parent-task",
      title: "Parent",
      type: "task",
    });

    await expect(
      service.createWorkItem("project-1", {
        id: "child-task",
        title: "Child",
        type: "task",
        parentWorkItemId: parent.id,
      }),
    ).rejects.toThrow(/cannot parent/);
  });

  it("persists a valid parented task", async () => {
    const epic = await service.createWorkItem("project-1", {
      id: "epic-parent",
      title: "Epic",
      type: "epic",
    });
    const task = await service.createWorkItem("project-1", {
      id: "task-child",
      title: "Task",
      type: "task",
      storyPoints: 2,
      parentWorkItemId: epic.id,
    });

    expect(task.type).toBe("task");
    expect(task.parentWorkItemId).toBe(epic.id);
    expect(task.storyPoints).toBe(2);
  });

  it("rejects lifecycle status hidden in metadata", async () => {
    await expect(
      service.createWorkItem("project-1", {
        id: "work-item-metadata-status",
        title: "Ambiguous lifecycle status",
        metadata: { status: "backlog" },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(workItemRepository.save).not.toHaveBeenCalled();
  });

  it("updates work-item fields and dependency links locally", async () => {
    await service.createWorkItem("project-1", {
      id: "dep-1",
      title: "Dependency",
    });
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Original",
    });

    const updated = await service.updateWorkItem("project-1", "work-item-1", {
      title: "Updated",
      description: "New description",
      priority: "p0",
      dependsOn: ["dep-1"],
      executionConfig: { targetBranch: "feature/review" },
      metadata: { edited: true },
      subtasks: [
        {
          subtaskId: "subtask-2",
          title: "Update subtask",
          status: "in_progress",
          sourcePath: "docs/review.md",
          dependsOnSubtaskIds: [],
        },
      ],
    });

    expect(updated).toEqual(
      expect.objectContaining({
        title: "Updated",
        description: "New description",
        priority: "p0",
        dependsOn: ["dep-1"],
        blockedBy: ["dep-1"],
        executionConfig: { targetBranch: "feature/review" },
        metadata: { edited: true },
        subtasks: [expect.objectContaining({ subtaskId: "subtask-2" })],
      }),
    );
    expect(workItemRepository.replaceDependencies).toHaveBeenCalledWith(
      "work-item-1",
      ["dep-1"],
    );
    expect(workItemRepository.replaceSubtasks).toHaveBeenCalledWith(
      "project-1",
      "work-item-1",
      expect.arrayContaining([
        expect.objectContaining({ subtask_id: "subtask-2" }),
      ]),
    );
  });

  it("emits a status-refresh event when story points are set on a work item already in refinement", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-refinement-estimate",
      title: "Needs estimating",
      status: "refinement",
    });

    const updated = await service.updateWorkItem(
      "project-1",
      "work-item-refinement-estimate",
      { storyPoints: 13 },
    );

    expect(updated.storyPoints).toBe(13);
    expect(lifecycleEventPublisherMock.emitStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        workItemId: "work-item-refinement-estimate",
        status: "refinement",
        previousStatus: null,
        actor: "system",
        resource: expect.objectContaining({
          id: "work-item-refinement-estimate",
          status: "refinement",
          storyPoints: 13,
          parentWorkItemId: null,
        }),
      }),
    );
  });

  it("does not emit a status-refresh event when storyPoints changes on a work item outside refinement", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-todo-estimate",
      title: "Not yet refined",
      status: "todo",
    });

    await service.updateWorkItem("project-1", "work-item-todo-estimate", {
      storyPoints: 13,
    });

    expect(
      lifecycleEventPublisherMock.emitStatusChanged,
    ).not.toHaveBeenCalled();
  });

  it("does not emit a status-refresh event for a refinement work item when the patch omits storyPoints", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-refinement-no-points",
      title: "Refinement patch without points",
      status: "refinement",
    });

    await service.updateWorkItem(
      "project-1",
      "work-item-refinement-no-points",
      { title: "Refinement patch without points, edited" },
    );

    expect(
      lifecycleEventPublisherMock.emitStatusChanged,
    ).not.toHaveBeenCalled();
  });

  it("records a structured human feedback resolution and promotes blocked work to todo", async () => {
    await service.createWorkItem("project-1", {
      id: "human-feedback-1",
      title: "Human decision needed",
      status: "blocked",
      metadata: {
        feedbackNeeded: true,
        decisionPrompt: "Choose migration strategy",
      },
    });

    const updated = await service.submitHumanFeedbackResolution(
      "project-1",
      "human-feedback-1",
      {
        response: "Use the zero-downtime expand and contract plan.",
        resolvedBy: "user-1",
      },
    );

    expect(updated.status).toBe("todo");
    expect(updated.metadata).toMatchObject({
      feedbackNeeded: false,
      decisionPrompt: null,
      autonomousDecision: false,
      resolutionRationale: "Use the zero-downtime expand and contract plan.",
      humanDecisionResponse: "Use the zero-downtime expand and contract plan.",
      humanDecisionResolvedBy: "user-1",
      originalDecisionPrompt: "Choose migration strategy",
    });
    expect(
      lifecycleEventPublisherMock.emitHumanFeedbackResolved,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        workItemId: "human-feedback-1",
        response: "Use the zero-downtime expand and contract plan.",
        resolvedBy: "user-1",
      }),
    );
  });

  it("atomically detaches parentWorkItemId when a parented story is promoted to epic, leaving its children attached", async () => {
    const grandparentEpic = await service.createWorkItem("project-1", {
      id: "epic-grandparent",
      title: "Grandparent epic",
      type: "epic",
      status: "todo",
    });
    await service.createWorkItem("project-1", {
      id: "story-to-promote",
      title: "Story to promote",
      type: "story",
      status: "todo",
      parentWorkItemId: grandparentEpic.id,
    });
    await service.createWorkItem("project-1", {
      id: "child-of-story",
      title: "Child of promoted story",
      type: "task",
      status: "todo",
      parentWorkItemId: "story-to-promote",
    });

    const promoted = await service.updateWorkItem(
      "project-1",
      "story-to-promote",
      { type: "epic" },
    );

    expect(promoted.type).toBe("epic");
    expect(promoted.parentWorkItemId).toBeNull();

    const childIds = await service.findChildIds("story-to-promote");
    expect(childIds).toContain("child-of-story");
  });

  it("leaves parentWorkItemId untouched when promoting a parentless story to epic", async () => {
    await service.createWorkItem("project-1", {
      id: "story-no-parent",
      title: "Parentless story",
      type: "story",
      status: "todo",
    });

    const promoted = await service.updateWorkItem(
      "project-1",
      "story-no-parent",
      { type: "epic" },
    );

    expect(promoted.type).toBe("epic");
    expect(promoted.parentWorkItemId).toBeNull();
  });

  it("rejects dependency links to missing local work items", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Original",
    });

    await expect(
      service.updateWorkItem("project-1", "work-item-1", {
        dependencyIds: ["missing"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("deletes a local work item and removes links that reference it", async () => {
    await service.createWorkItem("project-1", {
      id: "dependency-1",
      title: "Dependency",
    });
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Dependent",
      dependsOn: ["dependency-1"],
      subtasks: [
        {
          subtaskId: "subtask-1",
          title: "Remove with parent",
          status: "todo",
          sourcePath: "docs/work-items/work-item-1.md",
        },
      ],
    });

    await service.deleteWorkItem("project-1", "dependency-1");

    expect(workItemRepository.deleteByProjectAndId).toHaveBeenCalledWith(
      "project-1",
      "dependency-1",
    );
    await expect(
      service.updateWorkItem("project-1", "work-item-1", {
        title: "Still editable",
      }),
    ).resolves.toEqual(expect.objectContaining({ dependsOn: [] }));
    await expect(
      service.updateStatus("project-1", "dependency-1", "todo"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("merges execution config locally", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-config",
      title: "Config",
    });

    await service.upsertExecutionConfig("project-1", "work-item-config", {
      baseBranch: "main",
      targetBranch: "feature/a",
      contextFiles: ["README.md"],
      documentationUrls: [],
    });
    const config = await service.upsertExecutionConfig(
      "project-1",
      "work-item-config",
      {
        maxLoops: 3,
      },
    );

    expect(config.executionConfig).toEqual({
      baseBranch: "main",
      targetBranch: "feature/a",
      contextFiles: ["README.md"],
      documentationUrls: [],
      maxLoops: 3,
    });
  });

  it("lists all work items globally from kanban persistence", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "First",
    });
    await service.createWorkItem("project-2", {
      id: "work-item-2",
      title: "Second",
    });

    const listed = await service.listAllWorkItems();

    expect(listed.map((item) => item.id)).toEqual([
      "work-item-1",
      "work-item-2",
    ]);
  });

  it("dispatches through core only via the generic workflow run request", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Implement extraction",
      status: "todo",
    });

    const result = await service.dispatchWorkItem("project-1", "work-item-1", {
      workflowId: "dispatch-work-item-flow",
      requestedBy: "kanban-user",
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.workflow_id).toBe("dispatch-work-item-flow");
    expect(capturedRequests[0]?.metadata.idempotency_key).toBe(
      "kanban:dispatch:project-1:work-item-1",
    );
    expect(result.run_id).toBe("run-1");
    expect(forbiddenCoreProjectCallMock).not.toHaveBeenCalled();
    expect(capturedRequests[0]?.input).not.toHaveProperty(
      "project_mount_policy",
    );
  });

  it("throws NotFoundException when launching a missing work item", async () => {
    await expect(
      service.dispatchWorkItem("project-1", "missing", {
        workflowId: "dispatch-work-item-flow",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects dispatching an epic and never calls the core workflow run", async () => {
    await service.createWorkItem("project-1", {
      id: "epic-1",
      title: "Container epic",
      type: "epic",
      status: "todo",
    });

    await expect(
      service.dispatchWorkItem("project-1", "epic-1", {
        workflowId: "dispatch-work-item-flow",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(capturedRequests).toHaveLength(0);
  });

  it("rejects dispatching a story that currently has children", async () => {
    const epic = await service.createWorkItem("project-1", {
      id: "epic-with-child",
      title: "Epic",
      type: "epic",
      status: "todo",
    });
    await service.createWorkItem("project-1", {
      id: "story-with-child",
      title: "Story with a child",
      type: "story",
      status: "todo",
      parentWorkItemId: epic.id,
    });
    await service.createWorkItem("project-1", {
      id: "task-child",
      title: "Task under story",
      type: "task",
      status: "todo",
      parentWorkItemId: "story-with-child",
    });

    await expect(
      service.dispatchWorkItem("project-1", "story-with-child", {
        workflowId: "dispatch-work-item-flow",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(capturedRequests).toHaveLength(0);
  });

  it("still dispatches a childless story/task as before", async () => {
    await service.createWorkItem("project-1", {
      id: "leaf-task",
      title: "Leaf task",
      type: "task",
      status: "todo",
    });

    const result = await service.dispatchWorkItem("project-1", "leaf-task", {
      workflowId: "dispatch-work-item-flow",
    });

    expect(capturedRequests).toHaveLength(1);
    expect(result.run_id).toBe("run-1");
  });

  it("does not apply the dispatch container guard to the review action", async () => {
    await service.createWorkItem("project-1", {
      id: "epic-review",
      title: "Epic reviewed anyway",
      type: "epic",
      status: "in-review",
    });

    const result = await service.submitReviewDecision(
      "project-1",
      "epic-review",
      {
        workflowId: "review-workflow",
        decision: "reject",
      },
    );

    expect(capturedRequests).toHaveLength(1);
    expect(result.run_id).toBe("run-1");
  });

  it("restarts execution by replaying the current work-item status event", async () => {
    await service.createWorkItem("project-1", {
      id: "dependency-1",
      title: "Dependency",
      status: "done",
    });
    await service.createWorkItem("project-1", {
      id: "work-item-merge-replay",
      title: "Replay ready to merge",
      status: "ready-to-merge",
      executionConfig: {
        baseBranch: "main",
        targetBranch: "feature/replay-current-column",
      },
      dependsOn: ["dependency-1"],
    });

    const result = await service.restartExecution(
      "project-1",
      "work-item-merge-replay",
    );

    expect(result).toEqual({
      workItem: expect.objectContaining({
        id: "work-item-merge-replay",
        project_id: "project-1",
        status: "ready-to-merge",
        executionConfig: {
          baseBranch: "main",
          targetBranch: "feature/replay-current-column",
        },
        dependsOn: ["dependency-1"],
        blockedBy: ["dependency-1"],
      }),
      triggeredRunIds: [],
    });
    expect(lifecycleEventPublisherMock.emitStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        workItemId: "work-item-merge-replay",
        status: "ready-to-merge",
        previousStatus: null,
        actor: "manual-retrigger",
        resource: expect.objectContaining({
          id: "work-item-merge-replay",
          project_id: "project-1",
          status: "ready-to-merge",
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/replay-current-column",
          },
        }),
      }),
    );
    expect(capturedRequests).toHaveLength(0);
  });

  it("throws NotFoundException when restarting a missing work item", async () => {
    await expect(
      service.restartExecution("project-1", "missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      lifecycleEventPublisherMock.emitStatusChanged,
    ).not.toHaveBeenCalled();
  });

  it("requestMerge triggers the merge workflow run without a lifecycle gate", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Merge candidate",
      status: "ready-to-merge",
    });

    const result = await service.requestMerge("project-1", "work-item-1", {
      workflowId: "merge-workflow",
    });

    // The merge action is ungated — no lifecycle check, workflow run is issued directly.
    expect(executeLifecycleWorkflowsMock).not.toHaveBeenCalled();
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.workflow_id).toBe("merge-workflow");
    expect(result.run_id).toBe("run-1");
  });

  it("requestMerge proceeds immediately without a lifecycle gate check", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Merge candidate",
      status: "ready-to-merge",
    });

    const result = await service.requestMerge("project-1", "work-item-1", {
      workflowId: "merge-workflow",
    });

    // Merge is ungated — no lifecycle workflows are executed.
    expect(executeLifecycleWorkflowsMock).not.toHaveBeenCalled();
    expect(capturedRequests).toHaveLength(1);
    expect(result.run_id).toBe("run-1");
  });

  it("requestMerge sets the idempotency key scoped to merge action", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Merge candidate",
      status: "ready-to-merge",
    });

    await service.requestMerge("project-1", "work-item-1", {
      workflowId: "merge-workflow",
    });

    expect(capturedRequests[0]?.metadata.idempotency_key).toBe(
      "kanban:merge:project-1:work-item-1",
    );
  });

  it("requestMerge persists the linked run id after issuing the workflow run", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Merge candidate",
      status: "ready-to-merge",
    });

    const result = await service.requestMerge("project-1", "work-item-1", {
      workflowId: "merge-workflow",
    });

    expect(result.workItem.linkedRunId).toBe("run-1");
    expect(capturedRequests).toHaveLength(1);
  });

  it("requestMerge throws NotFoundException when the work item does not exist", async () => {
    await expect(
      service.requestMerge("project-1", "nonexistent", {
        workflowId: "merge-workflow",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(executeLifecycleWorkflowsMock).not.toHaveBeenCalled();
    expect(capturedRequests).toHaveLength(0);
  });

  it("requestMerge launches the merge workflow with the kanban_merge launch source", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Merge candidate",
      status: "ready-to-merge",
    });

    await service.requestMerge("project-1", "work-item-1", {
      workflowId: "merge-workflow",
    });

    expect(capturedRequests[0]?.launch_source).toBe("kanban_merge");
  });

  it("requestMerge carries the work item executionConfig so the merge workflow resolves base/target branch", async () => {
    await service.createWorkItem("project-1", {
      id: "work-item-1",
      title: "Merge candidate",
      status: "ready-to-merge",
      executionConfig: {
        baseBranch: "main",
        targetBranch: "feature/work-item-1",
        worktreePath: "/data/worktrees/project-1/work-item-1",
      },
    });

    await service.requestMerge("project-1", "work-item-1", {
      workflowId: "merge-workflow",
    });

    // The merge workflow reads {{ trigger.resource.executionConfig.baseBranch }}
    // and targetBranch; the run request input must surface them or merge_prepare
    // fails with "requires base_branch and target_branch".
    const input = capturedRequests[0]?.input as
      | { resource?: { executionConfig?: Record<string, unknown> } }
      | undefined;
    expect(input?.resource?.executionConfig).toEqual({
      baseBranch: "main",
      targetBranch: "feature/work-item-1",
      worktreePath: "/data/worktrees/project-1/work-item-1",
    });
  });

  describe("updateStatus before-gate", () => {
    it("holds the item and throws 409 with a structured gate body when the before-gate blocks", async () => {
      executeLifecycleWorkflowsMock.mockResolvedValue({
        scopeId: "p1",
        contextId: "w1",
        phase: "ready-to-merge",
        hook: "before",
        blockingOnly: true,
        status: "failed",
        results: [
          {
            workflowId: "wf-e2e",
            workflowDefinitionId: "def-e2e",
            workflowName: "e2e",
            phase: "ready-to-merge",
            hook: "before",
            blocking: true,
            status: "failed",
            error: "boom",
            runId: "r1",
          },
        ],
      });
      projectsMock.findById.mockResolvedValue({
        id: "p1",
        repository_workflow_settings: { enabled: true, overrides: {} },
      });
      await service.createWorkItem("p1", {
        id: "w1",
        title: "T",
        status: "in-review",
        metadata: null,
      });

      await expect(
        service.updateStatus("p1", "w1", "ready-to-merge"),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "LIFECYCLE_GATE_BLOCKED",
          gate: {
            targetStatus: "ready-to-merge",
            failures: [expect.objectContaining({ workflowName: "e2e" })],
          },
        }),
      });

      // persisted held marker, did NOT change status
      const saved = workItemRepository.save.mock.calls.at(-1)?.[0] as
        | WorkItemEntity
        | undefined;
      expect(saved?.status).toBe("in-review");
      const lifecycle = (saved?.metadata as Record<string, unknown> | null)
        ?.lifecycle as Record<string, unknown> | undefined;
      const gate = lifecycle?.gate as Record<string, unknown> | undefined;
      expect(gate?.status).toBe("held");
    });

    it("commits the transition and fires the after-hook when the before-gate passes", async () => {
      executeLifecycleWorkflowsMock.mockResolvedValue({
        scopeId: "p1",
        contextId: "w1",
        phase: "ready-to-merge",
        hook: "before",
        blockingOnly: true,
        status: "passed",
        results: [],
      });
      projectsMock.findById.mockResolvedValue({
        id: "p1",
        repository_workflow_settings: { enabled: true, overrides: {} },
      });
      await service.createWorkItem("p1", {
        id: "w1",
        title: "T",
        status: "in-review",
        metadata: { lifecycle: { gate: { status: "held" } } },
      });

      await service.updateStatus("p1", "w1", "ready-to-merge");

      // before-gate then after-hook → two lifecycle calls
      const hooks = executeLifecycleWorkflowsMock.mock.calls.map(
        (c: unknown[]) => (c[0] as { hook: string }).hook,
      );
      expect(hooks).toEqual(["before", "after"]);
      const saved = workItemRepository.save.mock.calls.find(
        (c: unknown[]) => (c[0] as WorkItemEntity).status === "ready-to-merge",
      )?.[0] as WorkItemEntity | undefined;
      const lifecycle = (saved?.metadata as Record<string, unknown> | null)
        ?.lifecycle as Record<string, unknown> | undefined;
      expect(lifecycle?.gate).toBeUndefined();
    });
  });

  describe("review-approve gate", () => {
    it("runs before-ready-to-merge gate on approve and blocks when it fails", async () => {
      executeLifecycleWorkflowsMock.mockResolvedValue({
        scopeId: "p1",
        contextId: "w1",
        phase: "ready-to-merge",
        hook: "before",
        blockingOnly: true,
        status: "failed",
        results: [
          {
            workflowId: "wf-e2e",
            workflowDefinitionId: "def-e2e",
            workflowName: "e2e",
            phase: "ready-to-merge",
            hook: "before",
            blocking: true,
            status: "failed",
            error: undefined,
            runId: undefined,
          },
        ],
      });
      projectsMock.findById.mockResolvedValue({
        id: "p1",
        repository_workflow_settings: { enabled: true, overrides: {} },
      });
      await service.createWorkItem("p1", {
        id: "w1",
        title: "T",
        status: "in-review",
        metadata: null,
      });

      await expect(
        service.submitReviewDecision("p1", "w1", {
          decision: "approve",
          workflowId: "wf",
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "LIFECYCLE_GATE_BLOCKED" }),
      });

      // The workflow run must not be issued when the gate blocks.
      expect(capturedRequests).toHaveLength(0);
    });

    it("does NOT run the old phase:'merge' gate for the merge action", async () => {
      await service.createWorkItem("p1", {
        id: "w1",
        title: "T",
        status: "ready-to-merge",
        metadata: null,
      });

      await service.requestMerge("p1", "w1", { workflowId: "wf" });

      const phases = executeLifecycleWorkflowsMock.mock.calls.map(
        (c: unknown[]) => (c[0] as { phase: string }).phase,
      );
      expect(phases).not.toContain("merge");
    });
  });

  describe("getExecutions", () => {
    it("returns workflow runs for the work item", async () => {
      await service.createWorkItem("project-1", {
        id: "work-item-1",
        title: "Test item",
        status: "todo",
      });

      const runs = [
        {
          id: "run-1",
          workflow_id: "wf-1",
          status: "COMPLETED",
          current_step_id: null,
          state_variables: {},
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T01:00:00.000Z",
        },
        {
          id: "run-2",
          workflow_id: "wf-1",
          status: "RUNNING",
          current_step_id: "step-3",
          state_variables: {},
          created_at: "2026-04-14T00:00:00.000Z",
          updated_at: "2026-04-14T01:00:00.000Z",
        },
      ];

      listWorkflowRunsMock.mockResolvedValue(runs);

      const result = await service.getExecutions("project-1", "work-item-1");

      expect(result).toEqual(runs);
      expect(listWorkflowRunsMock).toHaveBeenCalledWith({
        scopeId: "project-1",
        contextId: "work-item-1",
        limit: 50,
      });
    });

    it("throws NotFoundException when work item does not exist", async () => {
      await expect(
        service.getExecutions("project-1", "nonexistent"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
