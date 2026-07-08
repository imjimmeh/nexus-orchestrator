import { describe, expect, it } from 'vitest';
import type { OutputContractTypeSchema } from '@nexus/core';
import {
  describeExpectedType,
  describeRuntimeType,
  findOutputContractTypeMismatch,
  isOutputContractType,
  isOutputContractTypeSchema,
  matchesOutputContractType,
} from './workflow-output-contract-type.helpers';

describe('isOutputContractType', () => {
  it('returns true for allowed types', () => {
    expect(isOutputContractType('array')).toBe(true);
    expect(isOutputContractType('string')).toBe(true);
  });

  it('returns false for disallowed strings and non-strings', () => {
    expect(isOutputContractType('float')).toBe(false);
    expect(isOutputContractType(1)).toBe(false);
  });
});

describe('isOutputContractTypeSchema', () => {
  it('returns true for scalar type strings', () => {
    expect(isOutputContractTypeSchema('string')).toBe(true);
    expect(isOutputContractTypeSchema('array')).toBe(true);
  });

  it('returns true for array schema with item type', () => {
    expect(isOutputContractTypeSchema({ type: 'array', items: 'string' })).toBe(
      true,
    );
  });

  it('returns true for object schema with property types', () => {
    expect(
      isOutputContractTypeSchema({
        type: 'object',
        properties: { name: 'string' },
      }),
    ).toBe(true);
  });

  it('returns false for object schema with invalid property type', () => {
    expect(
      isOutputContractTypeSchema({
        type: 'object',
        properties: { name: 'float' },
      }),
    ).toBe(false);
  });

  it('returns false for array schema missing items', () => {
    expect(isOutputContractTypeSchema({ type: 'array' })).toBe(true);
  });
});

describe('matchesOutputContractType', () => {
  it('matches arrays when expected type is array', () => {
    expect(matchesOutputContractType([], 'array')).toBe(true);
    expect(matchesOutputContractType('', 'array')).toBe(false);
  });

  it('matches objects but not arrays when expected type is object', () => {
    expect(matchesOutputContractType({}, 'object')).toBe(true);
    expect(matchesOutputContractType([], 'object')).toBe(false);
  });

  it('matches integers precisely', () => {
    expect(matchesOutputContractType(42, 'integer')).toBe(true);
    expect(matchesOutputContractType(3.14, 'integer')).toBe(false);
  });

  it('validates array item types', () => {
    const schema = { type: 'array' as const, items: 'string' as const };
    expect(matchesOutputContractType(['a', 'b'], schema)).toBe(true);
    expect(matchesOutputContractType(['a', 1], schema)).toBe(false);
  });

  it('validates object property types', () => {
    const schema = {
      type: 'object' as const,
      properties: { name: 'string' as const, count: 'integer' as const },
    };
    expect(matchesOutputContractType({ name: 'x', count: 1 }, schema)).toBe(
      true,
    );
    expect(matchesOutputContractType({ name: 'x', count: '1' }, schema)).toBe(
      false,
    );
  });

  it('describes runtime types', () => {
    expect(describeRuntimeType([])).toBe('array');
    expect(describeRuntimeType(null)).toBe('null');
    expect(describeRuntimeType('x')).toBe('string');
  });
});

describe('findOutputContractTypeMismatch', () => {
  it('returns the first array item mismatch with path', () => {
    const schema = { type: 'array' as const, items: 'string' as const };
    const mismatch = findOutputContractTypeMismatch(
      ['a', 1, 'b'],
      schema,
      'items',
    );
    expect(mismatch).toEqual({
      field: 'items[1]',
      expected: 'string',
      actual: 'number',
    });
  });

  it('returns nested object property mismatch with path', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        name: 'string' as const,
        tags: { type: 'array' as const, items: 'string' as const },
      },
    };
    const mismatch = findOutputContractTypeMismatch(
      { name: 'x', tags: ['a', 2] },
      schema,
      'entry',
    );
    expect(mismatch).toEqual({
      field: 'entry.tags[1]',
      expected: 'string',
      actual: 'number',
    });
  });
});

describe('describeExpectedType', () => {
  it('describes scalar types', () => {
    expect(describeExpectedType('string')).toBe('string');
  });

  it('describes array with item type', () => {
    expect(describeExpectedType({ type: 'array', items: 'string' })).toBe(
      'array<string>',
    );
  });

  it('describes object with properties', () => {
    expect(
      describeExpectedType({
        type: 'object',
        properties: { name: 'string', count: 'integer' },
      }),
    ).toBe('object { name: string, count: integer }');
  });
});

describe('child_ac_assignments deep output-contract schema', () => {
  const CHILD_AC_ASSIGNMENTS_SCHEMA: OutputContractTypeSchema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        child_ref: 'string',
        ac_ids: { type: 'array', items: 'string' },
      },
    },
  };

  it('is accepted by the workflow output-contract validator', () => {
    expect(isOutputContractTypeSchema(CHILD_AC_ASSIGNMENTS_SCHEMA)).toBe(true);
  });

  it('rejects the degenerate placeholder array [""]', () => {
    const mismatch = findOutputContractTypeMismatch(
      [''],
      CHILD_AC_ASSIGNMENTS_SCHEMA,
      'child_ac_assignments',
    );
    expect(mismatch).toBeDefined();
    expect(mismatch?.field).toBe('child_ac_assignments[0]');
  });

  it('accepts a well-formed array of assignment objects', () => {
    const mismatch = findOutputContractTypeMismatch(
      [
        { child_ref: 'p-child-1', ac_ids: ['AC-1', 'AC-2'] },
        { child_ref: 'p-child-2', ac_ids: ['AC-3'] },
      ],
      CHILD_AC_ASSIGNMENTS_SCHEMA,
      'child_ac_assignments',
    );
    expect(mismatch).toBeUndefined();
  });
});
