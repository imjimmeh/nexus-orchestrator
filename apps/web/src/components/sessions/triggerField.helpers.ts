/**
 * Pure helper for reading a display-name-shaped value out of a workflow run
 * `trigger` record. Callers pass the alias keys they want to try (e.g.
 * `["displayName", "display_name", "workflowName", "workflow_name"]`) and the
 * helper returns the first non-empty string it finds, without mutating the
 * alias array the caller provided.
 *
 * This module is intentionally side-effect free so it can be reused by both
 * `SessionConversationPane.data.ts` and the other session components that
 * read the same `trigger.*` keys today.
 */
export function resolveTriggerField(
  trigger: Record<string, unknown> | null | undefined,
  aliases: readonly string[],
): string | undefined {
  if (!trigger) {
    return undefined;
  }
  for (const alias of aliases) {
    const value = trigger[alias];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}