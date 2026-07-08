/**
 * Pure helpers for choosing where a continuation message attaches in a pi
 * session tree.
 */

interface AssistantMessageShape {
  role?: unknown;
  stopReason?: unknown;
  content?: unknown;
}

/**
 * A durable-await suspend aborts the in-flight pi turn; the pi SDK persists it as
 * an AssistantMessage with stopReason "aborted"/"error" (usually empty content).
 * Such a turn cannot be continued from — the pi SDK's continue/retry loop throws
 * "Cannot continue from message role: assistant" when it is the active leaf.
 */
function isInterruptedAssistant(node: Record<string, unknown>): boolean {
  if (node.type !== 'message') return false;
  const message = node.message as AssistantMessageShape | undefined;
  if (!message || message.role !== 'assistant') return false;
  return (
    message.stopReason === 'aborted' ||
    message.stopReason === 'error' ||
    (Array.isArray(message.content) && message.content.length === 0)
  );
}

/**
 * Resolve the node a continuation (e.g. an awaited-result system message) should
 * attach to, skipping past a trailing run of interrupted assistant turns.
 *
 * If a durable-await resume attaches its result as a child of an aborted
 * assistant turn, that turn stays in the active branch and the pi SDK rejects the
 * next resume with "Cannot continue from message role: assistant". Attaching to
 * the aborted turn's parent instead drops it from the active branch while keeping
 * the awaited-result payload that follows. Completed assistant turns and
 * non-assistant turns are returned unchanged.
 *
 * @param nodes The parsed session-tree entries.
 * @param requestedParentId The id the caller would otherwise attach to (the
 *   current leaf). May be empty for a fresh tree.
 * @returns The id to attach to — `requestedParentId` unless it (or an unbroken
 *   chain of ancestors) is an interrupted assistant turn.
 */
export function resolveContinuationParentId(
  nodes: ReadonlyArray<Record<string, unknown>>,
  requestedParentId: string,
): string {
  const byId = new Map<string, Record<string, unknown>>();
  for (const node of nodes) {
    if (typeof node.id === 'string') byId.set(node.id, node);
  }

  let currentId = requestedParentId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = byId.get(currentId);
    if (!node || !isInterruptedAssistant(node)) break;
    currentId = typeof node.parentId === 'string' ? node.parentId : '';
  }
  return currentId;
}
