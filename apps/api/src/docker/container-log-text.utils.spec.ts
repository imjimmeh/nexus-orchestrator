import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTAINER_LOG_MAX_CHARS,
  isJsonUnsafeControlCharacter,
  normalizeContainerLogs,
  readContainerLogText,
  sanitizeJsonSafeLogText,
} from './container-log-text.utils';

const NUL = String.fromCharCode(0);

function containsJsonUnsafeControlCharacter(value: string): boolean {
  return Array.from(value).some((character) =>
    isJsonUnsafeControlCharacter(character),
  );
}

describe('container-log-text.utils', () => {
  describe('isJsonUnsafeControlCharacter', () => {
    it('flags the NUL byte and other C0 control bytes', () => {
      expect(isJsonUnsafeControlCharacter(String.fromCharCode(0))).toBe(true);
      expect(isJsonUnsafeControlCharacter(String.fromCharCode(1))).toBe(true);
      expect(isJsonUnsafeControlCharacter(String.fromCharCode(2))).toBe(true);
      expect(isJsonUnsafeControlCharacter(String.fromCharCode(0x1f))).toBe(
        true,
      );
      expect(isJsonUnsafeControlCharacter(String.fromCharCode(0x7f))).toBe(
        true,
      );
    });

    it('treats newlines, tabs, carriage returns and printable text as safe', () => {
      expect(isJsonUnsafeControlCharacter('\n')).toBe(false);
      expect(isJsonUnsafeControlCharacter('\t')).toBe(false);
      expect(isJsonUnsafeControlCharacter('\r')).toBe(false);
      expect(isJsonUnsafeControlCharacter('a')).toBe(false);
    });
  });

  describe('sanitizeJsonSafeLogText', () => {
    it('replaces JSON-unsafe control bytes with spaces and keeps text', () => {
      const sanitized = sanitizeJsonSafeLogText(`runner${NUL}boot${NUL}failed`);

      expect(sanitized).toContain('runner');
      expect(sanitized).toContain('boot');
      expect(sanitized).toContain('failed');
      expect(containsJsonUnsafeControlCharacter(sanitized)).toBe(false);
    });

    it('preserves newlines and tabs (JSON-safe whitespace)', () => {
      expect(sanitizeJsonSafeLogText('line1\n\tline2')).toBe('line1\n\tline2');
    });
  });

  describe('readContainerLogText', () => {
    it('decodes Buffer, string and Uint8Array, and rejects other shapes', () => {
      expect(readContainerLogText(Buffer.from('hello'))).toBe('hello');
      expect(readContainerLogText('hello')).toBe('hello');
      expect(readContainerLogText(new Uint8Array([104, 105]))).toBe('hi');
      expect(readContainerLogText({ not: 'a buffer' })).toBeNull();
    });
  });

  describe('normalizeContainerLogs', () => {
    it('sanitizes Docker multiplex control bytes before persisting logs', () => {
      const output = Buffer.concat([
        Buffer.from([1, 0, 0, 0, 0, 0, 0, 21]),
        Buffer.from('runner boot failed'),
      ]);

      const logsTail = normalizeContainerLogs(output);

      expect(logsTail).not.toBeNull();
      expect(logsTail).toContain('runner');
      expect(containsJsonUnsafeControlCharacter(logsTail as string)).toBe(
        false,
      );
    });

    it('returns null for empty or unreadable output', () => {
      expect(normalizeContainerLogs(null)).toBeNull();
      expect(normalizeContainerLogs(Buffer.from(''))).toBeNull();
      expect(normalizeContainerLogs('   ')).toBeNull();
      expect(normalizeContainerLogs({ not: 'a buffer' })).toBeNull();
    });

    it('caps output at the given maxChars keeping the most recent text', () => {
      const head = 'A'.repeat(100);
      const tail = 'B'.repeat(DEFAULT_CONTAINER_LOG_MAX_CHARS);

      const logsTail = normalizeContainerLogs(`${head}${tail}`);

      expect(logsTail).toHaveLength(DEFAULT_CONTAINER_LOG_MAX_CHARS);
      expect(logsTail?.startsWith('B')).toBe(true);
      expect(logsTail?.includes('A')).toBe(false);
    });

    it('honours a custom maxChars cap', () => {
      expect(normalizeContainerLogs('abcdef', 3)).toBe('def');
    });
  });
});
