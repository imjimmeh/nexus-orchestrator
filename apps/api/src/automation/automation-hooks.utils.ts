import { AutomationHook } from './database/entities/automation-hook.entity';

function isWithinCooldownWindow(hook: AutomationHook, now: Date): boolean {
  if (
    hook.cooldown_window_seconds <= 0 ||
    !hook.last_fired_at ||
    !(hook.last_fired_at instanceof Date)
  ) {
    return false;
  }

  const elapsedMs = now.getTime() - hook.last_fired_at.getTime();
  return elapsedMs < hook.cooldown_window_seconds * 1000;
}

function matchesTriggerFilter(
  filter: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!filter || typeof filter !== 'object') {
    return true;
  }

  for (const [key, expected] of Object.entries(filter)) {
    const actual = readPathValue(payload, key);
    if (!valuesEqual(actual, expected)) {
      return false;
    }
  }

  return true;
}

function readStringFromPayload(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const raw = payload[key];
  if (typeof raw !== 'string') {
    return null;
  }

  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function readObjectFromPayload(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const raw = payload[key];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  return raw as Record<string, unknown>;
}

function readPathValue(
  payload: Record<string, unknown>,
  keyPath: string,
): unknown {
  const pathSegments = keyPath
    .split('.')
    .filter((segment) => segment.length > 0);
  if (pathSegments.length === 0) {
    return undefined;
  }

  let current: unknown = payload;
  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (typeof left === 'object' && typeof right === 'object') {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return false;
}

export {
  isWithinCooldownWindow,
  matchesTriggerFilter,
  readObjectFromPayload,
  readStringFromPayload,
};
