import { describe, expect, it } from 'vitest';
import {
  sanitizeSubagentResult,
  stripThinkingBlocks,
} from './subagent-result-sanitizer';

describe('stripThinkingBlocks', () => {
  it('removes a thinking block and keeps visible text', () => {
    expect(stripThinkingBlocks('<think>hidden</think>Visible')).toBe('Visible');
  });

  it('removes multiple thinking blocks', () => {
    expect(
      stripThinkingBlocks(
        '<think>first</think>Visible <think>second</think>Done',
      ),
    ).toBe('Visible Done');
  });

  it('keeps normal text intact', () => {
    expect(stripThinkingBlocks('Visible answer without reasoning')).toBe(
      'Visible answer without reasoning',
    );
  });
});

describe('sanitizeSubagentResult', () => {
  it('strips thinking from every string inside nested objects and arrays', () => {
    const result = sanitizeSubagentResult({
      response: '<think>private</think>public response',
      message: 'before <think>secret</think> after',
      summary: '<think>notes</think>summary',
      text: '<think>draft</think>text',
      errorMessage: '<think>stack thoughts</think>error text',
      error: '<think>error thoughts</think>error code text',
      failureReason: '<think>failure thoughts</think>failure text',
      error_code: '<think>snake thoughts</think>snake error',
      errorCode: '<think>camel thoughts</think>camel error',
      metadata: {
        id: 'subagent-1',
        response: '<think>nested</think>nested response',
        diagnostics: '<think>diagnostic thoughts</think>diagnostic text',
      },
      items: [
        { message: '<think>item thought</think>item message' },
        { untouched: '<think>unknown field</think>metadata value' },
        '<think>array thought</think>array text',
      ],
    });

    expect(result).toEqual({
      response: 'public response',
      message: 'before  after',
      summary: 'summary',
      text: 'text',
      errorMessage: 'error text',
      error: 'error code text',
      failureReason: 'failure text',
      error_code: 'snake error',
      errorCode: 'camel error',
      metadata: {
        id: 'subagent-1',
        response: 'nested response',
        diagnostics: 'diagnostic text',
      },
      items: [
        { message: 'item message' },
        { untouched: 'metadata value' },
        'array text',
      ],
    });
  });

  it('preserves non-plain objects unchanged', () => {
    const completedAt = new Date('2026-04-30T00:01:00.000Z');
    const metadata = new Map([['output', '<think>hidden</think>visible']]);

    const result = sanitizeSubagentResult({
      completedAt,
      metadata,
      output: '<think>hidden</think>visible output',
    });

    expect(result).toEqual({
      completedAt,
      metadata,
      output: 'visible output',
    });
    expect(result.completedAt).toBe(completedAt);
    expect(result.metadata).toBe(metadata);
  });
});
