export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function readPath(
  value: Record<string, unknown> | null | undefined,
  path: string[],
): unknown {
  let current: unknown = value;

  for (const key of path) {
    const record = asRecord(current);
    if (record === null) {
      return undefined;
    }
    current = record[key];
  }

  return current;
}

export function readString(value: unknown): string | undefined;
export function readString(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): string | undefined;
export function readString(
  value: unknown,
  keys?: string[],
): string | undefined {
  if (keys !== undefined) {
    const record = asRecord(value);
    if (record === null) {
      return undefined;
    }

    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    return undefined;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function readNumber(value: unknown): number | undefined;
export function readNumber(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): number | undefined;
export function readNumber(
  value: unknown,
  keys?: string[],
): number | undefined {
  if (keys !== undefined) {
    const record = asRecord(value);
    if (record === null) {
      return undefined;
    }

    for (const key of keys) {
      const parsed = parseNumber(record[key]);
      if (parsed !== undefined) {
        return parsed;
      }
    }

    return undefined;
  }

  return parseNumber(value);
}
