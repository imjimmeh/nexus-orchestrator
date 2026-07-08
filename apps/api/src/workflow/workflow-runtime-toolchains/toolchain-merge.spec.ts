import { describe, it, expect } from 'vitest';
import { mergeToolchainLayers } from './toolchain-merge';

describe('mergeToolchainLayers', () => {
  it('takes toolchains from the first non-empty layer', () => {
    const out = mergeToolchainLayers([
      { toolchains: [] },
      { toolchains: [{ tool: 'python', version: '3.12' }] },
      { toolchains: [{ tool: 'go', version: '1.23' }] },
    ]);
    expect(out.toolchains).toEqual([{ tool: 'python', version: '3.12' }]);
  });

  it('unions caches by id, first occurrence wins', () => {
    const out = mergeToolchainLayers([
      { toolchains: [], caches: [{ id: 'a', path: '/a1' }] },
      {
        toolchains: [],
        caches: [
          { id: 'a', path: '/a2' },
          { id: 'b', path: '/b' },
        ],
      },
    ]);
    expect(out.caches).toEqual([
      { id: 'a', path: '/a1' },
      { id: 'b', path: '/b' },
    ]);
  });

  it('unions disableCaches', () => {
    const out = mergeToolchainLayers([
      { toolchains: [], disableCaches: ['apt'] },
      { toolchains: [], disableCaches: ['apt', 'maven'] },
    ]);
    expect(out.disableCaches?.sort()).toEqual(['apt', 'maven']);
  });

  it('ignores undefined layers and defaults arrays', () => {
    const out = mergeToolchainLayers([undefined, undefined]);
    expect(out).toEqual({
      toolchains: [],
      aptPackages: [],
      caches: [],
      disableCaches: [],
    });
  });
});
