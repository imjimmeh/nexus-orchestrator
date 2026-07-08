/**
 * Trims a value and returns it if it is a non-empty string, otherwise null.
 * Safe to call with any value — non-strings always return null.
 */
export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true if the value is a valid UUID string, otherwise false.
 */
export function isUuid(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return UUID_REGEX.test(value);
}
