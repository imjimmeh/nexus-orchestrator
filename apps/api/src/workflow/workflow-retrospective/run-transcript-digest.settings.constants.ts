/**
 * Operator-tunable token budget for the `RunTranscriptDigestService` (EPIC-212
 * Phase-2 Task 4).
 *
 * The digest is the single biggest cost lever in the retrospective pipeline: it
 * compresses a run's evidence to a small, high-signal payload before the
 * (expensive) analyst ever sees it. This cap bounds how large that payload may
 * grow. The constant lives here as the canonical default and is seeded into
 * `SYSTEM_SETTING_DEFAULTS` (via {@link RUN_TRANSCRIPT_DIGEST_SYSTEM_SETTING_DEFAULTS})
 * so a fresh database returns a sane value. The service re-reads the key on
 * every build so an operator can re-tune cost without restarting the app.
 */

export const RUN_TRANSCRIPT_DIGEST_SETTING_KEYS = {
  maxTokens: 'retrospective_digest_max_tokens',
} as const;

export const RUN_TRANSCRIPT_DIGEST_SETTING_DEFAULTS = {
  maxTokens: 4000,
} as const;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so the
 * digest token cap is seeded with its canonical default and a UI description.
 */
export const RUN_TRANSCRIPT_DIGEST_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [RUN_TRANSCRIPT_DIGEST_SETTING_KEYS.maxTokens]: {
    value: RUN_TRANSCRIPT_DIGEST_SETTING_DEFAULTS.maxTokens,
    description:
      'Maximum token size of the struggle-anchored run digest handed to the retrospective analyst (cost lever). When the digest exceeds this cap the lowest-signal timeline entries are dropped first; the struggle spans, their recovering calls, and anchored error codes are always preserved. The digest is flagged truncated when anything is dropped.',
  },
};
