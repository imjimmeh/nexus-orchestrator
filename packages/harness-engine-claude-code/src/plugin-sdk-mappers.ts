import { posix as pathPosix } from "node:path";
import type { HarnessPlugin, ResolvedMcpServerDescriptor } from "@nexus/core";
import { resolveHookCommand } from "@nexus/harness-runtime";
import { SDK_HOOK_EVENT_BY_NEUTRAL } from "./contribution-sdk-mappers.js";
import type {
  MapPluginsOptions,
  PluginNativeArtifact,
  PluginStagedFile,
  SdkPluginConfigEntry,
} from "./plugin-sdk-mappers.types.js";

export type {
  MapPluginsOptions,
  PluginNativeArtifact,
  PluginStagedFile,
  SdkPluginConfigEntry,
} from "./plugin-sdk-mappers.types.js";

/**
 * Map a single plugin's hook assets to the `hooks/hooks.json` content in the
 * Settings hooks shape that the Claude Code SDK auto-loads from the plugin root.
 *
 * Reuses `SDK_HOOK_EVENT_BY_NEUTRAL` and `resolveHookCommand` from EPIC-210 so
 * the neutral→SDK event translation and script/command resolution stay DRY.
 *
 * Returns `undefined` when the plugin has no hooks (no file should be staged).
 */
function buildHooksJson(plugin: HarnessPlugin): string | undefined {
  const hooks = plugin.capabilities.hooks;
  if (!hooks || hooks.length === 0) return undefined;

  const out: Record<
    string,
    Array<{
      matcher?: string;
      hooks: Array<{ type: "command"; command: string }>;
    }>
  > = {};

  for (const hook of hooks) {
    const sdkEvent = SDK_HOOK_EVENT_BY_NEUTRAL[hook.event];
    const command = resolveHookCommand(hook);
    const entry = out[sdkEvent] ?? [];
    entry.push({
      ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}),
      hooks: [{ type: "command", command }],
    });
    out[sdkEvent] = entry;
  }

  return JSON.stringify(out, null, 2);
}

/**
 * Derive the `plugin.json` manifest contents for a plugin. Merges the stored
 * `plugin.manifest` (which may carry optional fields) with the required `name`
 * field — the plugin's `name` property is the authoritative value.
 */
function buildPluginJson(plugin: HarnessPlugin): string {
  const manifest = { ...plugin.manifest, name: plugin.name };
  return JSON.stringify(manifest, null, 2);
}

/**
 * Map a `ResolvedMcpServerDescriptor` (stdio transport) to the serializable
 * SDK `McpStdioServerConfig`-compatible shape for embedding in `.mcp.json`.
 *
 * Only properties with defined values are included so the JSON stays minimal.
 * Secret env values are data here (written to a plugin-scoped file), not logs —
 * callers must never log the `.mcp.json` contents.
 */
function descriptorToStdioConfig(
  d: ResolvedMcpServerDescriptor,
): Record<string, unknown> {
  return {
    command: d.command ?? "",
    ...(d.args !== undefined ? { args: d.args } : {}),
    ...(d.env !== undefined ? { env: d.env } : {}),
    ...(d.timeoutMs !== undefined ? { timeout: d.timeoutMs } : {}),
  };
}

/**
 * Map a `ResolvedMcpServerDescriptor` (HTTP transport) to the serializable
 * SDK `McpHttpServerConfig`-compatible shape for embedding in `.mcp.json`.
 */
function descriptorToHttpConfig(
  d: ResolvedMcpServerDescriptor,
): Record<string, unknown> {
  return {
    type: "http" as const,
    url: d.url ?? "",
    ...(d.headers !== undefined ? { headers: d.headers } : {}),
    ...(d.timeoutMs !== undefined ? { timeout: d.timeoutMs } : {}),
  };
}

/**
 * Build the `.mcp.json` content for a plugin whose `mcpServerRefs` resolve to
 * one or more `ResolvedMcpServerDescriptor` entries. The file is placed at the
 * plugin root so the SDK plugin loader auto-merges it alongside `mcpServers` in
 * `plugin.json`.
 *
 * Plugin MCP servers are NOT threaded through `options.mcpServers` — they live
 * in the plugin manifest/`.mcp.json` form and are merged by the SDK loader.
 * `strictMcpConfig` must remain OFF for them to surface (engine invariant).
 *
 * Returns `undefined` when the plugin has no applicable refs (no file staged).
 */
function buildMcpJson(
  plugin: HarnessPlugin,
  allDescriptors: ResolvedMcpServerDescriptor[],
): string | undefined {
  const refs = plugin.capabilities.mcpServerRefs;
  if (!refs || refs.length === 0) return undefined;

  const refSet = new Set(refs);
  const matching = allDescriptors.filter((d) => refSet.has(d.id));
  if (matching.length === 0) return undefined;

  const mcpServers: Record<string, unknown> = {};
  for (const d of matching) {
    mcpServers[d.name] =
      d.transportType === "http"
        ? descriptorToHttpConfig(d)
        : descriptorToStdioConfig(d);
  }

  return JSON.stringify({ mcpServers }, null, 2);
}

/**
 * Build the staged file list for a single plugin. File paths are relative to
 * the per-plugin root (not yet qualified with the root directory):
 *
 * - `.claude-plugin/plugin.json` — manifest (always emitted; `name` required).
 * - `hooks/hooks.json` — Settings hooks shape (omitted when no hooks authored).
 * - `.mcp.json` — plugin-scoped MCP server config (omitted when no MCP refs).
 *
 * Callers are responsible for qualifying each returned path with the plugin's
 * `rootFor` directory before placing them into the flat `files` list.
 */
function buildPluginFiles(
  plugin: HarnessPlugin,
  resolvedMcpServers: ResolvedMcpServerDescriptor[],
): PluginStagedFile[] {
  const files: PluginStagedFile[] = [];

  files.push({
    path: ".claude-plugin/plugin.json",
    contents: buildPluginJson(plugin),
  });

  const hooksJson = buildHooksJson(plugin);
  if (hooksJson !== undefined) {
    files.push({ path: "hooks/hooks.json", contents: hooksJson });
  }

  const mcpJson = buildMcpJson(plugin, resolvedMcpServers);
  if (mcpJson !== undefined) {
    files.push({ path: ".mcp.json", contents: mcpJson });
  }

  return files;
}

/**
 * Pure mapper: `HarnessPlugin[]` → `PluginNativeArtifact`.
 *
 * Produces the set of files to stage per plugin plus the `sdk.query` option
 * fragment `{ plugins: [{ type:"local", path }] }` that the engine spreads
 * alongside existing EPIC-210 contribution options.
 *
 * **Empty plugins list ⇒ `{ files: [], pluginOption: {} }`** — spreading the
 * result into the engine's option assembly is a strict no-op in the empty case,
 * preserving byte-identical behavior for sessions with no plugins configured.
 *
 * This function is intentionally side-effect-free: no filesystem I/O, no SDK
 * invocations, no network calls. Task 3 performs the actual staging and wires
 * the resulting `pluginOption` into `sdk.query`.
 *
 * @param plugins - The resolved plugin list from `HarnessContributions.plugins`.
 * @param opts - Engine-supplied callbacks and pre-resolved MCP descriptors.
 */
export function mapPluginsToNativeArtifact(
  plugins: HarnessPlugin[],
  opts?: MapPluginsOptions,
): PluginNativeArtifact {
  if (plugins.length === 0) {
    return { files: [], pluginOption: {} };
  }

  const resolvedMcpServers = opts?.resolvedMcpServers ?? [];
  const rootFor = opts?.rootFor ?? ((p) => p.name);

  const files: PluginStagedFile[] = [];
  const pluginEntries: SdkPluginConfigEntry[] = [];

  for (const plugin of plugins) {
    const pluginRoot = rootFor(plugin);
    const pluginFiles = buildPluginFiles(plugin, resolvedMcpServers).map(
      (f) => ({ ...f, path: pathPosix.join(pluginRoot, f.path) }),
    );
    files.push(...pluginFiles);
    pluginEntries.push({ type: "local", path: pluginRoot });
  }

  return { files, pluginOption: { plugins: pluginEntries } };
}
