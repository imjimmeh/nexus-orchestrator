import { describe, expect, it } from 'vitest';
import { stepCompleteInputSchema } from './workflow-completion-capability.provider';

describe('stepCompleteInputSchema', () => {
  it('accepts summary, reasoning, and status', () => {
    const result = stepCompleteInputSchema.safeParse({
      summary: 'Done',
      reasoning: 'All checks passed',
      status: 'success',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        summary: 'Done',
        reasoning: 'All checks passed',
        status: 'success',
      });
    }
  });

  it('rejects empty summary', () => {
    const result = stepCompleteInputSchema.safeParse({
      summary: '   ',
    });

    expect(result.success).toBe(false);
  });

  it('accepts reason as an alias field', () => {
    const result = stepCompleteInputSchema.safeParse({
      summary: 'Done',
      reason: 'All checks passed',
      status: 'success',
    });

    expect(result.success).toBe(true);
  });

  it('still rejects unknown extra fields', () => {
    const result = stepCompleteInputSchema.safeParse({
      summary: 'Done',
      reason: 'All checks passed',
      unknown_field: 'should be rejected',
    });

    expect(result.success).toBe(false);
  });
});
