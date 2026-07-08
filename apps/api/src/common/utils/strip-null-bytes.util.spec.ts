import { describe, expect, it } from 'vitest';
import { stripNullBytes, stripNullBytesDeep } from './strip-null-bytes.util';

const NUL = String.fromCharCode(0);

describe('stripNullBytes', () => {
  it('removes every NUL code point from a string', () => {
    expect(stripNullBytes(`health check timed out${NUL}${NUL}npm warn`)).toBe(
      'health check timed outnpm warn',
    );
  });

  it('returns the same string when no NUL is present', () => {
    const value = 'no control bytes here';
    expect(stripNullBytes(value)).toBe(value);
  });

  it('preserves other control characters (PostgreSQL escapes them)', () => {
    expect(stripNullBytes(`a\tb\nc`)).toBe('a\tb\nc');
  });
});

describe('stripNullBytesDeep', () => {
  it('strips NUL from nested strings, arrays and object values', () => {
    const input = {
      stdout: `built${NUL}ok`,
      nested: { detail: `frame${NUL}header` },
      list: [`a${NUL}b`, 'c'],
    };

    expect(stripNullBytesDeep(input)).toEqual({
      stdout: 'builtok',
      nested: { detail: 'frameheader' },
      list: ['ab', 'c'],
    });
  });

  it('leaves non-string scalars untouched', () => {
    expect(stripNullBytesDeep(42)).toBe(42);
    expect(stripNullBytesDeep(true)).toBe(true);
    expect(stripNullBytesDeep(null)).toBeNull();
    expect(stripNullBytesDeep(undefined)).toBeUndefined();
  });

  it('produces a value that JSON.stringify cannot turn into a \\u0000 escape', () => {
    const sanitized = JSON.stringify(stripNullBytesDeep({ s: `x${NUL}y` }));
    expect(sanitized.includes('\\u0000')).toBe(false);
  });
});
