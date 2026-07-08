import { describe, expect, it, vi } from "vitest";
import type { BaseRequestContextService } from "@nexus/core";
import { dispatchWorkItems } from "./dispatch-work-items.core";
import type {
  DispatchCoreDeps,
  DispatchCoreOptions,
} from "./dispatch-core.types";

const PROJECT_ID = "proj-1";
const WORK_ITEM_ID = "wi-1";
const RUN_ID = `run-${WORK_ITEM_ID}`;
const NOW = new Date("2026-06-27T00:00:00.000Z");

function makeWorkItem(overrides: Record<string, unknown> = {}) {
  return {
    id: WORK_ITEM_ID,
    project_id: PROJECT_ID,
    title: WORK_ITEM_ID,
    status: "todo",
    priority: "p2",
    type: "story",
    parent_work_item_id: null,
    assigned_agent_id: null,
    token_spend: 0,
    current_execution_id: null,
    waiting_for_input: false,
    execution_config: null,
    metadata: null as Record<string, unknown> | null,
    linked_run_id: null,
    description: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

interface SetupConfig {
  metadata?: Record<string, unknown> | null;
  preflightRequired?: boolean;
}

function setupSingleTodoCandidate(config: SetupConfig) {
  const item = makeWorkItem({ metadata: config.metadata ?? null });
  const updateStatus = vi.fn().mockResolvedValue(undefined);
  const requestWorkflowRunSpy = vi.fn().mockResolvedValue({
    run_id: RUN_ID,
    workflow_id: "implement-work-item",
    status: "accepted",
    accepted_at: NOW.toISOString(),
    metadata: { correlation_id: "corr-test" },
  });

  const deps: DispatchCoreDeps = {
    coreClient: {
      requestWorkflowRun: requestWorkflowRunSpy,
      getWorkflowRunStatus: vi.fn().mockRejectedValue(new Error("no status")),
      emitDomainEventOrThrow: vi.fn().mockResolvedValue(undefined),
    },
    requestContext: {
      getRequestId: () => "corr-test",
      getCausationId: () => "cause-test",
    } as unknown as BaseRequestContextService,
    workItems: {
      findByproject_id: vi.fn().mockResolvedValue([item]),
      findByIds: vi.fn().mockResolvedValue([item]),
      findDependenciesByWorkItemIds: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockImplementation((input: Record<string, unknown>) =>
        Promise.resolve({
          ...input,
          status: "in-progress",
          linked_run_id: RUN_ID,
          current_execution_id: RUN_ID,
          updated_at: NOW,
        }),
      ),
      clearRunLinksIfMatches: vi.fn().mockResolvedValue(false),
      linkRunIfUnlinked: vi.fn().mockResolvedValue(true),
      findByProjectAndId: vi.fn().mockResolvedValue(item),
    } as unknown as DispatchCoreDeps["workItems"],
    workItemService: {
      updateStatus,
    },
  };

  const options: DispatchCoreOptions = {
    projectId: PROJECT_ID,
    workflowId: "implement-work-item",
    reconcileRunStatus: false,
    reconcileOrphans: false,
    checkTargetFileContention: false,
    partialFailure: false,
    maxActivePerProject: 10,
    preflightRequired: config.preflightRequired,
  };

  return { deps, options, updateStatus, requestWorkflowRunSpy };
}

describe("dispatchWorkItems — refinement gate", () => {
  it("reroutes an un-refined todo candidate to refinement when preflightRequired", async () => {
    const { deps, options, updateStatus, requestWorkflowRunSpy } =
      setupSingleTodoCandidate({
        metadata: {},
        preflightRequired: true,
      });

    const result = await dispatchWorkItems(deps, options);

    expect(updateStatus).toHaveBeenCalledWith(
      PROJECT_ID,
      WORK_ITEM_ID,
      "refinement",
    );
    expect(requestWorkflowRunSpy).not.toHaveBeenCalled();
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        workItemId: WORK_ITEM_ID,
        reason: "refinement_required",
      }),
    );
  });

  it("dispatches a todo candidate that already cleared refinement even when preflightRequired", async () => {
    const { deps, options, updateStatus } = setupSingleTodoCandidate({
      metadata: { refinement: { hasClearedRefinementOnce: true } },
      preflightRequired: true,
    });

    await dispatchWorkItems(deps, options);

    expect(updateStatus).not.toHaveBeenCalledWith(
      PROJECT_ID,
      WORK_ITEM_ID,
      "refinement",
    );
  });
});

describe("dispatchWorkItems — container guard", () => {
  it("skips an epic candidate as container_not_dispatchable and never calls requestWorkflowRun", async () => {
    const { deps, options, requestWorkflowRunSpy } = setupSingleTodoCandidate(
      {},
    );
    const epicItem = makeWorkItem({ type: "epic" });
    (
      deps.workItems.findByproject_id as ReturnType<typeof vi.fn>
    ).mockResolvedValue([epicItem]);

    const result = await dispatchWorkItems(deps, options);

    expect(requestWorkflowRunSpy).not.toHaveBeenCalled();
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        workItemId: WORK_ITEM_ID,
        reason: "container_not_dispatchable",
      }),
    );
  });

  it("skips a story that has children as container_not_dispatchable and never dispatches the parent (only the childless child)", async () => {
    const { deps, options, requestWorkflowRunSpy } = setupSingleTodoCandidate(
      {},
    );
    const parentStory = makeWorkItem({
      id: WORK_ITEM_ID,
      type: "story",
      parent_work_item_id: null,
    });
    const childTask = makeWorkItem({
      id: "wi-child",
      type: "task",
      parent_work_item_id: WORK_ITEM_ID,
    });
    (
      deps.workItems.findByproject_id as ReturnType<typeof vi.fn>
    ).mockResolvedValue([parentStory, childTask]);

    const result = await dispatchWorkItems(deps, options);

    // The parent story (a container by structure) must never reach dispatch —
    // only its childless child (a legitimate dispatchable leaf) may.
    expect(requestWorkflowRunSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          metadata: expect.objectContaining({ work_item_id: WORK_ITEM_ID }),
        }),
      }),
    );
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        workItemId: WORK_ITEM_ID,
        reason: "container_not_dispatchable",
      }),
    );
  });

  it("dispatches a childless story normally (guard does not fire)", async () => {
    const { deps, options, requestWorkflowRunSpy } = setupSingleTodoCandidate(
      {},
    );
    const storyItem = makeWorkItem({ type: "story" });
    (
      deps.workItems.findByproject_id as ReturnType<typeof vi.fn>
    ).mockResolvedValue([storyItem]);

    const result = await dispatchWorkItems(deps, options);

    expect(requestWorkflowRunSpy).toHaveBeenCalled();
    expect(result.skipped).not.toContainEqual(
      expect.objectContaining({ reason: "container_not_dispatchable" }),
    );
  });
});

function makeDeps(
  overrides: Partial<DispatchCoreDeps> & {
    projectItems?: Record<string, unknown>[];
  } = {},
) {
  const { projectItems = [], ...depOverrides } = overrides;
  const requestWorkflowRunSpy = vi.fn().mockResolvedValue({
    run_id: RUN_ID,
    workflow_id: "implement-work-item",
    status: "accepted",
    accepted_at: NOW.toISOString(),
    metadata: { correlation_id: "corr-test" },
  });
  const updateStatus = vi.fn().mockResolvedValue(undefined);

  return {
    coreClient: {
      requestWorkflowRun: requestWorkflowRunSpy,
      getWorkflowRunStatus: vi.fn().mockRejectedValue(new Error("no status")),
      emitDomainEventOrThrow: vi.fn().mockResolvedValue(undefined),
    },
    requestContext: {
      getRequestId: () => "corr-test",
      getCausationId: () => "cause-test",
    } as unknown as BaseRequestContextService,
    workItems: {
      findByproject_id: vi.fn().mockResolvedValue(projectItems),
      findByIds: vi.fn().mockResolvedValue(projectItems),
      findDependenciesByWorkItemIds: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockImplementation((input: Record<string, unknown>) =>
        Promise.resolve({
          ...input,
          status: "in-progress",
          linked_run_id: RUN_ID,
          current_execution_id: RUN_ID,
          updated_at: NOW,
        }),
      ),
      clearRunLinksIfMatches: vi.fn().mockResolvedValue(false),
      linkRunIfUnlinked: vi.fn().mockResolvedValue(true),
      findByProjectAndId: vi.fn().mockResolvedValue(projectItems[0]),
    } as unknown as DispatchCoreDeps["workItems"],
    workItemService: {
      updateStatus,
    },
    ...depOverrides,
  } as DispatchCoreDeps;
}

function makeOptions(
  overrides: Partial<DispatchCoreOptions> = {},
): DispatchCoreOptions {
  return {
    projectId: PROJECT_ID,
    workflowId: "implement-work-item",
    reconcileRunStatus: false,
    reconcileOrphans: false,
    checkTargetFileContention: false,
    partialFailure: false,
    maxActivePerProject: 10,
    ...overrides,
  };
}

describe("dispatchWorkItems — headline regression: no container dispatched", () => {
  it("never dispatches an epic sitting in todo", async () => {
    const epic = makeWorkItem({ id: "e", status: "todo", type: "epic" });
    const deps = makeDeps({ projectItems: [epic] });
    const result = await dispatchWorkItems(deps, makeOptions());
    expect(result.dispatched).toHaveLength(0);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        workItemId: "e",
        reason: "container_not_dispatchable",
      }),
    );
    expect(
      (deps.coreClient.requestWorkflowRun as ReturnType<typeof vi.fn>).mock
        .calls,
    ).toHaveLength(0);
  });

  it("never dispatches a story that has children", async () => {
    const story = makeWorkItem({ id: "s", status: "todo", type: "story" });
    const child = makeWorkItem({
      id: "c",
      status: "todo",
      type: "task",
      parent_work_item_id: "s",
    });
    const deps = makeDeps({ projectItems: [story, child] });
    const result = await dispatchWorkItems(deps, makeOptions());
    expect(result.dispatched.map((d) => d.workItemId)).not.toContain("s");
  });

  it("dispatches a childless story", async () => {
    const story = makeWorkItem({ id: "s", status: "todo", type: "story" });
    const deps = makeDeps({ projectItems: [story] });
    const result = await dispatchWorkItems(deps, makeOptions());
    expect(result.dispatched.map((d) => d.workItemId)).toContain("s");
  });
});
