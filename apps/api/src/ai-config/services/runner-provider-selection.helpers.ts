import type { JsonValue, RunnerThinkingLevel } from '@nexus/core';

type ProviderRawConfig = Record<string, unknown>;

export function asRecord(value: unknown): ProviderRawConfig | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ProviderRawConfig)
    : undefined;
}
export function asStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}
export function asJsonRecord(
  value: unknown,
): Record<string, JsonValue> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, JsonValue] =>
      isJsonValue(entry[1]),
    ),
  );
}
export function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
export function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
export function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
export function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }
  const record = asRecord(value);
  return record
    ? Object.values(record).every((entry) => isJsonValue(entry))
    : false;
}
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
export function interpolateHeaders(
  headers: Record<string, string> | undefined,
  secretMap: ProviderRawConfig,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      value.replaceAll(PLACEHOLDER_PATTERN, (match, token: string) => {
        const replacement = secretMap[token];
        return typeof replacement === 'string' ? replacement : match;
      }),
    ]),
  );
}
export function asThinkingLevelMap(
  value: unknown,
): Partial<Record<RunnerThinkingLevel, string | null>> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, entry]) => entry === null || typeof entry === 'string',
    ),
  );
}
export function asModelInputArray(value: unknown): Array<'text' | 'image'> {
  if (!Array.isArray(value)) {
    return ['text'];
  }
  return value.filter(
    (entry): entry is 'text' | 'image' => entry === 'text' || entry === 'image',
  );
}
export function firstRecord(values: unknown[]): ProviderRawConfig | undefined {
  for (const value of values) {
    const record = asRecord(value);
    if (record) {
      return record;
    }
  }
  return undefined;
}
export function firstNonEmptyString(values: unknown[]): string | undefined {
  for (const value of values) {
    const resolved = asNonEmptyString(value);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}
export function firstFiniteNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const resolved = asFiniteNumber(value);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return undefined;
}
