import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { PublishSpecsTool } from "./publish-specs.tool";

// The tool's only I/O is `readdir` + `readFile` on the spec directory; it
// never touches git. Its collaborator `validateSourceSpecTracking` does shell
// out to `git` though, so `node:child_process` is faked here too (mirroring
// apps/kanban/src/project/managed-project-clone.service.spec.ts) to keep this
// a hermetic unit test with zero real filesystem or process I/O.
vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

type FakeDirEntry = { name: string; isFile: () => boolean };
type ReaddirImpl = (
  dirPath: string,
  options: { withFileTypes: true },
) => Promise<FakeDirEntry[]>;
type ReadFileImpl = (filePath: string, encoding: string) => Promise<string>;
type ExecFileCallback = (
  error: Error | null,
  result?: { stdout: string; stderr: string },
) => void;
type ExecFileImpl = (
  file: string,
  args: string[],
  options: unknown,
  callback: ExecFileCallback,
) => void;

const readdirMock = readdir as unknown as ReturnType<typeof vi.fn<ReaddirImpl>>;
const readFileMock = readFile as unknown as ReturnType<
  typeof vi.fn<ReadFileImpl>
>;
const execFileMock = execFile as unknown as ReturnType<
  typeof vi.fn<ExecFileImpl>
>;

// In-memory fixture "filesystem": directory path -> filenames it contains,
// and full file path -> file contents. registerSpecDir() populates both from
// a simple { fileName: contents } map so tests read like the real thing
// without ever touching disk.
const virtualDirFiles = new Map<string, string[]>();
const virtualFileContents = new Map<string, string>();

function registerSpecDir(dirPath: string, files: Record<string, string>): void {
  const normalizedDir = path.normalize(dirPath);
  virtualDirFiles.set(normalizedDir, Object.keys(files));
  for (const [fileName, content] of Object.entries(files)) {
    virtualFileContents.set(
      path.normalize(path.join(normalizedDir, fileName)),
      content,
    );
  }
}

function enoentError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

readdirMock.mockImplementation((dirPath) => {
  const names = virtualDirFiles.get(path.normalize(dirPath));
  if (!names) {
    return Promise.reject(
      enoentError(`ENOENT: no such directory, scandir '${dirPath}'`),
    );
  }
  return Promise.resolve(names.map((name) => ({ name, isFile: () => true })));
});

readFileMock.mockImplementation((filePath) => {
  const content = virtualFileContents.get(path.normalize(filePath));
  if (content === undefined) {
    return Promise.reject(
      enoentError(`ENOENT: no such file, open '${filePath}'`),
    );
  }
  return Promise.resolve(content);
});

// Fake git plumbing for validateSourceSpecTracking: by default there is no
// repo (matches every test running outside a real git working tree), so
// `git rev-parse --show-toplevel` fails and the source-tracking check is a
// no-op. The two untracked-spec tests below opt in to a simulated repo with
// specific untracked paths.
let gitRepoRoot: string | undefined;
let gitUntrackedRelativePaths: string[];

execFileMock.mockImplementation((_file, args, _options, callback) => {
  if (args[0] === "rev-parse") {
    if (!gitRepoRoot) {
      callback(new Error("fatal: not a git repository"));
      return;
    }
    callback(null, { stdout: `${gitRepoRoot}\n`, stderr: "" });
    return;
  }
  if (args[0] === "status") {
    const stdout = gitUntrackedRelativePaths
      .map((relativePath) => `?? ${relativePath}\0`)
      .join("");
    callback(null, { stdout, stderr: "" });
    return;
  }
  callback(new Error(`unexpected git invocation: ${args.join(" ")}`));
});

type WorkItemsMock = {
  listWorkItems: ReturnType<
    typeof vi.fn<(projectId: string) => Promise<Record<string, unknown>[]>>
  >;
  createWorkItem: ReturnType<
    typeof vi.fn<
      (
        projectId: string,
        input: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    >
  >;
  updateWorkItem: ReturnType<
    typeof vi.fn<
      (
        projectId: string,
        workItemId: string,
        patch: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>
    >
  >;
  updateStatus: ReturnType<
    typeof vi.fn<
      (
        projectId: string,
        workItemId: string,
        status: string,
      ) => Promise<Record<string, unknown>>
    >
  >;
};

type ProjectsMock = {
  get: ReturnType<
    typeof vi.fn<(projectId: string) => Promise<Record<string, unknown>>>
  >;
};

describe("PublishSpecsTool", () => {
  let workItems: WorkItemsMock;
  let projects: ProjectsMock;
  let tool: PublishSpecsTool;

  beforeEach(() => {
    virtualDirFiles.clear();
    virtualFileContents.clear();
    readdirMock.mockClear();
    readFileMock.mockClear();
    execFileMock.mockClear();
    gitRepoRoot = undefined;
    gitUntrackedRelativePaths = [];

    workItems = {
      listWorkItems: vi
        .fn<(projectId: string) => Promise<Record<string, unknown>[]>>()
        .mockResolvedValue([]),
      createWorkItem:
        vi.fn<
          (
            projectId: string,
            input: Record<string, unknown>,
          ) => Promise<Record<string, unknown>>
        >(),
      updateWorkItem:
        vi.fn<
          (
            projectId: string,
            workItemId: string,
            patch: Record<string, unknown>,
          ) => Promise<Record<string, unknown>>
        >(),
      updateStatus:
        vi.fn<
          (
            projectId: string,
            workItemId: string,
            status: string,
          ) => Promise<Record<string, unknown>>
        >(),
    };
    projects = {
      get: vi
        .fn<(projectId: string) => Promise<Record<string, unknown>>>()
        .mockResolvedValue({ id: "project-1", basePath: null }),
    };
    tool = new PublishSpecsTool(workItems as never, projects as never);
  });

  function minimalSpecContent(itemId: string): string {
    return [
      "---",
      `item_id: ${itemId}`,
      "title: Test item",
      "priority: 1",
      "scope: standard",
      "depends_on_item_ids: []",
      "---",
      "",
      "## Description",
      "Test body.",
    ].join("\n");
  }

  const noContext = {} as InternalToolExecutionContext;

  it("resolves relative spec directories against workspace_root", async () => {
    const workspaceRoot = "/fixtures/workspace-root-1";
    const specRoot = path.resolve(workspaceRoot, "docs/work-items");
    registerSpecDir(specRoot, { "WI-001.md": minimalSpecContent("WI-001") });

    await tool.execute(
      {},
      {
        project_id: "project-1",
        workspace_root: workspaceRoot,
        spec_directory: "docs/work-items",
      },
    );

    expect(workItems.createWorkItem).toHaveBeenCalled();
  });

  it("resolves relative spec directories against project base_path when workspace_root is omitted", async () => {
    const projectBasePath = "/fixtures/project-base-1";
    const specRoot = path.resolve(projectBasePath, "docs/work-items");
    registerSpecDir(specRoot, { "WI-001.md": minimalSpecContent("WI-001") });
    projects.get.mockResolvedValue({
      id: "project-1",
      basePath: projectBasePath,
    });

    await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: "docs/work-items",
    });

    expect(projects.get).toHaveBeenCalledWith("project-1");
    expect(readdir).toHaveBeenCalledWith(specRoot, { withFileTypes: true });
  });

  it("rejects untracked source specs in a Git project path by default", async () => {
    const projectBasePath = "/fixtures/git-project-untracked";
    const specRoot = path.resolve(projectBasePath, "docs/work-items");
    registerSpecDir(specRoot, { "WI-001.md": minimalSpecContent("WI-001") });
    projects.get.mockResolvedValue({
      id: "project-1",
      basePath: projectBasePath,
    });
    gitRepoRoot = projectBasePath;
    gitUntrackedRelativePaths = ["docs/work-items/WI-001.md"];

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: "docs/work-items",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "completed_with_errors",
      spec_count: 1,
      created_count: 0,
      errored_count: 1,
    });
    expect(result.errors).toEqual([
      expect.objectContaining({
        source_path: "docs/work-items/WI-001.md",
        message: expect.stringContaining("untracked_source_spec"),
      }),
    ]);
    expect(workItems.createWorkItem).not.toHaveBeenCalled();
  });

  it("allows untracked source specs when allow_untracked_specs is explicit", async () => {
    const projectBasePath = "/fixtures/git-project-allowed";
    const specRoot = path.resolve(projectBasePath, "docs/work-items");
    registerSpecDir(specRoot, { "WI-001.md": minimalSpecContent("WI-001") });
    projects.get.mockResolvedValue({
      id: "project-1",
      basePath: projectBasePath,
    });

    await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: "docs/work-items",
      allow_untracked_specs: true,
    });

    expect(workItems.createWorkItem).toHaveBeenCalled();
  });

  it("resolves relative spec directories against project base_path when workspace_root is blank", async () => {
    const projectBasePath = "/fixtures/project-base-2";
    const specRoot = path.resolve(projectBasePath, "docs/work-items");
    registerSpecDir(specRoot, { "WI-001.md": minimalSpecContent("WI-001") });
    projects.get.mockResolvedValue({
      id: "project-1",
      basePath: projectBasePath,
    });

    await tool.execute(noContext, {
      project_id: "project-1",
      workspace_root: "",
      spec_directory: "docs/work-items",
    });

    expect(projects.get).toHaveBeenCalledWith("project-1");
    expect(readdir).toHaveBeenCalledWith(specRoot, { withFileTypes: true });
  });

  it("returns a structured no-op when the spec directory is missing and allowed", async () => {
    const specDir = "/fixtures/missing-workspace/docs/work-items";

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
      allow_missing_specs: true,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "noop",
      reason: "missing_spec_directory",
      project_id: "project-1",
      spec_directory: specDir,
      spec_count: 0,
      created_count: 0,
      updated_count: 0,
      unchanged_count: 0,
      archived_count: 0,
      errored_count: 0,
      skipped_count: 0,
      work_item_ids_by_source_id: {},
    });
    expect(workItems.listWorkItems).not.toHaveBeenCalled();
  });

  it("accepts scope_id as an alias for project_id", async () => {
    const specDir = "/fixtures/missing-workspace/missing";

    const result = await tool.execute(noContext, {
      scope_id: "project-1",
      spec_directory: specDir,
      allow_missing_specs: true,
    });

    expect(result).toMatchObject({
      project_id: "project-1",
    });
  });

  it("throws when neither project_id nor scope_id is provided", async () => {
    const specDir = "/fixtures/missing-workspace/docs/work-items";

    await expect(
      tool.execute(noContext, {
        spec_directory: specDir,
        allow_missing_specs: true,
      }),
    ).rejects.toThrow();
  });

  it("throws ENOENT when directory is missing and allow_missing_specs is false", async () => {
    const specDir = "/fixtures/missing-workspace/docs/work-items";

    await expect(
      tool.execute(noContext, {
        project_id: "project-1",
        spec_directory: specDir,
      }),
    ).rejects.toThrow();
  });

  it("explains that missing /workspace publish paths are runner-local", async () => {
    await expect(
      tool.execute(noContext, {
        project_id: "project-1",
        spec_directory: "/workspace/docs/work-items",
      }),
    ).rejects.toThrow("/workspace paths are runner-local");
  });

  it("returns noop when spec_directory is a runner-local /workspace path and allow_missing_specs is true", async () => {
    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: "/workspace/docs/work-items",
      allow_missing_specs: true,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "noop",
      reason: "missing_spec_directory",
      project_id: "project-1",
      spec_count: 0,
    });
    expect(workItems.listWorkItems).not.toHaveBeenCalled();
  });

  it("returns noop when workspace_root is /workspace and allow_missing_specs is true", async () => {
    const result = await tool.execute(noContext, {
      project_id: "project-1",
      workspace_root: "/workspace",
      spec_directory: "docs/work-items",
      allow_missing_specs: true,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "noop",
      reason: "missing_spec_directory",
      project_id: "project-1",
      spec_count: 0,
    });
    expect(workItems.listWorkItems).not.toHaveBeenCalled();
  });

  it("creates work items with status, metadata, and executionConfig from spec", async () => {
    const specDir = "/fixtures/bootstrap-workspace/docs/work-items";
    registerSpecDir(specDir, {
      "bootstrap.md": [
        "---",
        "item_id: bootstrap",
        "title: Bootstrap project",
        "priority: p1",
        "scope: large",
        "status: done",
        "agent_profile: senior-dev",
        "base_branch: main",
        "target_branch: feature/bootstrap",
        "context_files:",
        "  - docs/ARCHITECTURE.md",
        "depends_on:",
        "  - discovery",
        "---",
        "Implement the bootstrap work.",
      ].join("\n"),
    });

    workItems.createWorkItem.mockImplementation((_pid, input) =>
      Promise.resolve({
        id: "wi-1",
        ...input,
      }),
    );

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      spec_count: 1,
      created_count: 1,
      updated_count: 0,
      unchanged_count: 0,
      errored_count: 0,
      work_item_ids_by_source_id: {
        bootstrap: "wi-1",
      },
    });

    const [, createInput] = workItems.createWorkItem.mock.calls[0];
    const executionConfig = createInput.executionConfig as Record<
      string,
      unknown
    >;
    const metadata = createInput.metadata as Record<string, unknown>;
    expect(createInput.title).toBe("Bootstrap project");
    expect(createInput.status).toBe("done");
    expect(executionConfig.agentProfileId).toBe("senior-dev");
    expect(executionConfig.baseBranch).toBe("main");
    expect(executionConfig.targetBranch).toBe("feature/bootstrap");
    expect(executionConfig.contextFiles).toEqual(["docs/ARCHITECTURE.md"]);
    expect(metadata.source).toBe("publish_specs");
    expect(metadata.sourceId).toBe("bootstrap");
    expect(metadata.sourcePath).toEqual(
      expect.stringContaining("bootstrap.md"),
    );
    expect(metadata.workItemMarkdownPath).toEqual(
      expect.stringContaining("bootstrap.md"),
    );
    expect(typeof metadata.sourceHash).toBe("string");
  });

  it("canonicalizes parent_context_id to split parent metadata when creating a work item", async () => {
    const specDir = "/fixtures/create-parent-workspace/docs/work-items";
    registerSpecDir(specDir, {
      "child.md": [
        "---",
        "item_id: child-1",
        "title: Child work",
        "priority: p1",
        "scope: standard",
        "status: todo",
        "parent_context_id: parent-1",
        "---",
        "Child body.",
      ].join("\n"),
    });

    workItems.createWorkItem.mockResolvedValue({ id: "wi-child" });

    await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    const [, createInput] = workItems.createWorkItem.mock.calls[0];
    expect(createInput.metadata).toMatchObject({
      parent_context_id: "parent-1",
      split: { parentId: "parent-1" },
    });
  });

  it("updates existing work items without patching status directly", async () => {
    const specDir = "/fixtures/update-workspace/docs/work-items";
    registerSpecDir(specDir, {
      "item-a.md": [
        "---",
        "item_id: item-a",
        "title: Updated title",
        "priority: p2",
        "scope: standard",
        "status: done",
        "---",
        "Updated body.",
      ].join("\n"),
    });

    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-existing",
        status: "todo",
        metadata: {
          sourceId: "item-a",
          sourceHash: "old-hash",
          refinement: { hasClearedRefinementOnce: true },
        },
      },
    ]);
    workItems.updateWorkItem.mockImplementation((_pid, id, patch) =>
      Promise.resolve({
        id,
        ...patch,
      }),
    );

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      updated_count: 1,
      created_count: 0,
      work_item_ids_by_source_id: {
        "item-a": "wi-existing",
      },
    });

    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-existing",
      expect.objectContaining({
        title: "Updated title",
      }),
    );

    const updateCall = workItems.updateWorkItem.mock.calls[0][2];
    expect(updateCall).not.toHaveProperty("status");
    const updateMetadata = updateCall.metadata as Record<string, unknown>;
    expect(updateMetadata.sourceId).toBe("item-a");
    expect(updateMetadata.refinement).toEqual({
      hasClearedRefinementOnce: true,
    });
    expect(typeof updateMetadata.sourceHash).toBe("string");

    expect(workItems.updateStatus).not.toHaveBeenCalled();
  });

  it("canonicalizes parent_context_id to split parent metadata when updating a work item", async () => {
    const specDir = "/fixtures/update-parent-workspace/docs/work-items";
    registerSpecDir(specDir, {
      "child.md": [
        "---",
        "item_id: child-1",
        "title: Child work",
        "priority: p1",
        "scope: standard",
        "status: todo",
        "parent_context_id: parent-1",
        "---",
        "Updated child body.",
      ].join("\n"),
    });

    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-child",
        status: "todo",
        metadata: {
          sourceId: "child-1",
          sourceHash: "old-hash",
          refinement: { hasClearedRefinementOnce: true },
        },
      },
    ]);
    workItems.updateWorkItem.mockImplementation((_pid, id, patch) =>
      Promise.resolve({ id, ...patch }),
    );

    await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    const updatePatch = workItems.updateWorkItem.mock.calls[0][2];
    expect(updatePatch.metadata).toMatchObject({
      parent_context_id: "parent-1",
      split: { parentId: "parent-1" },
      refinement: { hasClearedRefinementOnce: true },
    });
  });

  it("does not transition existing work item status from spec status", async () => {
    const specDir = "/fixtures/no-transition-workspace/docs/work-items";
    registerSpecDir(specDir, {
      "item-a.md": [
        "---",
        "item_id: item-a",
        "title: Updated title",
        "priority: p2",
        "scope: standard",
        "status: backlog",
        "---",
        "Updated body.",
      ].join("\n"),
    });

    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-existing",
        status: "done",
        metadata: { sourceId: "item-a", sourceHash: "old-hash" },
      },
    ]);
    workItems.updateWorkItem.mockImplementation((_pid, id, patch) =>
      Promise.resolve({
        id,
        ...patch,
      }),
    );

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      updated_count: 1,
      created_count: 0,
    });

    expect(workItems.updateStatus).not.toHaveBeenCalled();
    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-existing",
      expect.objectContaining({
        title: "Updated title",
      }),
    );
  });

  it("does not transition existing work item status forward from spec status", async () => {
    const specDir = "/fixtures/no-forward-transition-workspace/docs/work-items";
    registerSpecDir(specDir, {
      "item-a.md": [
        "---",
        "item_id: item-a",
        "title: Updated title",
        "priority: p2",
        "scope: standard",
        "status: done",
        "---",
        "Updated body.",
      ].join("\n"),
    });

    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-existing",
        status: "todo",
        metadata: { sourceId: "item-a", sourceHash: "old-hash" },
      },
    ]);
    workItems.updateWorkItem.mockImplementation((_pid, id, patch) =>
      Promise.resolve({
        id,
        ...patch,
      }),
    );

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      updated_count: 1,
      created_count: 0,
    });

    expect(workItems.updateStatus).not.toHaveBeenCalled();
    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-existing",
      expect.objectContaining({
        title: "Updated title",
      }),
    );
  });

  it("matches existing work item by id when spec sourceId does not match existing sourceId", async () => {
    const specDir = "/fixtures/match-by-id-workspace/docs/work-items";
    const workItemId = "a9bc8bb2-3e81-4320-8011-754d6ac423af";
    registerSpecDir(specDir, {
      [`${workItemId}.md`]: [
        "---",
        `item_id: ${workItemId}`,
        "title: Title from uuid spec",
        "priority: p2",
        "scope: standard",
        "---",
        "Body from uuid spec.",
      ].join("\n"),
    });

    workItems.listWorkItems.mockResolvedValue([
      {
        id: workItemId,
        status: "backlog",
        metadata: {
          sourceId: "original-source",
          sourceHash: "old-hash",
        },
      },
    ]);
    workItems.updateWorkItem.mockImplementation((_pid, id, patch) =>
      Promise.resolve({ id, ...patch }),
    );

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      updated_count: 1,
      created_count: 0,
    });
    expect(workItems.createWorkItem).not.toHaveBeenCalled();
    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      workItemId,
      expect.objectContaining({
        title: "Title from uuid spec",
      }),
    );
  });

  it("preserves active work item targetBranch when republished spec frontmatter drifts", async () => {
    const specDir = "/fixtures/preserve-branch-workspace/docs/work-items";
    registerSpecDir(specDir, {
      "item-a.md": [
        "---",
        "item_id: item-a",
        "title: Updated title",
        "priority: p1",
        "scope: standard",
        "status: ready-to-merge",
        "base_branch: main",
        "target_branch: feature/stale-slug",
        "context_files:",
        "  - docs/UPDATED.md",
        "---",
        "Updated body.",
      ].join("\n"),
    });

    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-existing",
        status: "ready-to-merge",
        executionConfig: {
          baseBranch: "main",
          targetBranch: "feature/wi-existing",
          contextFiles: ["docs/OLD.md"],
        },
        metadata: { sourceId: "item-a", sourceHash: "old-hash" },
      },
    ]);
    workItems.updateWorkItem.mockResolvedValue({ id: "wi-existing" });

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    expect(result.ok).toBe(true);
    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-existing",
      expect.objectContaining({
        executionConfig: expect.objectContaining({
          baseBranch: "main",
          targetBranch: "feature/wi-existing",
          contextFiles: ["docs/UPDATED.md"],
        }),
      }),
    );
  });

  it("skips updateStatus when spec status matches existing status", async () => {
    const specDir = "/fixtures/skip-status-workspace/docs/work-items";
    registerSpecDir(specDir, {
      "item-a.md": [
        "---",
        "item_id: item-a",
        "title: Title",
        "status: todo",
        "---",
        "Body.",
      ].join("\n"),
    });

    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-existing",
        status: "todo",
        metadata: { sourceId: "item-a", sourceHash: "old-hash" },
      },
    ]);
    workItems.updateWorkItem.mockResolvedValue({ id: "wi-existing" });

    await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    expect(workItems.updateStatus).not.toHaveBeenCalled();
  });

  it("counts unchanged when sourceHash matches existing metadata", async () => {
    const specDir = "/fixtures/unchanged-workspace/docs/work-items";
    const content = [
      "---",
      "item_id: item-a",
      "title: Title",
      "priority: p2",
      "scope: standard",
      "---",
      "Body.",
    ].join("\n");
    registerSpecDir(specDir, { "item-a.md": content });

    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(content, "utf8").digest("hex");

    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-existing",
        status: "todo",
        metadata: { sourceId: "item-a", sourceHash: hash },
      },
    ]);

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    expect(result).toMatchObject({
      unchanged_count: 1,
      updated_count: 0,
      created_count: 0,
      work_item_ids_by_source_id: {
        "item-a": "wi-existing",
      },
    });
    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-existing",
      { dependencyIds: [] },
    );
    expect(workItems.updateWorkItem).not.toHaveBeenCalledWith(
      "project-1",
      "wi-existing",
      expect.objectContaining({ title: "Title" }),
    );
  });

  it("captures per-file parse errors and returns completed_with_errors", async () => {
    const specDir = "/fixtures/parse-error-workspace/docs/work-items";
    registerSpecDir(specDir, {
      "good.md": [
        "---",
        "item_id: good-item",
        "title: Good item",
        "priority: p2",
        "scope: standard",
        "---",
        "Good body.",
      ].join("\n"),
      "bad.md": "---\nitem_id: bad-item\n---\nMissing title.",
    });

    workItems.createWorkItem.mockResolvedValue({ id: "wi-good" });

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "completed_with_errors",
      spec_count: 2,
      created_count: 1,
      updated_count: 0,
      errored_count: 1,
    });
    expect(Array.isArray(result.errors)).toBe(true);
    const [error] = result.errors as Record<string, unknown>[];
    expect(error.source_path).toEqual(expect.stringContaining("bad.md"));
    expect(typeof error.message).toBe("string");
  });

  it("falls back to scope_id when project_id is whitespace-only", async () => {
    const specDir = "/fixtures/missing-workspace/missing";

    const result = await tool.execute(noContext, {
      project_id: "   ",
      scope_id: "project-1",
      spec_directory: specDir,
      allow_missing_specs: true,
    });

    expect(result).toMatchObject({
      project_id: "project-1",
    });
  });

  it("throws when both project_id and scope_id are blank", async () => {
    const specDir = "/fixtures/missing-workspace/docs/work-items";

    await expect(
      tool.execute(noContext, {
        project_id: "  ",
        scope_id: "\t",
        spec_directory: specDir,
        allow_missing_specs: true,
      }),
    ).rejects.toThrow();
  });

  it("derives project_id from context.scopeId when project_id and scope_id are omitted", async () => {
    const specDir = "/fixtures/missing-workspace/missing";

    const result = await tool.execute(
      { scopeId: "project-from-context" },
      {
        spec_directory: specDir,
        allow_missing_specs: true,
      },
    );

    expect(result).toMatchObject({
      project_id: "project-from-context",
    });
  });

  describe("duplicate target branch rejection", () => {
    it("rejects the second spec when two dispatchable specs share the same target_branch", async () => {
      const specDir = "/fixtures/duplicate-branch-1/docs/work-items";
      registerSpecDir(specDir, {
        "standing-order.md": [
          "---",
          "item_id: standing-order",
          "title: Standing order spec",
          "priority: p1",
          "scope: standard",
          "status: in-review",
          "target_branch: feature/automation-improvements",
          "---",
          "First spec.",
        ].join("\n"),
        "heartbeat.md": [
          "---",
          "item_id: heartbeat",
          "title: Heartbeat spec",
          "priority: p2",
          "scope: standard",
          "status: todo",
          "target_branch: feature/automation-improvements",
          "depends_on:",
          "  - standing-order",
          "---",
          "Second spec.",
        ].join("\n"),
      });

      workItems.createWorkItem.mockResolvedValue({ id: "wi-standing-order" });

      const result = await tool.execute(noContext, {
        project_id: "project-1",
        spec_directory: specDir,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("completed_with_errors");
      expect(result.errored_count).toBe(1);
      expect(Array.isArray(result.errors)).toBe(true);
      const [error] = result.errors as Record<string, unknown>[];
      expect(error.source_path).toEqual(expect.stringContaining("heartbeat"));
      expect(error.message).toContain("feature/automation-improvements");
      expect(error.message).toContain("standing-order");
      expect(workItems.createWorkItem).toHaveBeenCalledTimes(1);
    });

    it("rejects duplicate target_branch when two new specs share a branch without explicit status", async () => {
      const specDir = "/fixtures/duplicate-branch-2/docs/work-items";
      registerSpecDir(specDir, {
        "alpha.md": [
          "---",
          "item_id: alpha",
          "title: Alpha spec",
          "priority: p1",
          "scope: standard",
          "target_branch: feature/shared-branch",
          "---",
          "Alpha body.",
        ].join("\n"),
        "beta.md": [
          "---",
          "item_id: beta",
          "title: Beta spec",
          "priority: p2",
          "scope: standard",
          "target_branch: feature/shared-branch",
          "---",
          "Beta body.",
        ].join("\n"),
      });

      workItems.createWorkItem.mockResolvedValue({ id: "wi-alpha" });

      const result = await tool.execute(noContext, {
        project_id: "project-1",
        spec_directory: specDir,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("completed_with_errors");
      expect(result.errored_count).toBe(1);
      expect(workItems.createWorkItem).toHaveBeenCalledTimes(1);
    });

    it("allows duplicate target_branch when both specs have backlog status", async () => {
      const specDir = "/fixtures/duplicate-branch-3/docs/work-items";
      registerSpecDir(specDir, {
        "spec-a.md": [
          "---",
          "item_id: spec-a",
          "title: Spec A",
          "priority: p1",
          "scope: standard",
          "status: backlog",
          "target_branch: feature/shared-branch",
          "---",
          "Spec A body.",
        ].join("\n"),
        "spec-b.md": [
          "---",
          "item_id: spec-b",
          "title: Spec B",
          "priority: p2",
          "scope: standard",
          "status: backlog",
          "target_branch: feature/shared-branch",
          "---",
          "Spec B body.",
        ].join("\n"),
      });

      workItems.createWorkItem.mockResolvedValue({ id: "wi-spec-a" });

      const result = await tool.execute(noContext, {
        project_id: "project-1",
        spec_directory: specDir,
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe("completed");
      expect(result.errored_count).toBe(0);
      expect(result.created_count).toBe(2);
    });

    it("rejects a spec that conflicts with an existing out-of-batch work item's target branch", async () => {
      const specDir = "/fixtures/duplicate-branch-4/docs/work-items";
      registerSpecDir(specDir, {
        "new-spec.md": [
          "---",
          "item_id: new-spec",
          "title: New spec",
          "priority: p1",
          "scope: standard",
          "status: todo",
          "target_branch: feature/shared-branch",
          "---",
          "New spec body.",
        ].join("\n"),
      });

      workItems.listWorkItems.mockResolvedValue([
        {
          id: "wi-existing-out-of-batch",
          status: "in-review",
          executionConfig: { targetBranch: "feature/shared-branch" },
          metadata: {
            sourceId: "existing-owner",
            sourceHash: "old-hash",
            sourcePath: "docs/work-items/imported.md",
          },
        },
      ]);

      const result = await tool.execute(noContext, {
        project_id: "project-1",
        spec_directory: specDir,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("completed_with_errors");
      expect(result.errored_count).toBe(1);
      expect(Array.isArray(result.errors)).toBe(true);
      const [error] = result.errors as Record<string, unknown>[];
      expect(error.source_path).toEqual(expect.stringContaining("new-spec"));
      expect(error.message).toContain("feature/shared-branch");
      expect(error.message).toContain("existing-owner");
      expect(workItems.createWorkItem).not.toHaveBeenCalled();
    });

    it("rejects a spec that conflicts with an in-batch existing item's preserved target branch", async () => {
      const specDir = "/fixtures/duplicate-branch-5/docs/work-items";
      registerSpecDir(specDir, {
        "standing-order.md": [
          "---",
          "item_id: standing-order",
          "title: Standing order",
          "priority: p1",
          "scope: standard",
          "status: in-review",
          "---",
          "Standing order body.",
        ].join("\n"),
        "heartbeat.md": [
          "---",
          "item_id: heartbeat",
          "title: Heartbeat",
          "priority: p1",
          "scope: standard",
          "status: todo",
          "target_branch: feature/shared-branch",
          "depends_on:",
          "  - standing-order",
          "---",
          "Heartbeat body.",
        ].join("\n"),
      });

      workItems.listWorkItems.mockResolvedValue([
        {
          id: "wi-standing-order",
          status: "in-review",
          executionConfig: { targetBranch: "feature/shared-branch" },
          metadata: {
            sourceId: "standing-order",
            sourceHash: "old-hash",
            sourcePath: "docs/work-items/standing-order.md",
          },
        },
      ]);

      const result = await tool.execute(noContext, {
        project_id: "project-1",
        spec_directory: specDir,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("completed_with_errors");
      expect(result.errored_count).toBe(1);
      expect(Array.isArray(result.errors)).toBe(true);
      const [error] = result.errors as Record<string, unknown>[];
      expect(error.source_path).toEqual(expect.stringContaining("heartbeat"));
      expect(error.message).toContain("feature/shared-branch");
      expect(error.message).toContain("standing-order");
      expect(workItems.createWorkItem).not.toHaveBeenCalled();
    });

    it("rejects a spec that sorts before an in-batch existing item's preserved target branch", async () => {
      const specDir = "/fixtures/duplicate-branch-6/docs/work-items";
      registerSpecDir(specDir, {
        "a-new.md": [
          "---",
          "item_id: a-new",
          "title: New item",
          "priority: p1",
          "scope: standard",
          "status: todo",
          "target_branch: feature/sort-before-owner",
          "---",
          "New item body.",
        ].join("\n"),
        "z-owner.md": [
          "---",
          "item_id: z-owner",
          "title: Existing owner",
          "priority: p1",
          "scope: standard",
          "status: in-review",
          "base_branch: main",
          "---",
          "Existing owner body.",
        ].join("\n"),
      });

      workItems.listWorkItems.mockResolvedValue([
        {
          id: "wi-z-owner",
          status: "in-review",
          executionConfig: { targetBranch: "feature/sort-before-owner" },
          metadata: {
            sourceId: "z-owner",
            sourceHash: "old-hash",
            sourcePath: "docs/work-items/z-owner.md",
          },
        },
      ]);

      const result = await tool.execute(noContext, {
        project_id: "project-1",
        spec_directory: specDir,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("completed_with_errors");
      expect(result.errored_count).toBe(1);
      expect(Array.isArray(result.errors)).toBe(true);
      const [error] = result.errors as Record<string, unknown>[];
      expect(error.source_path).toEqual(expect.stringContaining("a-new"));
      expect(error.message).toContain("feature/sort-before-owner");
      expect(error.message).toContain("z-owner");
      expect(workItems.createWorkItem).not.toHaveBeenCalled();
      expect(workItems.updateWorkItem).toHaveBeenCalledWith(
        "project-1",
        "wi-z-owner",
        expect.objectContaining({
          executionConfig: expect.objectContaining({
            baseBranch: "main",
            targetBranch: "feature/sort-before-owner",
          }),
        }),
      );
    });

    it("rejects a spec that conflicts with an existing source-id-less work item's target branch", async () => {
      const specDir = "/fixtures/duplicate-branch-7/docs/work-items";
      registerSpecDir(specDir, {
        "orphan-spec.md": [
          "---",
          "item_id: orphan-spec",
          "title: Orphan spec",
          "priority: p1",
          "scope: standard",
          "status: todo",
          "target_branch: feature/source-less-owner",
          "---",
          "Orphan spec body.",
        ].join("\n"),
      });

      workItems.listWorkItems.mockResolvedValue([
        {
          id: "wi-source-less-owner",
          status: "in-progress",
          executionConfig: { targetBranch: "feature/source-less-owner" },
          metadata: {
            sourceHash: "old-hash",
          },
        },
      ]);

      const result = await tool.execute(noContext, {
        project_id: "project-1",
        spec_directory: specDir,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("completed_with_errors");
      expect(result.errored_count).toBe(1);
      expect(Array.isArray(result.errors)).toBe(true);
      const [error] = result.errors as Record<string, unknown>[];
      expect(error.source_path).toEqual(expect.stringContaining("orphan-spec"));
      expect(error.message).toContain("feature/source-less-owner");
      expect(error.message).toContain("wi-source-less-owner");
      expect(workItems.createWorkItem).not.toHaveBeenCalled();
    });
  });

  it("returns full summary with all count fields", async () => {
    const specDir = "/fixtures/full-summary-workspace/docs/work-items";
    registerSpecDir(specDir, {
      "a.md": [
        "---",
        "item_id: a",
        "title: Item A",
        "priority: p2",
        "scope: standard",
        "---",
        "Body A.",
      ].join("\n"),
    });

    workItems.createWorkItem.mockResolvedValue({ id: "wi-a" });

    const result = await tool.execute(noContext, {
      project_id: "project-1",
      spec_directory: specDir,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      project_id: "project-1",
      spec_directory: specDir,
      spec_count: 1,
      created_count: 1,
      updated_count: 0,
      unchanged_count: 0,
      archived_count: 0,
      errored_count: 0,
      skipped_count: 0,
      errors: [],
    });
  });
});
