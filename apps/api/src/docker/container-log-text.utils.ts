/**
 * Pure helpers for turning raw Docker `container.logs()` output into text that
 * is safe to embed in a persisted JSON document (e.g. a domain-event payload or
 * an execution `error_message`).
 *
 * Docker multiplexes a non-TTY container's stdout/stderr into a single stream
 * whose frames each carry an 8-byte header `[stream-type, 0x00, 0x00, 0x00,
 * len32]`. Decoding that stream to UTF-8 without demultiplexing leaves NUL
 * (U+0000) and other C0 control bytes in the string. PostgreSQL `text`/`jsonb`
 * columns cannot store U+0000, so an un-sanitized log tail that reaches an
 * INSERT aborts the statement with "unsupported Unicode escape sequence" — which
 * is how a failed execution's diagnostics can wedge an entire workflow run.
 * Routing every captured log tail through {@link normalizeContainerLogs} keeps
 * the diagnostics DB-safe.
 */

/**
 * Default upper bound on captured container-log characters; older characters are
 * dropped first so the most recent (and usually most diagnostic) output
 * survives.
 */
export const DEFAULT_CONTAINER_LOG_MAX_CHARS = 8_000;

/**
 * Determines whether a character is a JSON-unsafe control byte that must be
 * replaced before the log text is embedded in a persisted JSON document.
 * Newline, tab and carriage return are intentionally treated as safe.
 */
export function isJsonUnsafeControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    ((codePoint >= 0x00 && codePoint <= 0x08) ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      codePoint === 0x7f)
  );
}

/** Replaces JSON-unsafe control bytes (e.g. Docker stream multiplex headers). */
export function sanitizeJsonSafeLogText(value: string): string {
  return Array.from(value)
    .map((character) =>
      isJsonUnsafeControlCharacter(character) ? ' ' : character,
    )
    .join('');
}

/** Coerces a Docker `logs()` payload into UTF-8 text, or null if unsupported. */
export function readContainerLogText(output: unknown): string | null {
  if (Buffer.isBuffer(output)) {
    return output.toString('utf8');
  }

  if (typeof output === 'string') {
    return output;
  }

  if (output instanceof Uint8Array) {
    return Buffer.from(output).toString('utf8');
  }

  return null;
}

/**
 * Sanitizes and trims raw container log output, capping it at `maxChars`
 * (keeping the most recent characters). Returns null when the output is empty or
 * unreadable.
 */
export function normalizeContainerLogs(
  output: unknown,
  maxChars: number = DEFAULT_CONTAINER_LOG_MAX_CHARS,
): string | null {
  if (output === null || output === undefined) {
    return null;
  }

  const raw = readContainerLogText(output);
  if (raw === null) {
    return null;
  }

  const normalized = sanitizeJsonSafeLogText(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return normalized.slice(-maxChars);
}
