import { parseDurationToSeconds } from './duration';

/** Default agent JWT lifetime when AGENT_JWT_TTL is unset. */
export const DEFAULT_AGENT_TOKEN_TTL = '24h';

/**
 * Resolves the agent JWT lifetime from `AGENT_JWT_TTL`, defaulting to
 * {@link DEFAULT_AGENT_TOKEN_TTL}. A set-but-malformed value is a
 * misconfiguration and throws rather than silently using the default.
 *
 * @remarks
 * The supported duration syntax is the canonical one enforced by
 * {@link parseDurationToSeconds} — a positive integer (interpreted as
 * seconds) optionally followed by `s`, `m`, `h`, or `d`. Weeks, years,
 * and milliseconds are intentionally rejected: every consumer in this
 * codebase forwards the resolved string to `jsonwebtoken`'s
 * `expiresIn`, which understands the same `s|m|h|d` set, and the
 * canonical utility is the single source of truth for the grammar.
 */
export function resolveAgentTokenTtl(): string {
  const raw = process.env.AGENT_JWT_TTL;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return DEFAULT_AGENT_TOKEN_TTL;
  }

  const value = raw.trim();
  try {
    // Validate the shape; the resolved string (not the seconds) is what
    // `jsonwebtoken`'s `expiresIn` consumes, so we forward `value` directly.
    parseDurationToSeconds(value);
  } catch {
    throw new Error(
      `AGENT_JWT_TTL is set to an invalid duration: "${raw}". ` +
        'Use seconds (e.g. "7200") or a duration string (e.g. "24h", "90m").',
    );
  }

  return value;
}
