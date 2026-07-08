import {
  createExecutionContext,
  normalizeOptionalString,
  type ExecutionContext,
} from '@nexus/core';

export function resolveAgentMentionTriggerScope(
  stateVariables: unknown,
): ExecutionContext {
  return resolveTriggerContext(
    (stateVariables as Record<string, unknown> | undefined)?.trigger,
  );
}

export function resolveTriggerContext(trigger: unknown): ExecutionContext {
  if (!trigger || typeof trigger !== 'object') {
    return createExecutionContext();
  }

  const triggerRecord = trigger as Record<string, unknown>;
  const scopeId =
    normalizeOptionalString(triggerRecord.scopeId) ??
    normalizeOptionalString(triggerRecord.scope_id);
  const contextId =
    normalizeOptionalString(triggerRecord.contextId) ??
    normalizeOptionalString(triggerRecord.context_id);

  if (scopeId) {
    return createExecutionContext({
      scopeId,
      contextId: contextId ?? scopeId,
    });
  }

  if (contextId) {
    return createExecutionContext({
      scopeId: null,
      contextId,
    });
  }

  return createExecutionContext();
}
