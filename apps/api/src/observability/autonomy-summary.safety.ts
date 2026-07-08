const SECRET_PATTERN =
  /api[-_]key|access[-_]token|credential|bearer|secret|password|authorization/i;
const BARE_PROVIDER_TOKEN_PATTERN = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/i;
const RAW_OUTPUT_PATTERN =
  /raw\s+transcript|transcript\s+body|full\s+transcript|raw\s+job\s+output|job\s+output\s*:|job-output/i;
const MAX_SUMMARY_LENGTH = 280;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeSummary(value: string): string {
  if (
    SECRET_PATTERN.test(value) ||
    BARE_PROVIDER_TOKEN_PATTERN.test(value) ||
    RAW_OUTPUT_PATTERN.test(value)
  ) {
    return '[REDACTED]';
  }
  return value.length > MAX_SUMMARY_LENGTH
    ? `${value.slice(0, MAX_SUMMARY_LENGTH - 1)}...`
    : value;
}

export function safePayloadEvidenceId(
  value: string | undefined,
): string | undefined {
  return value && UUID_PATTERN.test(value) ? value : undefined;
}

export function readSafeEvidenceId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return SECRET_PATTERN.test(value) ||
    BARE_PROVIDER_TOKEN_PATTERN.test(value) ||
    RAW_OUTPUT_PATTERN.test(value)
    ? undefined
    : value;
}
