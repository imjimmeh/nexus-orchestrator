/**
 * PostgreSQL `text`/`jsonb` columns cannot store the NUL code point (U+0000): a
 * statement carrying one aborts with "unsupported Unicode escape sequence". NUL
 * bytes routinely sneak into payloads via raw Docker multiplexed log frames
 * (whose 8-byte headers contain NUL), so any value assembled from container
 * output and later persisted to a `jsonb` column can wedge a workflow run.
 *
 * These helpers are the single, transport-neutral NUL stripper shared by every
 * persistence choke point (the domain-event outbox and the workflow-run state
 * variable write). Only U+0000 is removed; all other characters — including
 * other control bytes, which PostgreSQL escapes rather than rejects — are
 * preserved so legitimate payload data is never silently mangled.
 */

/** The single code point PostgreSQL refuses to store in text/jsonb. */
const NULL_BYTE = String.fromCharCode(0);

/** Removes every NUL (U+0000) code point from a string. */
export function stripNullBytes(value: string): string {
  return value.includes(NULL_BYTE) ? value.split(NULL_BYTE).join('') : value;
}

/** Recursively removes NUL bytes from every string within a JSON-like value. */
export function stripNullBytesDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return stripNullBytes(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripNullBytesDeep(item));
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      sanitized[key] = stripNullBytesDeep(entry);
    }
    return sanitized;
  }

  return value;
}
