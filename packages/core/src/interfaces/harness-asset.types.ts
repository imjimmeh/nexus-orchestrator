import type { HarnessHookEvent } from "./harness-contributions.types";

/**
 * Discriminant for `HarnessAssetSource`. Extracted as a named type so that
 * capability fields (e.g. `HarnessCapabilities.supportedAssetSources`) can
 * reference it without duplicating the string union.
 */
export type HarnessAssetSourceKind = "authored" | "git" | "registry";

/**
 * Describes where a harness asset (extension, plugin) originates.
 *
 * - `authored` — the asset lives baked into the running container image.
 * - `git` — the asset is fetched from a git repository at a specific ref.
 * - `registry` — the asset is published in the Nexus plugin registry.
 */
export type HarnessAssetSource =
  | { kind: "authored" }
  | { kind: "git"; repo: string; ref: string; subdir?: string }
  | { kind: "registry"; name: string; version: string };

/**
 * A hook asset contributed by a plugin or extension. Unlike the simple
 * command-string shape from EPIC-210, an asset may carry either an inline
 * script body (for `authored`/`git` sources) or a command string (for hooks
 * whose binary is baked into the container). Exactly one of `script` or
 * `command` must be present.
 */
export type HarnessHookAsset = {
  event: HarnessHookEvent;
  /** Optional tool-name / glob matcher (e.g. pre_tool_use on "bash"). */
  matcher?: string;
  /** Hard ceiling in ms; engines clamp to their own max. */
  timeoutMs?: number;
} & (
  | { script: { language: "bash" | "node" | "python"; source: string } }
  | { command: string }
);

/** A PI-native extension asset (NOT an MCP server). */
export interface HarnessExtensionAsset {
  id: string;
  name: string;
  /** Module runtime the harness uses to load the extension. */
  runtime: "ts-module" | "package";
  /** Entry point path relative to the asset root. */
  entry: string;
  source: HarnessAssetSource;
  checksum: string;
  /**
   * The raw bundle string as stored in `harness_assets.bundle`.
   *
   * Populated by the hydration projection (`entityToExtension`) so the engine
   * staging path can re-verify `computeAssetChecksum(bundle) === checksum`
   * immediately before writing any files (defense-in-depth, engine-side).
   *
   * Never logged — callers treat this as opaque bytes.
   */
  bundle?: string;
  /**
   * The TypeScript module source code for `ts-module` extensions.
   *
   * Populated by the hydration projection (`entityToExtension`) from the
   * `moduleSource` field stored in `harness_assets.bundle`. Absent when the
   * bundle did not include module source (e.g. pre-EPIC-211 rows, or
   * `package`-runtime assets where source staging is deferred).
   *
   * Never logged — callers treat this as opaque bytes to write to disk.
   */
  moduleSource?: string;
}

/**
 * A self-contained plugin that can contribute hooks, slash commands, subagents,
 * and MCP server references into the Nexus runtime.
 *
 * MCP servers are registered through `apps/api/src/mcp` (the existing runtime
 * manager + DB entity). `mcpServerRefs` contains ids into that registry rather
 * than inline MCP server definitions.
 */
export interface HarnessPlugin {
  id: string;
  name: string;
  version: string;
  source: HarnessAssetSource;
  checksum: string;
  /**
   * The raw bundle string as stored in `harness_assets.bundle`.
   *
   * Populated by the hydration projection (`entityToPlugin`) so the engine
   * staging path can re-verify `computeAssetChecksum(bundle) === checksum`
   * immediately before writing plugin files (defense-in-depth, engine-side).
   *
   * Never logged — callers treat this as opaque bytes.
   */
  bundle?: string;
  capabilities: {
    hooks?: HarnessHookAsset[];
    slashCommands?: string[];
    subagents?: string[];
    /** IDs into `apps/api/src/mcp` — not inline MCP server definitions. */
    mcpServerRefs?: string[];
  };
  manifest: Record<string, unknown>;
}
