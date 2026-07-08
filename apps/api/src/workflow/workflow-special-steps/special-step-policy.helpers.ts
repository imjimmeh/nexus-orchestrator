import {
  asRecord,
  requireNonEmptyString as coreRequireNonEmptyString,
} from '@nexus/core';

export { asRecord };

/**
 * Resolve a required string input on a special step, preserving the legacy
 * `Step ${stepId}: ${type} requires inputs.${key}` error message so existing
 * tests, logs, and downstream assertions stay stable. The validation logic
 * itself is delegated to the shared core helper.
 */
export function requireNonEmptyString(
  inputs: Record<string, unknown>,
  key: string,
  stepId: string,
  type: string,
): string {
  const field = `Step ${stepId}: ${type} requires inputs.${key}`;
  try {
    return coreRequireNonEmptyString(inputs[key], field);
  } catch {
    throw new Error(field);
  }
}

export function requireStringArray(
  policy: Record<string, unknown> | undefined,
  key: string,
  stepId: string,
  type: string,
): string[] {
  const value = policy?.[key];
  if (!Array.isArray(value)) {
    throw new Error(`Step ${stepId}: ${type} requires inputs.policy.${key}`);
  }

  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (strings.length === 0) {
    throw new Error(`Step ${stepId}: ${type} requires inputs.policy.${key}`);
  }

  return strings;
}

export function isAllowedByPatterns(
  value: string,
  patterns: string[],
): boolean {
  return patterns.some((pattern) => {
    if (pattern === '*') {
      return true;
    }

    if (pattern.endsWith('*')) {
      return value.startsWith(pattern.slice(0, -1));
    }

    return value === pattern;
  });
}

export function resolveTimeoutMs(
  inputs: Record<string, unknown>,
  defaultMs: number,
  maxMs: number,
): number {
  const raw = inputs.timeout_ms;
  if (raw === undefined || raw === null) {
    return defaultMs;
  }

  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return defaultMs;
  }

  return Math.min(Math.trunc(value), maxMs);
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}
