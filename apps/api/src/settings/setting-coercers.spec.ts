import { describe, expect, it } from 'vitest';
import { coerceInteger } from './setting-coercers';

describe('coerceInteger', () => {
  describe('missing values', () => {
    it('returns the fallback for undefined with default options', () => {
      expect(coerceInteger(undefined, 7)).toBe(7);
    });

    it('returns the fallback for null', () => {
      expect(coerceInteger(null, 7)).toBe(7);
    });

    it('returns the fallback for an empty string', () => {
      expect(coerceInteger('', 7)).toBe(7);
    });

    it('returns the fallback for a whitespace-only string', () => {
      expect(coerceInteger('   ', 7)).toBe(7);
    });

    it('returns the fallback for an explicit nullish value', () => {
      expect(coerceInteger(undefined, 0)).toBe(0);
      expect(coerceInteger(null, 0)).toBe(0);
    });
  });

  describe('valid numbers', () => {
    it('accepts a finite integer as-is', () => {
      expect(coerceInteger(42, 0)).toBe(42);
    });

    it('floors a finite non-integer number', () => {
      expect(coerceInteger(42.9, 0)).toBe(42);
      expect(coerceInteger(42.1, 0)).toBe(42);
    });

    it('accepts zero with default options', () => {
      expect(coerceInteger(0, 99)).toBe(0);
    });

    it('accepts a negative number with default options (no min bound)', () => {
      expect(coerceInteger(-5, 99)).toBe(-5);
    });
  });

  describe('valid strings', () => {
    it('parses an integer string via parseInt', () => {
      expect(coerceInteger('42', 0)).toBe(42);
    });

    it('floors a float string', () => {
      expect(coerceInteger('42.9', 0)).toBe(42);
    });

    it('trims surrounding whitespace before parsing', () => {
      expect(coerceInteger('  7  ', 0)).toBe(7);
    });
  });

  describe('min boundary', () => {
    it('accepts the boundary value when min: 0', () => {
      expect(coerceInteger(0, 99, { min: 0 })).toBe(0);
    });

    it('rejects -1 when min: 0 (out-of-range)', () => {
      expect(coerceInteger(-1, 99, { min: 0 })).toBe(99);
    });

    it('accepts 1 when min: 1', () => {
      expect(coerceInteger(1, 99, { min: 1 })).toBe(1);
    });

    it('rejects 0 when min: 1 (out-of-range)', () => {
      expect(coerceInteger(0, 99, { min: 1 })).toBe(99);
    });

    it('rejects a negative string when min: 0', () => {
      expect(coerceInteger('-5', 99, { min: 0 })).toBe(99);
    });
  });

  describe('max boundary', () => {
    it('accepts the boundary value when max is supplied', () => {
      expect(coerceInteger(10, 0, { max: 10 })).toBe(10);
    });

    it('rejects max + 1 (out-of-range)', () => {
      expect(coerceInteger(11, 0, { max: 10 })).toBe(0);
    });
  });

  describe('non-finite numbers', () => {
    it('returns the fallback for NaN', () => {
      expect(coerceInteger(Number.NaN, 7)).toBe(7);
    });

    it('returns the fallback for Infinity', () => {
      expect(coerceInteger(Number.POSITIVE_INFINITY, 7)).toBe(7);
    });

    it('returns the fallback for -Infinity', () => {
      expect(coerceInteger(Number.NEGATIVE_INFINITY, 7)).toBe(7);
    });
  });

  describe('allowUndefined: true', () => {
    it('returns undefined for undefined input', () => {
      expect(
        coerceInteger(undefined, 99, { allowUndefined: true }),
      ).toBeUndefined();
    });

    it('returns undefined for an invalid string', () => {
      expect(
        coerceInteger('not-a-number', 99, { allowUndefined: true }),
      ).toBeUndefined();
    });

    it('returns undefined for NaN', () => {
      expect(
        coerceInteger(Number.NaN, 99, { allowUndefined: true }),
      ).toBeUndefined();
    });

    it('returns undefined for out-of-range values', () => {
      expect(
        coerceInteger(-1, 99, { min: 0, allowUndefined: true }),
      ).toBeUndefined();
      expect(
        coerceInteger(11, 99, { max: 10, allowUndefined: true }),
      ).toBeUndefined();
    });

    it('still floors a valid number (allowUndefined does not bypass truncation)', () => {
      expect(coerceInteger(5, 99, { allowUndefined: true })).toBe(5);
      expect(coerceInteger(5.9, 99, { allowUndefined: true })).toBe(5);
    });

    it('still parses a valid integer string', () => {
      expect(coerceInteger('12', 99, { allowUndefined: true })).toBe(12);
    });
  });

  describe('fallback parameter', () => {
    it('returns the supplied fallback for missing values', () => {
      expect(coerceInteger(undefined, 99)).toBe(99);
      expect(coerceInteger(null, 99)).toBe(99);
    });

    it('returns the supplied fallback for out-of-range values', () => {
      expect(coerceInteger(-1, 42, { min: 0 })).toBe(42);
    });

    it('returns the supplied fallback for non-finite numbers', () => {
      expect(coerceInteger(Number.NaN, 42)).toBe(42);
    });
  });
});
