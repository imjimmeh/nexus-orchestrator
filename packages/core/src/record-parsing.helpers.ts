/**
 * Defensive parsers for `Record<string, unknown>`-shaped data and scalar fields
 * sourced from untrusted input (YAML payloads, event payloads, JSON-RPC
 * envelopes, database JSON columns, etc.).
 *
 * The helpers intentionally do NOT throw on shape mismatches for the
 * non-throwing variants (`asRecord`, `isRecord`, `readString`) — callers decide
 * what to do with the empty fallback. Only `requireNonEmptyString` throws,
 * because the absence of a required string is a programmer error rather than
 * a data-shape ambiguity.
 *
 * All predicates treat `null`, primitives, and arrays as non-record values so
 * downstream code can index into the result without runtime guards. Arrays are
 * rejected because they are `typeof "object"` but cannot safely be treated as
 * `Record<string, unknown>`.
 */

/**
 * Returns `true` when `value` is a plain object record (not `null`, not an
 * array, not a primitive). Centralizes the predicate so every consumer agrees
 * on what counts as a record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

/**
 * Returns `value` unchanged when it is a plain object record, otherwise an
 * empty object. Use this when the surrounding code unconditionally indexes
 * into the result and a missing record should degrade gracefully (e.g. for
 * optional configuration blobs).
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * Returns `value` when it is a string, otherwise `fallback`. When `fallback`
 * is omitted, the return type is `string | undefined`. The string is returned
 * unchanged (no trimming) — callers that need normalization should pair this
 * with `requireNonEmptyString` or trim explicitly.
 */
export function readString(
  value: unknown,
  fallback?: string,
): string | undefined {
  return typeof value === "string" ? value : fallback;
}

/**
 * Validates that `value` is a non-empty string (after trimming). Returns the
 * trimmed string when valid. Throws a plain `Error` whose message names the
 * `field` so upstream code can surface a stable, identifiable diagnostic.
 *
 * Rejects: `null`, `undefined`, non-string primitives, arrays, objects, the
 * empty string, and strings whose trimmed length is zero (whitespace-only).
 */
export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} is required (expected non-empty string)`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} is required (expected non-empty string)`);
  }
  return trimmed;
}

/**
 * Walks `path` against `record` and returns the nested value, or `undefined`
 * when any segment is missing or when an intermediate value is not an object.
 * An empty `path` returns `record` itself.
 */
export function getNestedValue(
  record: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}