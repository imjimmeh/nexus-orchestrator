/**
 * Module-local `scope_id` resolver for the retrospective enqueue path.
 *
 * Terminal workflow events carry the originating scope at
 * `state_variables.trigger.scopeId` (camelCase). Legacy / API-launched
 * payloads may instead carry `trigger.scope_id` (snake_case) or a top-level
 * `scopeId`. Failed runs may legitimately lack any scope at all, in which case
 * this returns `null` and the listener still enqueues (flagging the gap in
 * `signals_json`).
 *
 * This duplicates the resolution discipline of the success / struggle
 * listeners deliberately: `WorkflowRetrospectiveModule` owns its own copy so
 * the two existing emitters stay untouched in this task.
 */
export function resolveScopeId(
  stateVariables: Record<string, unknown>,
): string | null {
  const trigger = readRecord(stateVariables.trigger);
  const fromTrigger = readNonEmptyString(trigger?.scopeId);
  if (fromTrigger !== null) {
    return fromTrigger;
  }
  const fromTriggerSnake = readNonEmptyString(trigger?.scope_id);
  if (fromTriggerSnake !== null) {
    return fromTriggerSnake;
  }
  return readNonEmptyString(stateVariables.scopeId);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
