import { execFile } from "node:child_process";
import type {
  HarnessHookEvent,
  HarnessHookAsset,
  HarnessSettingsContribution,
  HarnessContributions,
} from "@nexus/core";
import { resolveHookCommand } from "@nexus/harness-runtime";
import type { ContributionQueryFragments } from "./contribution-sdk-mappers.types.js";

export type { ContributionQueryFragments } from "./contribution-sdk-mappers.types.js";

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;
export const MAX_HOOK_TIMEOUT_MS = 600_000;

/** Neutral hook event → Claude Code SDK HookEvent name. */
export const SDK_HOOK_EVENT_BY_NEUTRAL: Record<HarnessHookEvent, string> = {
  session_start: "SessionStart",
  session_end: "SessionEnd",
  pre_tool_use: "PreToolUse",
  post_tool_use: "PostToolUse",
  user_prompt_submit: "UserPromptSubmit",
};

/**
 * Run an author-provided hook command, bounded by timeout. Output is discarded
 * (never logged) so a hook that echoes a secret cannot leak it into run logs.
 * A non-zero exit / timeout is swallowed: an author hook must not crash the run.
 */
export function runHookCommand(
  command: string,
  timeoutMs: number,
): Promise<void> {
  const bounded = Math.min(Math.max(timeoutMs, 1), MAX_HOOK_TIMEOUT_MS);
  return new Promise((resolve) => {
    execFile(
      process.env["SHELL"] ?? "/bin/sh",
      ["-c", command],
      { timeout: bounded },
      () => {
        resolve();
      },
    );
  });
}

/** Build the SDK `options.hooks` structure from canonical hook assets. */
export function toSdkHooks(
  hooks: HarnessHookAsset[],
): Record<string, unknown> | undefined {
  if (hooks.length === 0) return undefined;
  const out: Record<string, Array<{ matcher?: string; hooks: unknown[] }>> = {};
  for (const hook of hooks) {
    const sdkEvent = SDK_HOOK_EVENT_BY_NEUTRAL[hook.event];
    const command = resolveHookCommand(hook);
    const callback = async (): Promise<{ continue: true }> => {
      await runHookCommand(command, hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS);
      return { continue: true };
    };
    (out[sdkEvent] ??= []).push({
      ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}),
      hooks: [callback],
    });
  }
  return out;
}

/**
 * Build the SDK `options.mcpServers` record from contribution extensions.
 *
 * NOTE (Task 5): `HarnessExtensionAsset` entries are PI-native module extensions
 * (not inline MCP server descriptors). MCP server connectivity is now driven by
 * `mcpServerRefs` inside `HarnessPlugin.capabilities` and resolved through
 * `apps/api/src/mcp`. This function returns `undefined` until Task 5 wires up
 * the plugin MCP reference resolver.
 */
export function toSdkMcpServers(
  _exts: HarnessContributions["extensions"],
): Record<string, unknown> | undefined {
  // MCP connectivity deferred to Task 5 (mcpServerRefs → api/src/mcp resolution).
  return undefined;
}

/** Split a settings contribution into an inline SDK Settings object + env patch. */
export function toSdkSettings(s: HarnessSettingsContribution): {
  settings?: Record<string, unknown>;
  env?: Record<string, string>;
} {
  const settings: Record<string, unknown> = {};
  if (s.permissions !== undefined) settings.permissions = s.permissions;
  if (s.outputStyle !== undefined) settings.outputStyle = s.outputStyle;
  return {
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
    ...(s.env && Object.keys(s.env).length > 0 ? { env: s.env } : {}),
  };
}

/**
 * Resolve all SDK query-option fragments from a contributions bundle in one
 * pass. Keeps the engine's `createSession` free of contribution-specific
 * branching (and within its complexity budget). For `EMPTY_HARNESS_CONTRIBUTIONS`
 * this returns `{ mcpServers: {}, envPatch: {} }` — spreading it adds nothing.
 */
export function deriveContributionQueryFragments(
  contributions: HarnessContributions,
): ContributionQueryFragments {
  const { settings, env } = toSdkSettings(contributions.settings);
  const hooks = toSdkHooks(contributions.hooks);
  return {
    mcpServers: toSdkMcpServers(contributions.extensions) ?? {},
    envPatch: env ?? {},
    optionalOptions: {
      ...(hooks ? { hooks } : {}),
      ...(settings ? { settings } : {}),
    },
  };
}
