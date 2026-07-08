import { describe, expect, it } from 'vitest';
import { parseDurationToSeconds } from './duration';

describe('parseDurationToSeconds', () => {
  describe('bare numeric inputs are interpreted as seconds', () => {
    it('parses the numeric string "900" as 900 seconds', () => {
      expect(parseDurationToSeconds('900')).toBe(900);
    });

    it('parses the numeric string "3600" as 3600 seconds', () => {
      expect(parseDurationToSeconds('3600')).toBe(3600);
    });

    it('parses the numeric string "1" as 1 second', () => {
      expect(parseDurationToSeconds('1')).toBe(1);
    });

    it('parses the bare number 900 as 900 seconds', () => {
      expect(parseDurationToSeconds(900)).toBe(900);
    });
  });

  describe('suffix inputs', () => {
    it('parses "30s" as 30 seconds', () => {
      expect(parseDurationToSeconds('30s')).toBe(30);
    });

    it('parses "15m" as 900 seconds', () => {
      expect(parseDurationToSeconds('15m')).toBe(900);
    });

    it('parses "24h" as 86_400 seconds', () => {
      expect(parseDurationToSeconds('24h')).toBe(86_400);
    });

    it('parses "7d" as 604_800 seconds', () => {
      expect(parseDurationToSeconds('7d')).toBe(604_800);
    });
  });

  describe('whitespace is trimmed', () => {
    it('parses "  15m  " as 900 seconds', () => {
      expect(parseDurationToSeconds('  15m  ')).toBe(900);
    });

    it('parses " 900 " as 900 seconds', () => {
      expect(parseDurationToSeconds(' 900 ')).toBe(900);
    });
  });

  describe('throws on malformed input', () => {
    it.each([
      ['"banana"', 'banana'],
      ['"15x"', '15x'],
      ['"h" (unit with no amount)', 'h'],
      ['"m" (unit with no amount)', 'm'],
      ['"1.5h" (decimal amount)', '1.5h'],
      ['"-15m" (negative amount)', '-15m'],
      ['"0" (zero is not positive)', '0'],
      ['"0s" (zero with unit is not positive)', '0s'],
      ['"" (empty string)', ''],
      ['"   " (whitespace only)', '   '],
    ] as const)('throws for %s', (_label, input) => {
      expect(() => parseDurationToSeconds(input)).toThrow(
        /parseDurationToSeconds/,
      );
    });
  });

  describe('throws on unsupported units', () => {
    it.each([
      ['"1w" (week unit is unsupported)', '1w'],
      ['"1y" (year unit is unsupported)', '1y'],
      ['"100ms" (millisecond suffix is unsupported)', '100ms'],
    ] as const)('throws for %s', (_label, input) => {
      expect(() => parseDurationToSeconds(input)).toThrow(
        /parseDurationToSeconds/,
      );
    });
  });

  describe('error message', () => {
    it('contains both the function name and the offending value "banana"', () => {
      expect(() => parseDurationToSeconds('banana')).toThrow(
        /parseDurationToSeconds[\s\S]*banana|banana[\s\S]*parseDurationToSeconds/,
      );
    });

    it('contains both the function name and the offending value "1w"', () => {
      expect(() => parseDurationToSeconds('1w')).toThrow(
        /parseDurationToSeconds[\s\S]*1w|1w[\s\S]*parseDurationToSeconds/,
      );
    });

    it('contains both the function name and the offending value ""', () => {
      expect(() => parseDurationToSeconds('')).toThrow(
        /parseDurationToSeconds[\s\S]*""/,
      );
    });

    it('contains both the function name and the offending value "0"', () => {
      expect(() => parseDurationToSeconds('0')).toThrow(
        /parseDurationToSeconds[\s\S]*"0"/,
      );
    });

    it('contains the function name and the offending numeric value 0', () => {
      expect(() => parseDurationToSeconds(0)).toThrow(
        /parseDurationToSeconds[\s\S]*0/,
      );
    });
  });
});
