import { randomUUID } from "node:crypto";

import type {
  CanonicalToolDefinition,
  CanonicalToolSpec,
} from "../engine/session-context.js";

/**
 * Adapts kernel-mounted tools into the raw tool catalog consumed by
 * `permission_callback` engines (e.g. claude-code).
 *
 * `execute_wrapped` engines (PI) consume `governedTools`, where governance is
 * baked into each tool's `execute`. `permission_callback` engines instead
 * receive the un-governed `CanonicalToolSpec` catalog and apply governance via
 * the SDK's `canUseTool` callback. Both surfaces derive from the same mounted
 * tool definitions, so this keeps the claude-code tool surface in lock-step
 * with PI's rather than leaving it empty.
 *
 * The `CanonicalToolDefinition.execute(callId, params)` contract requires a
 * call id; the SDK tool handler only supplies params, so a fresh id is
 * generated per invocation.
 */
export function buildToolCatalog(
  rawTools: CanonicalToolDefinition[],
): CanonicalToolSpec[] {
  return rawTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    invoke: (params: Record<string, unknown>) =>
      tool.execute(randomUUID(), params),
  }));
}
