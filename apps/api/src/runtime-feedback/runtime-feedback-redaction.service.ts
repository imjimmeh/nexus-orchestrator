import { Injectable } from '@nestjs/common';

const SECRET_PATTERN =
  /api[-_]key|access[-_]token|credential|bearer|secret|password|authorization/i;
const RAW_OUTPUT_PATTERN =
  /raw\s+transcript|transcript\s+body|full\s+transcript|raw\s+job\s+output|job\s+output\s*:|job-output/i;
const MAX_SUMMARY_LENGTH = 500;
const REDACTED_SUMMARY = '[REDACTED]';

interface RuntimeFeedbackExampleSummary extends Record<string, unknown> {
  summary: string;
  redacted: true;
}

@Injectable()
export class RuntimeFeedbackRedactionService {
  sanitizeSummary(value: string): string {
    const trimmed = value.trim();

    if (SECRET_PATTERN.test(trimmed) || RAW_OUTPUT_PATTERN.test(trimmed)) {
      return REDACTED_SUMMARY;
    }

    return trimmed.length > MAX_SUMMARY_LENGTH
      ? `${trimmed.slice(0, MAX_SUMMARY_LENGTH - 3).trimEnd()}...`
      : trimmed;
  }

  sanitizeExamples(
    examples: RuntimeFeedbackExampleSummary[],
  ): RuntimeFeedbackExampleSummary[] {
    return examples.map((example) => ({
      summary: this.sanitizeSummary(example.summary),
      redacted: true,
    }));
  }
}
