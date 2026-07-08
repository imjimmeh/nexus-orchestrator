import type {
  HarnessExtensionAsset,
  HarnessHookAsset,
  HarnessPlugin,
} from "./harness-asset.types";

export type {
  HarnessHookAsset,
  HarnessExtensionAsset,
  HarnessPlugin,
} from "./harness-asset.types";

/** Neutral lifecycle events; mapped to each harness's native event names. */
export type HarnessHookEvent =
  | "session_start"
  | "session_end"
  | "pre_tool_use"
  | "post_tool_use"
  | "user_prompt_submit";

/** Allowlisted settings only — NOT an arbitrary passthrough. */
export interface HarnessSettingsContribution {
  env?: Record<string, string>;
  permissions?: { allow?: string[]; deny?: string[] };
  outputStyle?: string;
}

/**
 * Resolved MCP server descriptor produced by the API resolver and consumed by
 * harness engines (e.g. PI) that have no native MCP client. The engine uses
 * this to connect to each server and bridge its tools as governed tools.
 *
 * Secret resolution is performed API-side before the descriptor is emitted:
 * `env` and `headers` already contain the fully-resolved values (plaintext
 * merged with any secret-store values, secret taking precedence on key
 * collision). The engine receives ready-to-use maps and MUST NOT log them.
 */
export interface ResolvedMcpServerDescriptor {
  /** The MCP server's UUID in the `mcp_servers` table. */
  id: string;
  /** Human-readable name; used for logging and tool-name namespacing. */
  name: string;
  /** Transport protocol: stdio child-process or HTTP JSON-RPC. */
  transportType: "stdio" | "http";
  /** Stdio: the executable command. */
  command?: string;
  /** Stdio: command arguments. */
  args?: string[];
  /** HTTP: the server URL. */
  url?: string;
  /**
   * Fully-resolved environment variables for a stdio server. Both plaintext
   * and secret-sourced values are merged here by the API resolver (secret
   * values take precedence on key collision). Never logged.
   */
  env?: Record<string, string>;
  /**
   * Fully-resolved HTTP request headers. Both plaintext and secret-sourced
   * values are merged here by the API resolver (secret values take precedence
   * on key collision). Never logged.
   */
  headers?: Record<string, string>;
  /**
   * Allowlist of tool names to expose from this server. `undefined` means
   * expose all tools discovered from the server.
   */
  includeTools?: string[];
  /**
   * Denylist of tool names to suppress from this server. Applied after
   * `includeTools` when both are set.
   */
  excludeTools?: string[];
  /** Per-call timeout in milliseconds. */
  timeoutMs: number;
  /** Connection-establishment timeout in milliseconds. */
  connectTimeoutMs: number;
}

/** The resolved, capability-validated bundle handed to the kernel. */
export interface HarnessContributions {
  hooks: HarnessHookAsset[];
  extensions: HarnessExtensionAsset[];
  plugins: HarnessPlugin[];
  settings: HarnessSettingsContribution;
  /**
   * MCP server descriptors resolved from `plugins[*].capabilities.mcpServerRefs`.
   * Populated server-side by the harness contribution resolver and consumed
   * engine-side by engines that need to bridge MCP tools into their tool surface
   * (e.g. PI, which has no native MCP client).
   */
  resolvedMcpServers?: ResolvedMcpServerDescriptor[];
}

export const EMPTY_HARNESS_CONTRIBUTIONS: HarnessContributions = {
  hooks: [],
  extensions: [],
  plugins: [],
  settings: {},
};
