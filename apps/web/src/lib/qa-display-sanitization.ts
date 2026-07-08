/**
 * Shared redaction for QA/plan-review free-text display fields.
 *
 * Rejection feedback and failed-deliverable "details" are free text that can
 * echo raw job output, transcripts, or leaked secrets. Any panel rendering
 * these fields (QA findings, plan review, etc.) must run them through
 * {@link sanitizeQaDisplayText} before display.
 */
export const UNSAFE_DISPLAY_PATTERN =
  /api[-_]key|access[-_]token|credential|bearer|secret|password|authorization|raw\s+transcript|transcript\s+body|full\s+transcript|raw\s+job\s+output|job\s+output\s*:|job-output/i;

export function sanitizeQaDisplayText(value: string): string {
  return UNSAFE_DISPLAY_PATTERN.test(value) ? "[REDACTED]" : value;
}
