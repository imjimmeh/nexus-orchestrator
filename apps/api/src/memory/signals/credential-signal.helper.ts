/**
 * Shared, pure credential/secret detection + redaction (EPIC-212).
 *
 * Single source of truth for the "never embed/store a secret value" rail.
 * Consumed by both `RetrospectiveOutputRouter` (value-level redaction at record
 * time, Phase-2 Task 7) and `LearningRouterService` (credential-shape detection
 * for deterministic `project` routing, Phase-2 Task 8).
 *
 * No DI, no side effects — import the functions directly. Scope-neutral.
 */

/** Replacement placeholder substituted for any detected secret value. */
export const REDACTED_PLACEHOLDER = '[REDACTED]';

/** Secret key=value pairs (e.g. `password=hunter2`, `api_key: sk-…`). */
export const SECRET_KEY_VALUE_PATTERN =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|bearer|authorization)\b(\s*[:=]\s*)(\S+)/gi;

/** Standalone provider-token shapes (OpenAI, AWS, GitHub, Slack). */
export const SECRET_STANDALONE_PATTERN =
  /\b(?:sk-[A-Za-z0-9]{12,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;

/**
 * Broad credential / connection KEYWORD signal — fires even when no concrete
 * secret VALUE is present (e.g. "store the connection string in secret_store",
 * "always set the API_KEY env var"). Used for routing decisions, never for
 * redaction (redaction needs a value to strip).
 */
const CREDENTIAL_KEYWORD_PATTERN =
  /\b(?:password|passwd|pwd|secret|secrets|token|api[_-]?key|access[_-]?key|client[_-]?secret|credential|credentials|connection[_-]?string|secret_store|vault|bearer|oauth|private[_-]?key)\b/i;

/**
 * Value-level secret redaction. Replaces the VALUE of a secret-shaped key=value
 * pair (preserving the key for context) and any standalone provider token with
 * a placeholder. Returns the sanitized text plus whether anything was redacted.
 */
export function redactSecretValues(text: string): {
  text: string;
  redacted: boolean;
} {
  let redacted = false;
  let out = text.replace(
    SECRET_KEY_VALUE_PATTERN,
    (_match, key: string, separator: string) => {
      redacted = true;
      return `${key}${separator}${REDACTED_PLACEHOLDER}`;
    },
  );
  out = out.replace(SECRET_STANDALONE_PATTERN, () => {
    redacted = true;
    return REDACTED_PLACEHOLDER;
  });
  return { text: out, redacted };
}

/**
 * True when the text carries any credential / connection signal — either a
 * concrete secret value (key=value pair or standalone provider token) or a
 * credential/connection keyword. Pure predicate; returns only a boolean so a
 * caller can never leak the secret value into downstream signals.
 */
export function containsCredentialSignal(text: string): boolean {
  if (CREDENTIAL_KEYWORD_PATTERN.test(text)) {
    return true;
  }
  // The global-flagged value patterns carry `lastIndex` state across `.test`
  // calls; build fresh, non-global copies for a stateless one-shot check.
  const keyValue = new RegExp(
    SECRET_KEY_VALUE_PATTERN.source,
    SECRET_KEY_VALUE_PATTERN.flags.replace('g', ''),
  );
  const standalone = new RegExp(
    SECRET_STANDALONE_PATTERN.source,
    SECRET_STANDALONE_PATTERN.flags.replace('g', ''),
  );
  return keyValue.test(text) || standalone.test(text);
}
