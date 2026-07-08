/**
 * Tests for host-mount scope guard logic.
 *
 * Covers both the manifest reader and the tool execute-level guards that
 * prevent agents from reading/writing outside their declared host mount scopes.
 *
 * Ported from the pi-runner host-mount-guards regression suite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  readHostMountScopeManifest,
  applyHostMountScopeGuards,
} from "../../src/tools/host-mount-scope.js";
import type { HostMountScopeBinding } from "../../src/tools/host-mount-scope.types.js";

// ---------------------------------------------------------------------------
// fs mock — hoisted so vi.mock factory can reference them
// ---------------------------------------------------------------------------

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBinding(
  overrides: Partial<HostMountScopeBinding> = {},
): HostMountScopeBinding {
  return {
    alias: "my-repo",
    hostPath: "/host/projects/my-repo",
    containerPath: "/workspace/host-shares/my-repo",
    mode: "ro",
    readOnly: true,
    ...overrides,
  };
}

function makeTool(name: string) {
  const execute = vi.fn(
    async (_callId: string, _params: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: "ok" }],
    }),
  );
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: "object" as const, properties: {} },
    execute,
  };
}

const HOST_SHARES = "/workspace/host-shares";

// ---------------------------------------------------------------------------
// readHostMountScopeManifest
// ---------------------------------------------------------------------------

describe("readHostMountScopeManifest", () => {
  it("returns empty array when the manifest file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(readHostMountScopeManifest("/opt/extensions")).toEqual([]);
  });

  it("returns parsed bindings when the manifest is valid", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        {
          alias: "my-repo",
          hostPath: "/host/projects/my-repo",
          containerPath: "/workspace/host-shares/my-repo",
          mode: "ro",
        },
      ]),
    );

    const bindings = readHostMountScopeManifest("/opt/extensions");

    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      alias: "my-repo",
      hostPath: "/host/projects/my-repo",
      containerPath: "/workspace/host-shares/my-repo",
      readOnly: true,
    });
  });

  it("returns empty array when the file contains invalid JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not-json{{{");
    expect(readHostMountScopeManifest("/opt/extensions")).toEqual([]);
  });

  it("filters out bindings with missing required fields", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        {
          alias: "ok",
          hostPath: "/host/ok",
          containerPath: "/workspace/host-shares/ok",
        },
        { alias: "no-host", containerPath: "/workspace/host-shares/nope" }, // missing hostPath
        { hostPath: "/host/x", containerPath: "/workspace/host-shares/x" }, // missing alias
      ]),
    );

    const bindings = readHostMountScopeManifest("/opt/extensions");
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.alias).toBe("ok");
  });

  it("infers readOnly=true from mode='ro'", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        {
          alias: "a",
          hostPath: "/h/a",
          containerPath: "/workspace/host-shares/a",
          mode: "ro",
        },
      ]),
    );
    expect(readHostMountScopeManifest("/opt/extensions")[0]?.readOnly).toBe(
      true,
    );
  });

  it("infers readOnly=false from mode='rw'", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        {
          alias: "a",
          hostPath: "/h/a",
          containerPath: "/workspace/host-shares/a",
          mode: "rw",
        },
      ]),
    );
    expect(readHostMountScopeManifest("/opt/extensions")[0]?.readOnly).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// applyHostMountScopeGuards
// ---------------------------------------------------------------------------

describe("applyHostMountScopeGuards", () => {
  const cwd = "/workspace";

  it("returns tools unchanged when there are no scope bindings", async () => {
    const tool = makeTool("read");
    const guarded = applyHostMountScopeGuards({
      codingTools: [tool],
      cwd,
      scopeBindings: [],
    });
    const [guardedTool] = guarded;
    await guardedTool.execute("c1", { path: `${HOST_SHARES}/any/file.txt` });
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("allows reads to paths outside the host share root", async () => {
    const tool = makeTool("read");
    const binding = makeBinding();
    const guarded = applyHostMountScopeGuards({
      codingTools: [tool],
      cwd,
      scopeBindings: [binding],
    });
    const [guardedTool] = guarded;

    // /workspace/src is NOT under /workspace/host-shares
    await guardedTool.execute("c1", { path: "/workspace/src/app.ts" });
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("allows reads to a path within a bound scope", async () => {
    const tool = makeTool("read");
    const binding = makeBinding({ containerPath: `${HOST_SHARES}/my-repo` });
    const guarded = applyHostMountScopeGuards({
      codingTools: [tool],
      cwd,
      scopeBindings: [binding],
    });
    const [guardedTool] = guarded;

    await guardedTool.execute("c1", {
      path: `${HOST_SHARES}/my-repo/src/index.ts`,
    });
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("denies reads to a path inside host share root but outside any binding", async () => {
    const tool = makeTool("read");
    const binding = makeBinding({ containerPath: `${HOST_SHARES}/my-repo` });
    const guarded = applyHostMountScopeGuards({
      codingTools: [tool],
      cwd,
      scopeBindings: [binding],
    });
    const [guardedTool] = guarded;

    await expect(
      guardedTool.execute("c1", {
        path: `${HOST_SHARES}/other-repo/secret.ts`,
      }),
    ).rejects.toThrow(/outside approved host mount scope/);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("denies writes to a read-only bound scope", async () => {
    const tool = makeTool("write");
    const binding = makeBinding({
      containerPath: `${HOST_SHARES}/my-repo`,
      readOnly: true,
      mode: "ro",
    });
    const guarded = applyHostMountScopeGuards({
      codingTools: [tool],
      cwd,
      scopeBindings: [binding],
    });
    const [guardedTool] = guarded;

    await expect(
      guardedTool.execute("c1", {
        file_path: `${HOST_SHARES}/my-repo/output.txt`,
      }),
    ).rejects.toThrow(/read-only/);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("allows writes to a read-write bound scope", async () => {
    const tool = makeTool("write");
    const binding = makeBinding({
      containerPath: `${HOST_SHARES}/artifacts`,
      readOnly: false,
      mode: "rw",
    });
    const guarded = applyHostMountScopeGuards({
      codingTools: [tool],
      cwd,
      scopeBindings: [binding],
    });
    const [guardedTool] = guarded;

    await guardedTool.execute("c1", {
      file_path: `${HOST_SHARES}/artifacts/output.txt`,
    });
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("denies recursive read tools (find) when path can traverse the host share root", async () => {
    const tool = makeTool("find");
    const binding = makeBinding({ containerPath: `${HOST_SHARES}/my-repo` });
    const guarded = applyHostMountScopeGuards({
      codingTools: [tool],
      cwd,
      scopeBindings: [binding],
    });
    const [guardedTool] = guarded;

    // /workspace is an ancestor of /workspace/host-shares — find from here could traverse all scopes
    await expect(
      guardedTool.execute("c1", { path: "/workspace" }),
    ).rejects.toThrow(/traverse host mount scopes/);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("allows recursive read tools with path confined within a bound scope", async () => {
    const tool = makeTool("grep");
    const binding = makeBinding({ containerPath: `${HOST_SHARES}/my-repo` });
    const guarded = applyHostMountScopeGuards({
      codingTools: [tool],
      cwd,
      scopeBindings: [binding],
    });
    const [guardedTool] = guarded;

    await guardedTool.execute("c1", { path: `${HOST_SHARES}/my-repo/src` });
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("applies the most specific binding when multiple scopes match", async () => {
    const tool = makeTool("write");
    const bindings: HostMountScopeBinding[] = [
      makeBinding({
        containerPath: `${HOST_SHARES}/my-repo`,
        readOnly: true,
        mode: "ro",
      }),
      makeBinding({
        containerPath: `${HOST_SHARES}/my-repo/output`,
        readOnly: false,
        mode: "rw",
      }),
    ];
    const guarded = applyHostMountScopeGuards({
      codingTools: [tool],
      cwd,
      scopeBindings: bindings,
    });
    const [guardedTool] = guarded;

    // The more specific rw binding should match, allowing the write
    await guardedTool.execute("c1", {
      file_path: `${HOST_SHARES}/my-repo/output/result.txt`,
    });
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("does not guard tools that do not operate on paths", async () => {
    const tool = makeTool("bash");
    const binding = makeBinding();
    const guarded = applyHostMountScopeGuards({
      codingTools: [tool],
      cwd,
      scopeBindings: [binding],
    });
    const [guardedTool] = guarded;

    // bash is not in READ_HOST_MOUNT_TOOL_NAMES or WRITE_HOST_MOUNT_TOOL_NAMES
    await guardedTool.execute("c1", { command: "ls" });
    expect(tool.execute).toHaveBeenCalledOnce();
  });
});
