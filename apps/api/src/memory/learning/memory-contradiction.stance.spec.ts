import { describe, expect, it } from 'vitest';
import { detectOpposingStance } from './memory-contradiction.stance';

describe('detectOpposingStance', () => {
  it('returns same for identical content', () => {
    expect(
      detectOpposingStance(
        'Prefer deterministic tests for workflow repair',
        'Prefer deterministic tests for workflow repair',
      ),
    ).toBe('same');
  });

  it('returns same when only stopwords / casing differ', () => {
    expect(
      detectOpposingStance(
        'Prefer deterministic tests for the workflow repair',
        'prefer deterministic tests for workflow repair',
      ),
    ).toBe('same');
  });

  it('returns oppose on an always↔never antonym over the same topic', () => {
    expect(
      detectOpposingStance(
        'Always run migrations before deploy',
        'Never run migrations before deploy',
      ),
    ).toBe('oppose');
  });

  it('returns oppose on an enable↔disable antonym', () => {
    expect(
      detectOpposingStance(
        'Enable the retry backoff for the repair queue',
        'Disable the retry backoff for the repair queue',
      ),
    ).toBe('oppose');
  });

  it('returns oppose on a negation asymmetry over a shared topic', () => {
    expect(
      detectOpposingStance(
        'Do not use parameterized queries for this report',
        'Use parameterized queries for this report',
      ),
    ).toBe('oppose');
  });

  it('returns oppose on a numeric-value mismatch over the same anchor', () => {
    expect(
      detectOpposingStance(
        'Set the request timeout to 60 seconds',
        'Set the request timeout to 30 seconds',
      ),
    ).toBe('oppose');
  });

  it('returns refine when the new content extends the existing one', () => {
    expect(
      detectOpposingStance(
        'Prefer deterministic tests for workflow repair especially retry logic and backoff',
        'Prefer deterministic tests for workflow repair',
      ),
    ).toBe('refine');
  });

  it('returns refine when the existing content extends the new one', () => {
    expect(
      detectOpposingStance(
        'Prefer deterministic tests for workflow repair',
        'Prefer deterministic tests for workflow repair especially retry logic and backoff',
      ),
    ).toBe('refine');
  });

  it('returns ambiguous for an overlapping-but-unclear pair', () => {
    expect(
      detectOpposingStance(
        'The cache layer behaves oddly under heavy load',
        'Cache eviction policy is LRU',
      ),
    ).toBe('ambiguous');
  });

  it('does not flag matching numeric values as a mismatch', () => {
    expect(
      detectOpposingStance(
        'Set the request timeout to 30 seconds',
        'Set the request timeout to 30 seconds for retries',
      ),
    ).toBe('refine');
  });
});
