import path from "node:path";
import { existsSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("./work-item-spec-writer", () => ({
  writeWorkItemSpec: vi.fn(),
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});
import { writeWorkItemSpec } from "./work-item-spec-writer";
import {
  runTransitionGate,
  buildTransitionPayload,
  mergeGateHeldMetadata,
  clearGateMetadata,
  SUPPORTED_WORK_ITEM_STATUSES,
  isSupportedWorkItemStatus,
  toWorkItemRecord,
} from "./work-item.service.helpers";
import { writeWorkItemSpecFile } from "./work-item-spec-file.helpers";
import type { WorkItemEntityRecord } from "./work-item.service.types";

function makeEntity(
  overrides: Partial<WorkItemEntityRecord> = {},
): WorkItemEntityRecord {
  const now = new Date("2026-06-24T00:00:00.000Z");
  return {
    id: "11111111-1111-1111-1111-111111111111",
    project_id: "22222222-2222-2222-2222-222222222222",
    title: "Item",
    description: null,
    status: "in-progress",
    priority: "p2",
    scope: "standard",
    assigned_agent_id: null,
    token_spend: 0,
    cost_cents: 0,
    current_execution_id: "run-1",
    waiting_for_input: false,
    execution_config: null,
    metadata: null,
    linked_run_id: "run-1",
    last_execution_status: "RUNNING",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("toWorkItemRecord", () => {
  it("maps last_execution_status to lastExecutionStatus", () => {
    const record = toWorkItemRecord(makeEntity(), [], []);
    expect(record.lastExecutionStatus).toBe("RUNNING");
  });

  it("maps a null last_execution_status to null", () => {
    const record = toWorkItemRecord(
      makeEntity({ last_execution_status: null }),
      [],
      [],
    );
    expect(record.lastExecutionStatus).toBeNull();
  });
});

describe("awaiting-pr-merge support", () => {
  it("is a supported work item status", () => {
    expect(SUPPORTED_WORK_ITEM_STATUSES.has("awaiting-pr-merge")).toBe(true);
    expect(isSupportedWorkItemStatus("awaiting-pr-merge")).toBe(true);
  });
});

function makeDeps(overrides: { settings?: unknown; executeResult?: unknown }) {
  const projects = {
    findById: vi.fn().mockResolvedValue({
      id: "p1",
      repository_workflow_settings: overrides.settings ?? {
        enabled: true,
        overrides: {},
      },
    }),
  };
  const coreClient = {
    executeLifecycleWorkflows: vi
      .fn()
      .mockResolvedValue(
        overrides.executeResult ?? { status: "passed", results: [] },
      ),
  };
  return { projects, coreClient };
}

describe("runTransitionGate", () => {
  it("skips (disabled) when repository workflows are off", async () => {
    const { projects, coreClient } = makeDeps({ settings: { enabled: false } });
    const result = await runTransitionGate({
      project_id: "p1",
      workItemId: "w1",
      targetStatus: "ready-to-merge",
      hook: "before",
      blocking: true,
      projects: projects as never,
      coreClient: coreClient as never,
    });
    expect(result).toEqual({
      aggregateStatus: "disabled",
      blocked: false,
      failures: [],
    });
    expect(coreClient.executeLifecycleWorkflows).not.toHaveBeenCalled();
  });

  it("treats null settings as enabled and runs the gate", async () => {
    const { projects, coreClient } = makeDeps({ settings: null });
    const result = await runTransitionGate({
      project_id: "p1",
      workItemId: "w1",
      targetStatus: "ready-to-merge",
      hook: "before",
      blocking: true,
      projects: projects as never,
      coreClient: coreClient as never,
    });
    expect(coreClient.executeLifecycleWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "ready-to-merge",
        hook: "before",
        blockingOnly: true,
      }),
    );
    expect(result.aggregateStatus).toBe("passed");
  });

  it("blocks on a failing blocking before-gate and returns failures", async () => {
    const { projects, coreClient } = makeDeps({
      executeResult: {
        status: "failed",
        results: [
          { workflowName: "e2e", status: "failed", error: "boom", runId: "r1" },
          { workflowName: "lint", status: "passed" },
        ],
      },
    });
    const result = await runTransitionGate({
      project_id: "p1",
      workItemId: "w1",
      targetStatus: "ready-to-merge",
      hook: "before",
      blocking: true,
      projects: projects as never,
      coreClient: coreClient as never,
    });
    expect(coreClient.executeLifecycleWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "ready-to-merge",
        hook: "before",
        blockingOnly: true,
      }),
    );
    expect(result.blocked).toBe(true);
    expect(result.aggregateStatus).toBe("failed");
    expect(result.failures).toEqual([
      { workflowName: "e2e", status: "failed", error: "boom", runId: "r1" },
    ]);
  });

  it("never blocks for a non-blocking after-hook", async () => {
    const { projects, coreClient } = makeDeps({
      executeResult: {
        status: "failed",
        results: [{ workflowName: "notify", status: "failed" }],
      },
    });
    const result = await runTransitionGate({
      project_id: "p1",
      workItemId: "w1",
      targetStatus: "in-review",
      hook: "after",
      blocking: false,
      projects: projects as never,
      coreClient: coreClient as never,
    });
    expect(coreClient.executeLifecycleWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "in-review",
        hook: "after",
        blockingOnly: false,
      }),
    );
    expect(result.blocked).toBe(false);
  });
});

describe("gate metadata helpers", () => {
  it("writes a held gate marker under metadata.lifecycle.gate, preserving siblings", () => {
    const next = mergeGateHeldMetadata({
      metadata: { foo: "bar", lifecycle: { merge: { status: "x" } } },
      targetStatus: "ready-to-merge",
      heldAt: "2026-06-08T00:00:00.000Z",
      failures: [
        { workflowName: "e2e", status: "failed", error: null, runId: "r1" },
      ],
    });
    expect(next.foo).toBe("bar");
    expect((next.lifecycle as any).merge).toEqual({ status: "x" });
    expect((next.lifecycle as any).gate).toEqual({
      targetStatus: "ready-to-merge",
      hook: "before",
      status: "held",
      heldAt: "2026-06-08T00:00:00.000Z",
      failures: [
        { workflowName: "e2e", status: "failed", error: null, runId: "r1" },
      ],
    });
  });

  it("clears only the gate marker", () => {
    const next = clearGateMetadata({
      lifecycle: { gate: { status: "held" }, merge: { x: 1 } },
      other: true,
    });
    expect((next.lifecycle as any).gate).toBeUndefined();
    expect((next.lifecycle as any).merge).toEqual({ x: 1 });
    expect(next.other).toBe(true);
  });

  it("builds a transition payload with work item + transition context", () => {
    const payload = buildTransitionPayload({
      item: { id: "w1", title: "T", status: "in-review" },
      fromStatus: "in-review",
      toStatus: "ready-to-merge",
      hook: "before",
    });
    expect(payload).toEqual({
      workItem: { id: "w1", title: "T", status: "in-review" },
      transition: { from: "in-review", to: "ready-to-merge" },
      hook: "before",
    });
  });
});

describe("writeWorkItemSpecFile", () => {
  function makeWriteDeps() {
    const projects = {
      findById: vi.fn().mockResolvedValue({
        id: "p1",
        base_path: "/repo",
      }),
    };
    const coreClient = {
      commitPaths: vi.fn().mockResolvedValue(undefined),
    };
    const workItems = {
      save: vi
        .fn()
        .mockImplementation((partial) =>
          Promise.resolve({ id: "wi-1", ...partial }),
        ),
    };
    return { projects, coreClient, workItems };
  }

  beforeEach(() => {
    vi.mocked(writeWorkItemSpec).mockReset();
    vi.mocked(existsSync).mockReset();
  });

  it("does not overwrite the authored publish_specs source file when it exists", async () => {
    const { projects, coreClient, workItems } = makeWriteDeps();
    const sourcePath = "docs/work-items/WI-001.md";
    const sourceId = "WI-001";
    // The authored file is present in the project repo — source of truth.
    vi.mocked(existsSync).mockReturnValue(true);

    const item = {
      id: "wi-uuid",
      title: "My item",
      description: "Desc",
      priority: "p1",
      scope: "standard",
      status: "backlog",
      execution_config: {},
      metadata: {
        source: "publish_specs",
        sourceId,
        sourcePath,
        workItemMarkdownPath: sourcePath,
      },
    } as never;

    await writeWorkItemSpecFile({
      project_id: "p1",
      item,
      dependencyIds: [],
      projects: projects as never,
      coreClient: coreClient as never,
      workItems: workItems as never,
    });

    // A committed authored spec file IS the source of truth and must never be
    // clobbered by a regenerated copy.
    expect(existsSync).toHaveBeenCalledWith(
      path.resolve("/repo", sourcePath),
    );
    expect(writeWorkItemSpec).not.toHaveBeenCalled();
    expect(coreClient.commitPaths).not.toHaveBeenCalled();
    expect(workItems.save).not.toHaveBeenCalled();
  });

  it("materializes a regenerated spec when the publish_specs authored file is missing", async () => {
    const { projects, coreClient, workItems } = makeWriteDeps();
    const sourcePath = "docs/work-items/WI-001.md";
    const sourceId = "WI-001";
    const resolvedPath = path.resolve("/repo", sourcePath);
    // The referenced file was never committed to the project repo.
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeWorkItemSpec).mockResolvedValue({
      ok: true,
      filePath: resolvedPath,
      sourceHash: "hash-mat",
    });

    const item = {
      id: "wi-uuid",
      title: "My item",
      description: "Desc",
      priority: "p1",
      scope: "standard",
      status: "backlog",
      execution_config: {},
      metadata: {
        source: "publish_specs",
        sourceId,
        sourcePath,
        workItemMarkdownPath: sourcePath,
      },
    } as never;

    await writeWorkItemSpecFile({
      project_id: "p1",
      item,
      dependencyIds: [],
      projects: projects as never,
      coreClient: coreClient as never,
      workItems: workItems as never,
    });

    // A dangling reference must be repaired: regenerate at the recorded path,
    // preserving the sourceId as the frontmatter id.
    expect(writeWorkItemSpec).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({ id: "wi-uuid", title: "My item" }),
      expect.objectContaining({
        filePath: resolvedPath,
        frontmatterId: sourceId,
      }),
    );
    expect(coreClient.commitPaths).toHaveBeenCalledWith(
      expect.objectContaining({ paths: [resolvedPath], push: true }),
    );
    // The recorded (relative) path stays intact so the workflow trigger keeps
    // pointing at the same location; only the content hash is refreshed.
    expect(workItems.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "wi-uuid",
        metadata: expect.objectContaining({
          workItemMarkdownPath: sourcePath,
          sourceHash: "hash-mat",
        }),
      }),
    );
  });

  it("generates a spec file for items without an authored source", async () => {
    const { projects, coreClient, workItems } = makeWriteDeps();
    const filePath = path.resolve("/repo", "docs/work-items/wi-uuid.md");
    vi.mocked(writeWorkItemSpec).mockResolvedValue({
      ok: true,
      filePath,
      sourceHash: "hash-123",
    });

    const item = {
      id: "wi-uuid",
      title: "My item",
      description: "Desc",
      priority: "p1",
      scope: "standard",
      status: "backlog",
      execution_config: {},
      metadata: {},
    } as never;

    await writeWorkItemSpecFile({
      project_id: "p1",
      item,
      dependencyIds: [],
      projects: projects as never,
      coreClient: coreClient as never,
      workItems: workItems as never,
    });

    expect(writeWorkItemSpec).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({
        id: "wi-uuid",
        title: "My item",
        dependencyIds: [],
      }),
      expect.objectContaining({ frontmatterId: undefined }),
    );
    expect(coreClient.commitPaths).toHaveBeenCalled();
    expect(workItems.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "wi-uuid",
        metadata: expect.objectContaining({
          workItemMarkdownPath: filePath,
          sourceHash: "hash-123",
        }),
      }),
    );
  });
});
