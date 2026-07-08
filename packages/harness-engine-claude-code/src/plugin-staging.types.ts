/**
 * Types for the plugin staging helpers (`plugin-staging.ts`).
 */

/** Diagnostic emitted when a plugin cannot be staged. */
export interface DroppedPlugin {
  id: string;
  name: string;
  reason: "checksum_mismatch" | "missing_bundle";
}

/** Result of staging plugins for a Claude Code session. */
export interface StagedPlugins {
  /**
   * The option fragment to spread into `sdk.query({ options })`. Empty when no
   * plugins are configured (`{}` — no-op spread keeps options byte-identical).
   */
  pluginOption: Record<string, unknown>;
  /**
   * Plugins that were refused before staging (defense-in-depth checksum mismatch).
   * Never throws — siblings continue staging when one is dropped.
   */
  dropped: DroppedPlugin[];
  /**
   * Removes all staged plugin directories (best-effort, never throws). Must be
   * called on session dispose to clean up the secret-bearing `.mcp.json` files.
   */
  dispose: () => Promise<void>;
}
