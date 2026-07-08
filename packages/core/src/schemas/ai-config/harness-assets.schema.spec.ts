import { describe, it, expect } from "vitest";
import {
  HarnessHookAssetSchema,
  HarnessExtensionAssetSchema,
  HarnessPluginSchema,
  HarnessAssetSourceSchema,
} from "./harness-assets.schema";

describe("HarnessAssetSourceSchema", () => {
  it("accepts an authored source", () => {
    expect(() =>
      HarnessAssetSourceSchema.parse({ kind: "authored" }),
    ).not.toThrow();
  });

  it("accepts a git source with repo + ref", () => {
    expect(() =>
      HarnessAssetSourceSchema.parse({
        kind: "git",
        repo: "https://github.com/org/repo",
        ref: "main",
        subdir: "packages/my-plugin",
      }),
    ).not.toThrow();
  });

  it("rejects a git source missing repo", () => {
    expect(() =>
      HarnessAssetSourceSchema.parse({ kind: "git", ref: "main" }),
    ).toThrow();
  });

  it("rejects a git source missing ref", () => {
    expect(() =>
      HarnessAssetSourceSchema.parse({
        kind: "git",
        repo: "https://github.com/org/repo",
      }),
    ).toThrow();
  });

  it("accepts a registry source with name + version", () => {
    expect(() =>
      HarnessAssetSourceSchema.parse({
        kind: "registry",
        name: "my-plugin",
        version: "1.2.3",
      }),
    ).not.toThrow();
  });
});

describe("HarnessHookAssetSchema", () => {
  it("accepts a valid authored hook-script asset", () => {
    expect(() =>
      HarnessHookAssetSchema.parse({
        event: "session_start",
        script: { language: "bash", source: "echo hello" },
      }),
    ).not.toThrow();
  });

  it("accepts a hook with a command string", () => {
    expect(() =>
      HarnessHookAssetSchema.parse({
        event: "pre_tool_use",
        matcher: "Bash",
        command: "my-lint-check",
        timeoutMs: 5000,
      }),
    ).not.toThrow();
  });

  it("rejects a hook with neither script nor command", () => {
    const result = HarnessHookAssetSchema.safeParse({
      event: "session_start",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a hook with both script and command", () => {
    const result = HarnessHookAssetSchema.safeParse({
      event: "session_start",
      script: { language: "bash", source: "echo hi" },
      command: "also-run-this",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown hook event", () => {
    expect(() =>
      HarnessHookAssetSchema.parse({
        event: "unknown_event",
        command: "x",
      }),
    ).toThrow();
  });
});

describe("HarnessExtensionAssetSchema", () => {
  it("accepts a valid extension asset", () => {
    expect(() =>
      HarnessExtensionAssetSchema.parse({
        id: "ext-001",
        name: "My Extension",
        runtime: "ts-module",
        entry: "./dist/index.js",
        source: { kind: "authored" },
        checksum: "sha256:abc123",
      }),
    ).not.toThrow();
  });

  it("rejects an extension asset missing entry", () => {
    expect(() =>
      HarnessExtensionAssetSchema.parse({
        id: "ext-001",
        name: "My Extension",
        runtime: "ts-module",
        source: { kind: "authored" },
        checksum: "sha256:abc123",
      }),
    ).toThrow();
  });

  it("rejects an extension asset missing runtime", () => {
    expect(() =>
      HarnessExtensionAssetSchema.parse({
        id: "ext-001",
        name: "My Extension",
        entry: "./dist/index.js",
        source: { kind: "authored" },
        checksum: "sha256:abc123",
      }),
    ).toThrow();
  });

  it("rejects an unknown runtime value", () => {
    expect(() =>
      HarnessExtensionAssetSchema.parse({
        id: "ext-001",
        name: "My Extension",
        runtime: "wasm",
        entry: "./dist/index.js",
        source: { kind: "authored" },
        checksum: "sha256:abc123",
      }),
    ).toThrow();
  });
});

describe("HarnessPluginSchema", () => {
  it("accepts a plugin with mcpServerRefs", () => {
    expect(() =>
      HarnessPluginSchema.parse({
        id: "plugin-001",
        name: "My Plugin",
        version: "1.0.0",
        source: { kind: "registry", name: "my-plugin", version: "1.0.0" },
        checksum: "sha256:def456",
        capabilities: {
          mcpServerRefs: ["mcp-server-001", "mcp-server-002"],
        },
        manifest: { author: "Acme Corp" },
      }),
    ).not.toThrow();
  });

  it("accepts a plugin with hooks, slashCommands, and subagents capabilities", () => {
    expect(() =>
      HarnessPluginSchema.parse({
        id: "plugin-002",
        name: "Full Plugin",
        version: "2.0.0",
        source: {
          kind: "git",
          repo: "https://github.com/org/plugin",
          ref: "v2.0.0",
        },
        checksum: "sha256:ghi789",
        capabilities: {
          hooks: [{ event: "pre_tool_use", command: "run-lint" }],
          slashCommands: ["/deploy"],
          subagents: ["deploy-agent"],
          mcpServerRefs: [],
        },
        manifest: {},
      }),
    ).not.toThrow();
  });
});
