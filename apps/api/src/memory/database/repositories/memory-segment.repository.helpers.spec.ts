import { describe, expect, it } from 'vitest';
import { IsNull } from 'typeorm';
import { buildReadWhere } from './memory-segment.repository.helpers';

describe('buildReadWhere', () => {
  it('adds archived_at: IsNull() when base is undefined and includeArchived is false', () => {
    const result = buildReadWhere(undefined, false);

    expect(result).toEqual({ archived_at: IsNull() });
  });

  it('merges archived_at: IsNull() with the supplied base when includeArchived is false', () => {
    const result = buildReadWhere({ entity_type: 'foo' }, false);

    expect(result).toEqual({
      entity_type: 'foo',
      archived_at: IsNull(),
    });
  });

  it('returns the base unchanged when includeArchived is true', () => {
    const result = buildReadWhere({ entity_type: 'foo' }, true);

    expect(result).toEqual({ entity_type: 'foo' });
  });

  it('returns an empty object when base is undefined and includeArchived is true', () => {
    const result = buildReadWhere(undefined, true);

    expect(result).toEqual({});
  });
});
