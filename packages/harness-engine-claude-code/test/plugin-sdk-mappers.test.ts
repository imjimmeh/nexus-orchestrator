import { describe, it, expect } from "vitest";
import type { HarnessPlugin } from "@nexus/core";
import { mapPluginsToNativeArtifact } from "../src/plugin-sdk-mappers.js";
import type { PluginNativeArtifact } from "../src/plugin-sdk-mappers.types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(overrides: Partial<HarnessPlugin> = {}): HarnessPlugin {
  return {
    id: "plugin-001",
    name: "my-plugin",
    version: "1.0.0",
    source: { kind: "authored" },
    checksum: "sha256:abc",
    capabilities: {},
    manifest: { name: "my-plugin" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Empty-set contract
// ---------------------------------------------------------------------------

describe("mapPluginsToNativeArtifact — empty list", () => {
  it("returns byte-identical empty artifact when no plugins provided", () => {
    const result = mapPluginsToNativeArtifact([]);
    const expected: PluginNativeArtifact = { files: [], pluginOption: {} };
    expect(result).toStrictEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Hook-only plugin
// ---------------------------------------------------------------------------

describe("mapPluginsToNativeArtifact — hook-only plugin", () => {
  const HOOK_PLUGIN_ROOT = "/session/plugins/hook-plugin";

  const plugin = makePlugin({
    name: "hook-plugin",
    manifest: { name: "hook-plugin" },
    capabilities: {
      hooks: [
        { event: "pre_tool_use", matcher: "Bash", command: "echo before" },
        { event: "session_start", command: "echo start" },
      ],
    },
  });

  let result: PluginNativeArtifact;

  it("produces exactly 2 files per hook-only plugin", () => {
    result = mapPluginsToNativeArtifact([plugin], {
      rootFor: () => HOOK_PLUGIN_ROOT,
    });
    // plugin.json + hooks/hooks.json
    expect(result.files).toHaveLength(2);
  });

  it("emits .claude-plugin/plugin.json with name, rooted at plugin root", () => {
    result = mapPluginsToNativeArtifact([plugin], {
      rootFor: () => HOOK_PLUGIN_ROOT,
    });
    const manifestFile = result.files.find(
      (f) => f.path === `${HOOK_PLUGIN_ROOT}/.claude-plugin/plugin.json`,
    );
    expect(manifestFile).toBeDefined();
    const parsed = JSON.parse(manifestFile!.contents) as Record<
      string,
      unknown
    >;
    expect(parsed["name"]).toBe("hook-plugin");
  });

  it("emits hooks/hooks.json in Settings hooks shape, rooted at plugin root", () => {
    result = mapPluginsToNativeArtifact([plugin], {
      rootFor: () => HOOK_PLUGIN_ROOT,
    });
    const hooksFile = result.files.find(
      (f) => f.path === `${HOOK_PLUGIN_ROOT}/hooks/hooks.json`,
    );
    expect(hooksFile).toBeDefined();
    const parsed = JSON.parse(hooksFile!.contents) as Record<string, unknown>;
    // pre_tool_use → PreToolUse, session_start → SessionStart
    expect(parsed).toHaveProperty("PreToolUse");
    expect(parsed).toHaveProperty("SessionStart");
    const preToolUse = parsed["PreToolUse"] as Array<{
      matcher?: string;
      hooks: unknown[];
    }>;
    expect(preToolUse[0].matcher).toBe("Bash");
    // hooks array entries must be {type:"command", command:string}
    const hookEntry = preToolUse[0].hooks[0] as {
      type: string;
      command: string;
    };
    expect(hookEntry.type).toBe("command");
    expect(hookEntry.command).toBe("echo before");
  });

  it("pluginOption.plugins[0] has type:local and the root path", () => {
    result = mapPluginsToNativeArtifact([plugin], {
      rootFor: () => HOOK_PLUGIN_ROOT,
    });
    expect(result.pluginOption).toHaveProperty("plugins");
    const plugins = (result.pluginOption as { plugins: unknown[] }).plugins;
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toStrictEqual({
      type: "local",
      path: HOOK_PLUGIN_ROOT,
    });
  });
});

// ---------------------------------------------------------------------------
// Plugin with MCP server refs → manifest .mcp.json form
// ---------------------------------------------------------------------------

describe("mapPluginsToNativeArtifact — plugin with MCP descriptors", () => {
  const MCP_PLUGIN_ROOT = "/session/plugins/mcp-plugin";

  const plugin = makePlugin({
    name: "mcp-plugin",
    manifest: { name: "mcp-plugin" },
    capabilities: {
      mcpServerRefs: ["srv-001"],
    },
  });

  it("produces plugin.json + .mcp.json (no hooks.json when no hooks)", () => {
    const result = mapPluginsToNativeArtifact([plugin], {
      rootFor: () => MCP_PLUGIN_ROOT,
      resolvedMcpServers: [
        {
          id: "srv-001",
          name: "my-mcp-server",
          transportType: "stdio",
          command: "node",
          args: ["server.js"],
          env: { MY_TOKEN: "secret-value" },
          timeoutMs: 30_000,
          connectTimeoutMs: 5_000,
        },
      ],
    });
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(`${MCP_PLUGIN_ROOT}/.claude-plugin/plugin.json`);
    expect(paths).toContain(`${MCP_PLUGIN_ROOT}/.mcp.json`);
    expect(paths).not.toContain(`${MCP_PLUGIN_ROOT}/hooks/hooks.json`);
  });

  it("maps stdio descriptor into .mcp.json mcpServers record", () => {
    const result = mapPluginsToNativeArtifact([plugin], {
      rootFor: () => MCP_PLUGIN_ROOT,
      resolvedMcpServers: [
        {
          id: "srv-001",
          name: "my-mcp-server",
          transportType: "stdio",
          command: "node",
          args: ["server.js"],
          env: { MY_TOKEN: "secret-value" },
          timeoutMs: 30_000,
          connectTimeoutMs: 5_000,
        },
      ],
    });
    const mcpFile = result.files.find(
      (f) => f.path === `${MCP_PLUGIN_ROOT}/.mcp.json`,
    );
    expect(mcpFile).toBeDefined();
    const parsed = JSON.parse(mcpFile!.contents) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed).toHaveProperty("mcpServers");
    const serverConfig = parsed.mcpServers["my-mcp-server"] as {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    expect(serverConfig).toBeDefined();
    expect(serverConfig.command).toBe("node");
    expect(serverConfig.args).toStrictEqual(["server.js"]);
    expect(serverConfig.env).toStrictEqual({ MY_TOKEN: "secret-value" });
  });

  it("maps http descriptor into .mcp.json mcpServers record", () => {
    const result = mapPluginsToNativeArtifact([plugin], {
      rootFor: () => MCP_PLUGIN_ROOT,
      resolvedMcpServers: [
        {
          id: "srv-001",
          name: "my-http-server",
          transportType: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer tok" },
          timeoutMs: 10_000,
          connectTimeoutMs: 3_000,
        },
      ],
    });
    const mcpFile = result.files.find(
      (f) => f.path === `${MCP_PLUGIN_ROOT}/.mcp.json`,
    );
    expect(mcpFile).toBeDefined();
    const parsed = JSON.parse(mcpFile!.contents) as {
      mcpServers: Record<string, unknown>;
    };
    const serverConfig = parsed.mcpServers["my-http-server"] as {
      type: string;
      url: string;
      headers: Record<string, string>;
    };
    expect(serverConfig.type).toBe("http");
    expect(serverConfig.url).toBe("https://example.com/mcp");
    expect(serverConfig.headers).toStrictEqual({ Authorization: "Bearer tok" });
  });

  it("MCP servers are NOT placed in pluginOption (stays as {type:local,path})", () => {
    const result = mapPluginsToNativeArtifact([plugin], {
      rootFor: () => MCP_PLUGIN_ROOT,
      resolvedMcpServers: [
        {
          id: "srv-001",
          name: "my-mcp-server",
          transportType: "stdio",
          command: "node",
          args: [],
          timeoutMs: 30_000,
          connectTimeoutMs: 5_000,
        },
      ],
    });
    // pluginOption must only contain { plugins: [{type:"local", path}] }
    // NOT mcpServers
    expect(result.pluginOption).not.toHaveProperty("mcpServers");
    expect(result.pluginOption).toHaveProperty("plugins");
  });
});

// ---------------------------------------------------------------------------
// Multiple plugins — path collision regression
// ---------------------------------------------------------------------------

describe("mapPluginsToNativeArtifact — multiple plugins", () => {
  it("emits files and pluginOption entries for each plugin in order", () => {
    const pluginA = makePlugin({
      id: "a",
      name: "plugin-a",
      manifest: { name: "plugin-a" },
    });
    const pluginB = makePlugin({
      id: "b",
      name: "plugin-b",
      manifest: { name: "plugin-b" },
    });

    const result = mapPluginsToNativeArtifact([pluginA, pluginB], {
      rootFor: (p) => `/session/plugins/${p.name}`,
    });

    const sdkPlugins = (
      result.pluginOption as { plugins: Array<{ type: string; path: string }> }
    ).plugins;
    expect(sdkPlugins).toHaveLength(2);
    expect(sdkPlugins[0]).toStrictEqual({
      type: "local",
      path: "/session/plugins/plugin-a",
    });
    expect(sdkPlugins[1]).toStrictEqual({
      type: "local",
      path: "/session/plugins/plugin-b",
    });

    const manifestFiles = result.files.filter((f) =>
      f.path.endsWith(".claude-plugin/plugin.json"),
    );
    expect(
      manifestFiles
        .map((m) => JSON.parse(m.contents) as { name: string })
        .map((m) => m.name),
    ).toStrictEqual(["plugin-a", "plugin-b"]);
  });

  it("produces non-colliding, root-qualified file paths for two plugins", () => {
    // Plugin A has hooks only; Plugin B has MCP refs only.
    // All 3 file types (plugin.json, hooks.json, .mcp.json) have identical
    // relative names — only the rootFor prefix keeps them distinct.
    const pluginA = makePlugin({
      id: "a",
      name: "plugin-a",
      manifest: { name: "plugin-a" },
      capabilities: {
        hooks: [{ event: "session_start", command: "echo pluginA" }],
      },
    });
    const pluginB = makePlugin({
      id: "b",
      name: "plugin-b",
      manifest: { name: "plugin-b" },
      capabilities: {
        mcpServerRefs: ["srv-b"],
      },
    });

    const result = mapPluginsToNativeArtifact([pluginA, pluginB], {
      rootFor: (p) => `/session/plugins/${p.name}`,
      resolvedMcpServers: [
        {
          id: "srv-b",
          name: "b-server",
          transportType: "stdio",
          command: "node",
          args: [],
          timeoutMs: 10_000,
          connectTimeoutMs: 3_000,
        },
      ],
    });

    const allPaths = result.files.map((f) => f.path);

    // All paths must be unique — no collisions
    const uniquePaths = new Set(allPaths);
    expect(uniquePaths.size).toBe(allPaths.length);

    // Plugin A files are rooted under its own directory
    expect(allPaths).toContain(
      "/session/plugins/plugin-a/.claude-plugin/plugin.json",
    );
    expect(allPaths).toContain("/session/plugins/plugin-a/hooks/hooks.json");
    // Plugin B files are rooted under its own directory
    expect(allPaths).toContain(
      "/session/plugins/plugin-b/.claude-plugin/plugin.json",
    );
    expect(allPaths).toContain("/session/plugins/plugin-b/.mcp.json");

    // Plugin A must NOT have any paths starting under plugin-b's root, and vice versa
    const pluginAPaths = allPaths.filter((p) =>
      p.startsWith("/session/plugins/plugin-a/"),
    );
    const pluginBPaths = allPaths.filter((p) =>
      p.startsWith("/session/plugins/plugin-b/"),
    );
    expect(pluginAPaths.length).toBeGreaterThan(0);
    expect(pluginBPaths.length).toBeGreaterThan(0);
    // Paths are partitioned — none appear in both sets
    const intersection = pluginAPaths.filter((p) => pluginBPaths.includes(p));
    expect(intersection).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Script hook asset
// ---------------------------------------------------------------------------

describe("mapPluginsToNativeArtifact — script hook asset", () => {
  it("resolves a script hook to a shell command string in hooks.json", () => {
    const SCRIPT_PLUGIN_ROOT = "/session/plugins/script-hook-plugin";

    const plugin = makePlugin({
      name: "script-hook-plugin",
      manifest: { name: "script-hook-plugin" },
      capabilities: {
        hooks: [
          {
            event: "session_start",
            script: { language: "bash", source: "echo hello" },
          },
        ],
      },
    });

    const result = mapPluginsToNativeArtifact([plugin], {
      rootFor: () => SCRIPT_PLUGIN_ROOT,
    });

    const hooksFile = result.files.find(
      (f) => f.path === `${SCRIPT_PLUGIN_ROOT}/hooks/hooks.json`,
    );
    expect(hooksFile).toBeDefined();
    const parsed = JSON.parse(hooksFile!.contents) as Record<string, unknown>;
    const sessionStart = parsed["SessionStart"] as Array<{
      hooks: Array<{ type: string; command: string }>;
    }>;
    expect(sessionStart[0].hooks[0].type).toBe("command");
    // resolveHookCommand turns bash script into bash -c "<source>"
    expect(sessionStart[0].hooks[0].command).toContain("bash");
    expect(sessionStart[0].hooks[0].command).toContain("echo hello");
  });
});
