import { describe, it, expect } from 'vitest';
import { applyOverride } from './override-merge';

describe('applyOverride', () => {
  it('replace returns the override definition verbatim', () => {
    const out = applyOverride(
      { a: 1, b: 2 },
      { strategy: 'replace', definition: { a: 9 }, overrides: null },
    );
    expect(out).toEqual({ a: 9 });
  });

  it('merge shallow-merges the patch over the base (patch wins)', () => {
    const out = applyOverride(
      { a: 1, b: 2, nested: { x: 1 } },
      {
        strategy: 'merge',
        definition: null,
        overrides: { b: 5, nested: { y: 2 } },
      },
    );
    expect(out).toEqual({ a: 1, b: 5, nested: { y: 2 } });
  });

  it('merge arrays replace, never concatenate', () => {
    const out = applyOverride(
      { tags: ['a', 'b'] },
      { strategy: 'merge', definition: null, overrides: { tags: ['c'] } },
    );
    expect(out).toEqual({ tags: ['c'] });
  });
});
