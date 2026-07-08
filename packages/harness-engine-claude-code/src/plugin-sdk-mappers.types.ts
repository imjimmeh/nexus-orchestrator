/**
 * A single file to be staged by the engine for a plugin.
 * `path` is rooted at the plugin's `rootFor` directory — i.e. it begins with
 * the absolute plugin root returned by the engine-supplied `rootFor` callback
 * (e.g. `/session/plugins/my-plugin/.claude-plugin/plugin.json`).
 */
export interface PluginStagedFile {
  /** Absolute path rooted at the plugin's `rootFor` directory (e.g. `/session/plugins/my-plugin/.claude-plugin/plugin.json`). */
  path: string;
  /** File contents as a UTF-8 string (JSON for manifest / config files). */
  contents: string;
}

/**
 * The SDK plugin config entry that the engine passes via `options.plugins`.
 * Mirrors `SdkPluginConfig` from `@anthropic-ai/claude-agent-sdk` but defined
 * locally so the pure mapper has no runtime SDK import.
 */
export interface SdkPluginConfigEntry {
  type: "local";
  /** Absolute path to the materialized plugin root directory. */
  path: string;
}

/**
 * The result of `mapPluginsToNativeArtifact`. Carries both the files the engine
 * must stage and the query-option fragment to spread into `sdk.query({ options })`.
 *
 * Empty plugin list ⇒ `{ files: [], pluginOption: {} }` — spreading `pluginOption`
 * into the SDK options is a strict no-op in the empty case.
 */
export type PluginNativeArtifact =
  | {
      files: [];
      pluginOption: Record<string, never>;
    }
  | {
      files: PluginStagedFile[];
      pluginOption: { plugins: SdkPluginConfigEntry[] };
    };

/**
 * Options accepted by `mapPluginsToNativeArtifact`.
 *
 * `rootFor` is a callback so the pure mapper stays filesystem-free: the engine
 * (Task 3) resolves the absolute staging path for each plugin and passes this
 * factory function in at call-time.
 *
 * `resolvedMcpServers` carries the fully-resolved MCP descriptors that were
 * pre-fetched API-side from the plugins' `mcpServerRefs`. The mapper correlates
 * them by `id` against each plugin's `capabilities.mcpServerRefs` list.
 * Never logged — descriptors may carry resolved secret env/header values.
 */
export interface MapPluginsOptions {
  /** Returns the absolute plugin root path for a given plugin (engine-supplied). */
  rootFor?: (plugin: { id: string; name: string }) => string;
  /** Pre-resolved MCP descriptors for all plugins in the batch. */
  resolvedMcpServers?: import("@nexus/core").ResolvedMcpServerDescriptor[];
}
