/**
 * Tool-name sanitization and CanonicalToolDefinition → PI ToolDefinition
 * adapters, shared by the kernel-governed tools and the bridged MCP tools.
 *
 * Extracted from pi-engine.ts so the per-tool execute/terminate wiring lives in
 * one place (DRY) and the engine module stays within its size budget.
 */

import * as fs from "node:fs";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { HarnessHookAsset } from "@nexus/core";
import type { CanonicalToolDefinition } from "@nexus/harness-runtime";
import { generateHookExtensionSource } from "./contribution-hook-extension.js";
import type { StagedHookKey } from "./contribution-asset-staging.js";
import type { GovernedToolConversionResult } from "./contribution-tool-adapter.types.js";

/**
 * OpenAI-compatible providers (including DeepSeek) require tool names to match
 * this pattern. Dots are common in Nexus capability names (e.g.
 * "kanban.project_state") but are rejected by strict providers, so we sanitize
 * before handing names to the SDK and maintain a mapping to restore original
 * names in telemetry.
 */
const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function sanitizeToolNameForProvider(name: string): string {
  if (PROVIDER_TOOL_NAME_PATTERN.test(name)) return name;

  const sanitized = name
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized.length > 0 ? sanitized : "tool";
}

export function dedupeToolNameMapping(originalNames: string[]): {
  sanitizedToOriginal: Map<string, string>;
  originalToSanitized: Map<string, string>;
} {
  const sanitizedToOriginal = new Map<string, string>();
  const originalToSanitized = new Map<string, string>();
  const seen = new Set<string>();

  for (const original of originalNames) {
    let sanitized = sanitizeToolNameForProvider(original);

    if (seen.has(sanitized)) {
      let suffix = 1;
      let candidate: string;
      do {
        candidate = `${sanitized}_${suffix.toString()}`;
        suffix++;
      } while (seen.has(candidate));
      sanitized = candidate;
    }

    seen.add(sanitized);
    sanitizedToOriginal.set(sanitized, original);
    originalToSanitized.set(original, sanitized);
  }

  return { sanitizedToOriginal, originalToSanitized };
}

/**
 * Convert kernel-governed {@link CanonicalToolDefinition}s to the PI
 * {@link ToolDefinition} shape. The canonical tool's `execute` already has
 * governance applied by the kernel, so we wire it straight through. Tool names
 * are sanitized for strict providers; a sanitized → original mapping is
 * returned for telemetry and prompt rewriting.
 */
export function convertGovernedTools(
  governedTools: CanonicalToolDefinition[],
  onTerminate?: () => void,
): GovernedToolConversionResult {
  const { sanitizedToOriginal, originalToSanitized } = dedupeToolNameMapping(
    governedTools.map((tool) => tool.name),
  );

  const piTools = governedTools.map((tool) => {
    const sanitizedName = originalToSanitized.get(tool.name) ?? tool.name;
    return adaptCanonicalToolToPi(tool, sanitizedName, onTerminate);
  });

  return { piTools, sanitizedToOriginal };
}

/**
 * Adapt bridged MCP tools (already governance-wrapped by the bridge) to the PI
 * tool shape, sanitizing names for strict providers and deduping collisions —
 * reusing the same adapter as the kernel-governed tools.
 *
 * Intentionally omits `onTerminate`: the `{ terminate: true }` durable-await
 * suspension directive is a Nexus-internal signal, so a remote MCP tool must not
 * be able to emit it. Kernel-governed tools (see {@link convertGovernedTools})
 * forward `onTerminate`; bridged author tools do not.
 */
export function convertBridgedTools(
  bridgedTools: CanonicalToolDefinition[],
): ToolDefinition[] {
  const { originalToSanitized } = dedupeToolNameMapping(
    bridgedTools.map((tool) => tool.name),
  );
  return bridgedTools.map((tool) =>
    adaptCanonicalToolToPi(
      tool,
      originalToSanitized.get(tool.name) ?? tool.name,
    ),
  );
}

/**
 * Adapt a single governance-wrapped {@link CanonicalToolDefinition} to the PI
 * {@link ToolDefinition} shape. `displayName` is the provider-safe name PI
 * advertises; it may differ from `tool.name` when sanitized.
 *
 * We cast through `unknown` because the PI SDK's ToolDefinition requires generic
 * ExtensionContext and TSchema parameters not available in this layer.
 */
function adaptCanonicalToolToPi(
  tool: CanonicalToolDefinition,
  displayName: string,
  onTerminate?: () => void,
): ToolDefinition {
  const piTool = {
    name: displayName,
    label: displayName,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (
      callId: string,
      params: Record<string, unknown>,
      abortSignal?: AbortSignal,
    ) => {
      const result = await tool.execute(callId, params, abortSignal);
      // A tool result carrying `terminate` is the runner's signal that the API
      // issued an executionStatus:"suspended" directive (durable await). Notify
      // the engine BEFORE returning so it can suspend the session and abort the
      // in-flight pi run, preventing a further LLM turn. See kanban-atuq.
      if (isTerminatingResult(result)) {
        onTerminate?.();
      }
      const text = typeof result === "string" ? result : JSON.stringify(result);
      return {
        content: [{ type: "text" as const, text }],
        details: undefined as unknown,
      };
    },
  };
  // Load-bearing cast — do NOT remove. A CanonicalToolDefinition carries
  // `parameters: unknown` (governed tools have dynamic, runtime-resolved
  // schemas), but the pi SDK's ToolDefinition constrains `parameters` to its
  // generic TSchema. The two cannot be reconciled statically, so we bridge the
  // SDK-type drift here. Dropping the cast fails the build with TS2322.
  return piTool as unknown as ToolDefinition;
}

/** True when a governed tool result requests durable turn suspension. */
function isTerminatingResult(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { terminate?: unknown }).terminate === true
  );
}

export function dedupeTools<T extends { name: string }>(tools: T[]): T[] {
  const byName = new Map<string, T>();
  for (const tool of tools) {
    if (!byName.has(tool.name)) {
      byName.set(tool.name, tool);
    }
  }
  return Array.from(byName.values());
}

/**
 * Write the generated PI hook-extension module into the extensions dir. A hook
 * list that produces no source (empty) writes nothing, keeping PI behavior
 * byte-identical for an empty contribution bundle.
 *
 * When `staged` is provided (Task 2 / EPIC-211), script hooks reference their
 * staged file paths via injection-safe `execFile(interpreter, [path])` calls.
 * Without `staged`, the generator falls back to the EPIC-210 inline-command
 * path for backward compatibility.
 */
export function writeHookExtensionFile(
  extensionsDir: string,
  filename: string,
  hooks: HarnessHookAsset[],
  staged?: ReadonlyMap<StagedHookKey, string>,
): void {
  const source = generateHookExtensionSource(hooks, staged);
  if (!source) return;
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(`${extensionsDir}/${filename}`, source);
}
