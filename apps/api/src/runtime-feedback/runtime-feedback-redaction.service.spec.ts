import { describe, expect, it } from 'vitest';
import { RuntimeFeedbackRedactionService } from './runtime-feedback-redaction.service';

describe('RuntimeFeedbackRedactionService', () => {
  const service = new RuntimeFeedbackRedactionService();

  it.each([
    'api_key=abc123',
    'authorization: Bearer abc123',
    'bearer abc123',
    'password=abc123',
    'secret: abc123',
    'raw transcript follows',
  ])('redacts unsafe summary content: %s', (summary) => {
    expect(service.sanitizeSummary(summary)).toBe('[REDACTED]');
  });

  it('returns examples marked as redacted', () => {
    const examples = service.sanitizeExamples([
      { summary: 'Safe example.', redacted: true },
      { summary: 'api_key=abc123', redacted: true },
    ]);

    expect(examples).toEqual([
      { summary: 'Safe example.', redacted: true },
      { summary: '[REDACTED]', redacted: true },
    ]);
  });

  it('truncates overly long summaries with an ellipsis', () => {
    const sanitized = service.sanitizeSummary('x'.repeat(520));

    expect(sanitized).toHaveLength(500);
    expect(sanitized.endsWith('...')).toBe(true);
  });
});
