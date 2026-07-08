import {
  assignDirectValues,
  assignIfDefined,
  normalizeHeaders,
  normalizeNullableString,
  normalizeStringArray,
} from './server-payload.utils';

describe('server payload utilities', () => {
  it('normalizes nullable strings and string arrays', () => {
    expect(normalizeNullableString(undefined)).toBeNull();
    expect(normalizeNullableString('  value  ')).toBe('value');
    expect(normalizeNullableString('   ')).toBeNull();

    expect(normalizeStringArray([' alpha ', '', ' beta '])).toEqual([
      'alpha',
      'beta',
    ]);
    expect(normalizeStringArray(['  '])).toBeNull();
  });

  it('normalizes headers and skips empty keys or values', () => {
    expect(
      normalizeHeaders({
        ' Authorization ': ' Bearer token ',
        ' ': 'x',
        y: ' ',
      }),
    ).toEqual({ Authorization: 'Bearer token' });
  });

  it('assigns only defined values', () => {
    const target: Partial<{ name: string; enabled: boolean }> = {};

    assignIfDefined(target, 'name', 'server');
    assignIfDefined(target, 'enabled', undefined);
    assignDirectValues(target, { enabled: false, name: undefined });

    expect(target).toEqual({ name: 'server', enabled: false });
  });
});
