import { describe, expect, it } from 'vitest';
import { normalizeCodeChangeTitle } from './code-change-dedup.helpers';

describe('normalizeCodeChangeTitle', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(
      normalizeCodeChangeTitle('  Fix: NUL-byte  handling (outbox INSERT)! '),
    ).toBe('fix nul byte handling outbox insert');
  });

  it('treats equivalent titles as identical', () => {
    expect(normalizeCodeChangeTitle('Fix outbox NUL bytes.')).toBe(
      normalizeCodeChangeTitle('fix outbox   nul bytes'),
    );
  });
});
