import type { BoundedIntOptions } from './query-transform.helpers.types';

export function toBoundedInt(
  value: unknown,
  options: BoundedIntOptions,
): number {
  const parsed = toInteger(value);
  if (parsed === null) {
    return options.defaultValue;
  }

  return Math.min(Math.max(parsed, options.min), options.max);
}

export function toOptionalPositiveInt(value: unknown): number | undefined {
  const parsed = toInteger(value);
  if (parsed === null || parsed < 1) {
    return undefined;
  }

  return parsed;
}

export function toBooleanWithDefault(
  value: unknown,
  defaultValue = false,
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }

  return defaultValue;
}

export function toOptionalCsvList(value: unknown): string[] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const values = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return values.length > 0 ? values : undefined;
}

export function toOptionalDateOrNull(value: unknown): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  return new Date(normalized);
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return null;
    }

    const parsed = Number(normalized);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
}
