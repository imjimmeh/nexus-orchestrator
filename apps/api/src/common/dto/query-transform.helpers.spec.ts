import {
  toBooleanWithDefault,
  toBoundedInt,
  toOptionalCsvList,
  toOptionalDateOrNull,
  toOptionalPositiveInt,
} from './query-transform.helpers';
import { describe, expect, it } from 'vitest';

describe('query-transform.helpers', () => {
  describe('toBoundedInt', () => {
    it('returns default for missing values', () => {
      expect(
        toBoundedInt(undefined, { defaultValue: 50, min: 1, max: 100 }),
      ).toBe(50);
    });

    it('clamps parsed values to provided bounds', () => {
      expect(toBoundedInt('999', { defaultValue: 50, min: 1, max: 100 })).toBe(
        100,
      );
      expect(toBoundedInt('-5', { defaultValue: 50, min: 1, max: 100 })).toBe(
        1,
      );
    });

    it('returns default for non-integer values', () => {
      expect(toBoundedInt('abc', { defaultValue: 50, min: 1, max: 100 })).toBe(
        50,
      );
      expect(toBoundedInt('1.5', { defaultValue: 50, min: 1, max: 100 })).toBe(
        50,
      );
    });
  });

  describe('toOptionalPositiveInt', () => {
    it('returns undefined for missing/invalid values', () => {
      expect(toOptionalPositiveInt(undefined)).toBeUndefined();
      expect(toOptionalPositiveInt('0')).toBeUndefined();
      expect(toOptionalPositiveInt('-1')).toBeUndefined();
      expect(toOptionalPositiveInt('abc')).toBeUndefined();
    });

    it('returns a number for positive integers', () => {
      expect(toOptionalPositiveInt('5')).toBe(5);
      expect(toOptionalPositiveInt(7)).toBe(7);
    });
  });

  describe('toBooleanWithDefault', () => {
    it('parses true-like and false-like string values', () => {
      expect(toBooleanWithDefault('true')).toBe(true);
      expect(toBooleanWithDefault('1')).toBe(true);
      expect(toBooleanWithDefault('false')).toBe(false);
      expect(toBooleanWithDefault('0')).toBe(false);
    });

    it('falls back to default when value is unknown', () => {
      expect(toBooleanWithDefault('nope', true)).toBe(true);
      expect(toBooleanWithDefault(undefined, false)).toBe(false);
    });
  });

  describe('toOptionalCsvList', () => {
    it('returns undefined for non-string inputs', () => {
      expect(toOptionalCsvList(undefined)).toBeUndefined();
      expect(toOptionalCsvList(42)).toBeUndefined();
    });

    it('returns trimmed non-empty entries', () => {
      expect(toOptionalCsvList('todo, in-progress, , done')).toEqual([
        'todo',
        'in-progress',
        'done',
      ]);
    });
  });

  describe('toOptionalDateOrNull', () => {
    it('returns undefined for undefined and null for blank values', () => {
      expect(toOptionalDateOrNull(undefined)).toBeUndefined();
      expect(toOptionalDateOrNull(null)).toBeNull();
      expect(toOptionalDateOrNull('')).toBeNull();
      expect(toOptionalDateOrNull('   ')).toBeNull();
    });

    it('returns Date for valid date strings', () => {
      const value = toOptionalDateOrNull('2026-04-18T12:00:00.000Z');
      expect(value).toBeInstanceOf(Date);
      expect((value as Date).toISOString()).toBe('2026-04-18T12:00:00.000Z');
    });
  });
});
