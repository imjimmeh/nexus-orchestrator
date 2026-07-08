import { coerceBoolean } from './workflow-boolean-helpers';

describe('coerceBoolean', () => {
  it('passes real booleans through unchanged', () => {
    expect(coerceBoolean(true)).toBe(true);
    expect(coerceBoolean(false)).toBe(false);
  });

  it('coerces stringified booleans case-insensitively and ignores surrounding whitespace', () => {
    expect(coerceBoolean('true')).toBe(true);
    expect(coerceBoolean('TRUE')).toBe(true);
    expect(coerceBoolean('  true ')).toBe(true);
    // The bug this guards against: the string "false" is truthy in raw
    // Handlebars #if, so it MUST coerce to the boolean false here.
    expect(coerceBoolean('false')).toBe(false);
    expect(coerceBoolean('False')).toBe(false);
    expect(coerceBoolean(' false ')).toBe(false);
  });

  it('treats empty, null and undefined as false', () => {
    expect(coerceBoolean('')).toBe(false);
    expect(coerceBoolean(null)).toBe(false);
    expect(coerceBoolean(undefined)).toBe(false);
  });
});
