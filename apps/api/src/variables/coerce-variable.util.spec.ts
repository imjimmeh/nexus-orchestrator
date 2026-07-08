import { describe, it, expect } from 'vitest';
import { coerceVariableValue } from './coerce-variable.util';

describe('coerceVariableValue', () => {
  it('coerces numeric strings to numbers', () => {
    expect(coerceVariableValue('10', 'number')).toBe(10);
  });
  it('passes through real numbers', () => {
    expect(coerceVariableValue(10, 'number')).toBe(10);
  });
  it('coerces "true"/"false" strings to booleans', () => {
    expect(coerceVariableValue('true', 'boolean')).toBe(true);
    expect(coerceVariableValue('false', 'boolean')).toBe(false);
  });
  it('passes through real booleans', () => {
    expect(coerceVariableValue(true, 'boolean')).toBe(true);
  });
  it('returns strings unchanged for string type', () => {
    expect(coerceVariableValue('auto', 'string')).toBe('auto');
  });
  it('returns json values unchanged', () => {
    const obj = { a: 1 };
    expect(coerceVariableValue(obj, 'json')).toBe(obj);
  });
});
