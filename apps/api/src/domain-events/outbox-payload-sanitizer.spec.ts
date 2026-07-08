import { describe, expect, it } from 'vitest';
import {
  sanitizeOutboxPayload,
  sanitizeOutboxValue,
} from './outbox-payload-sanitizer';

const NUL = String.fromCharCode(0);

describe('outbox-payload-sanitizer', () => {
  describe('sanitizeOutboxPayload', () => {
    it('removes NUL bytes from nested strings and arrays while preserving other values', () => {
      const result = sanitizeOutboxPayload({
        error_message: `boom${NUL}tail`,
        nested: { detail: `frame${NUL}header`, ok: true },
        list: [`a${NUL}b`, 7, null],
        count: 3,
      });

      expect(result).toEqual({
        error_message: 'boomtail',
        nested: { detail: 'frameheader', ok: true },
        list: ['ab', 7, null],
        count: 3,
      });
    });

    it('does not mutate the original payload', () => {
      const original = { msg: `a${NUL}b` };

      const result = sanitizeOutboxPayload(original);

      expect(original.msg).toBe(`a${NUL}b`);
      expect(result['msg']).toBe('ab');
    });

    it('preserves JSON-safe control characters other than NUL', () => {
      const result = sanitizeOutboxPayload({ msg: 'line1\n\ttab' });

      expect(result['msg']).toBe('line1\n\ttab');
    });
  });

  describe('sanitizeOutboxValue', () => {
    it('passes through primitives unchanged', () => {
      expect(sanitizeOutboxValue(42)).toBe(42);
      expect(sanitizeOutboxValue(null)).toBeNull();
      expect(sanitizeOutboxValue(undefined)).toBeUndefined();
      expect(sanitizeOutboxValue(false)).toBe(false);
    });
  });
});
