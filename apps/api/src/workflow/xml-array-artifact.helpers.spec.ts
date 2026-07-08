import { describe, it, expect } from 'vitest';
import {
  containsXmlArrayArtifact,
  normalizeXmlArrayArtifacts,
} from './xml-array-artifact.helpers';

describe('normalizeXmlArrayArtifacts', () => {
  it('unwraps a sole-key {item: array} object into the array', () => {
    expect(normalizeXmlArrayArtifacts({ item: [1, 2, 3] })).toEqual([1, 2, 3]);
  });

  it('unwraps nested {item: array} artifacts recursively', () => {
    const input = {
      candidate_records: {
        item: [
          {
            title: 'A',
            evidenceRefs: { item: ['ref-1', 'ref-2'] },
          },
        ],
      },
    };

    expect(normalizeXmlArrayArtifacts(input)).toEqual({
      candidate_records: [
        {
          title: 'A',
          evidenceRefs: ['ref-1', 'ref-2'],
        },
      ],
    });
  });

  it('wraps a sole-key { item: plainObject } into a single-element array', () => {
    expect(normalizeXmlArrayArtifacts({ item: { nested: true } })).toEqual([
      { nested: true },
    ]);
  });

  it('handles a nested single-item XML artifact with nested array fields', () => {
    const input = {
      candidate_records: {
        item: {
          title: 'Fix threshold trigger',
          priority: 'p1',
          evidenceRefs: { item: ['probe-result', 'ceo-decision'] },
          goalAlignment: { item: ['AI can self-improve'] },
        },
      },
    };
    expect(normalizeXmlArrayArtifacts(input)).toEqual({
      candidate_records: [
        {
          title: 'Fix threshold trigger',
          priority: 'p1',
          evidenceRefs: ['probe-result', 'ceo-decision'],
          goalAlignment: ['AI can self-improve'],
        },
      ],
    });
  });

  it('does not unwrap when "item" value is a primitive', () => {
    expect(normalizeXmlArrayArtifacts({ item: 5 })).toEqual({ item: 5 });
    expect(normalizeXmlArrayArtifacts({ item: 'string' })).toEqual({
      item: 'string',
    });
    expect(normalizeXmlArrayArtifacts({ item: null })).toEqual({ item: null });
  });

  it('does not unwrap an object that has additional keys alongside "item"', () => {
    const input = { item: [1, 2], total: 2 };
    expect(normalizeXmlArrayArtifacts(input)).toEqual({
      item: [1, 2],
      total: 2,
    });
  });

  it('preserves a legitimate "item" field nested inside a multi-key object', () => {
    const input = { name: 'widget', item: 'sku-123' };
    expect(normalizeXmlArrayArtifacts(input)).toEqual({
      name: 'widget',
      item: 'sku-123',
    });
  });

  it('normalizes artifacts inside array elements', () => {
    const input = [{ tags: { item: ['x'] } }, { tags: { item: ['y', 'z'] } }];
    expect(normalizeXmlArrayArtifacts(input)).toEqual([
      { tags: ['x'] },
      { tags: ['y', 'z'] },
    ]);
  });

  it('passes through primitives and empty structures unchanged', () => {
    expect(normalizeXmlArrayArtifacts('hello')).toBe('hello');
    expect(normalizeXmlArrayArtifacts(42)).toBe(42);
    expect(normalizeXmlArrayArtifacts(null)).toBeNull();
    expect(normalizeXmlArrayArtifacts({})).toEqual({});
    expect(normalizeXmlArrayArtifacts([])).toEqual([]);
  });

  it('unwraps a double-wrapped {item: [{item: array}]} array-of-arrays', () => {
    expect(normalizeXmlArrayArtifacts({ item: [{ item: [1] }] })).toEqual([
      [1],
    ]);
  });
});

describe('containsXmlArrayArtifact', () => {
  it('returns true when a sole-key {item: array} artifact is present', () => {
    expect(containsXmlArrayArtifact({ item: [1] })).toBe(true);
    expect(
      containsXmlArrayArtifact({ data: { evidenceRefs: { item: ['a'] } } }),
    ).toBe(true);
  });

  it('returns true for a sole-key { item: plainObject } artifact', () => {
    expect(containsXmlArrayArtifact({ item: { nested: true } })).toBe(true);
    expect(
      containsXmlArrayArtifact({
        candidate_records: { item: { title: 'x' } },
      }),
    ).toBe(true);
  });

  it('returns false when no artifact is present', () => {
    expect(containsXmlArrayArtifact({ item: 5 })).toBe(false);
    expect(containsXmlArrayArtifact({ item: [1], total: 1 })).toBe(false);
    expect(
      containsXmlArrayArtifact({ candidate_records: [{ title: 'A' }] }),
    ).toBe(false);
    expect(containsXmlArrayArtifact('plain')).toBe(false);
  });
});
