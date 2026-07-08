import type { TriggerDedupeContext } from './workflow-engine.types';
export type { TriggerDedupeContext } from './workflow-engine.types';

export function resolveTriggerDedupeContext(
  triggerData: Record<string, unknown>,
): TriggerDedupeContext | null {
  const triggerResource =
    getRecord(triggerData, 'resource') ?? getRecord(triggerData, 'context');

  const event = getString(triggerData, 'event');
  const scopeId = getPrimaryOrContextValue(
    triggerData,
    triggerResource,
    'scopeId',
  );
  const contextId = getPrimaryOrContextValue(
    triggerData,
    triggerResource,
    'contextId',
    'id',
  );
  const inferredStatusFromEvent = inferStatusFromEventName(event);
  const status =
    getString(triggerData, 'status') ||
    getString(triggerResource ?? {}, 'status') ||
    inferredStatusFromEvent;

  const context = {
    event,
    scopeId,
    contextId,
    status,
  };

  if (!isCompleteDedupeContext(context)) {
    return null;
  }

  return context;
}

export function buildStartDedupeKey(
  workflowId: string,
  triggerData: TriggerDedupeContext,
): string {
  return [
    workflowId,
    triggerData.event,
    triggerData.scopeId,
    triggerData.contextId,
    triggerData.status,
  ].join(':');
}

export function inferStatusFromEventName(_event: string | null): string | null {
  return null;
}

function getPrimaryOrContextValue(
  source: Record<string, unknown>,
  resource: Record<string, unknown> | null,
  primaryKey: string,
  resourceKey = primaryKey,
): string | null {
  return (
    getString(source, primaryKey) || getString(resource ?? {}, resourceKey)
  );
}

function isCompleteDedupeContext(context: {
  event: string | null;
  scopeId: string | null;
  contextId: string | null;
  status: string | null;
}): context is TriggerDedupeContext {
  return Boolean(
    context.event && context.scopeId && context.contextId && context.status,
  );
}

function getRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const candidate = value[key];
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  return candidate as Record<string, unknown>;
}

function getString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}
