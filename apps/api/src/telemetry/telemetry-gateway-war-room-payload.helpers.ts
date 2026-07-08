export function normalizeOptionalJsonArray<T>(
  value: T[] | string | undefined,
  fieldName: string,
): T[] | undefined {
  if (typeof value !== 'string') {
    return value;
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON array`);
  }

  return parsed as T[];
}
