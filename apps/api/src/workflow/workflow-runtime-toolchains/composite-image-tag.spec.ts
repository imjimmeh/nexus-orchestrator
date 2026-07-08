import { describe, it, expect } from 'vitest';
import { computeCompositeImageTag, isNodeOnly } from './composite-image-tag';

const base = { harnessId: 'pi', baseImageId: 'sha256:abc' };

describe('computeCompositeImageTag', () => {
  it('is order-independent for toolchains and apt', () => {
    const a = computeCompositeImageTag({
      ...base,
      config: {
        toolchains: [
          { tool: 'go', version: '1' },
          { tool: 'python', version: '3' },
        ],
        aptPackages: ['b', 'a'],
      },
    });
    const b = computeCompositeImageTag({
      ...base,
      config: {
        toolchains: [
          { tool: 'python', version: '3' },
          { tool: 'go', version: '1' },
        ],
        aptPackages: ['a', 'b'],
      },
    });
    expect(a).toBe(b);
  });

  it('changes when the base image id changes', () => {
    const cfg = { toolchains: [{ tool: 'go', version: '1' }] };
    expect(computeCompositeImageTag({ ...base, config: cfg })).not.toBe(
      computeCompositeImageTag({
        ...base,
        baseImageId: 'sha256:def',
        config: cfg,
      }),
    );
  });

  it('uses the nexus-rt/<harnessId>: prefix and a 12-char hex tag', () => {
    const tag = computeCompositeImageTag({
      ...base,
      config: { toolchains: [{ tool: 'go', version: '1' }] },
    });
    expect(tag).toMatch(/^nexus-rt\/pi:[0-9a-f]{12}$/);
  });
});

describe('isNodeOnly', () => {
  it('is true for empty and node-only sets', () => {
    expect(isNodeOnly({ toolchains: [] })).toBe(true);
    expect(isNodeOnly({ toolchains: [{ tool: 'node', version: '24' }] })).toBe(
      true,
    );
  });
  it('is false when any non-node tool is present', () => {
    expect(
      isNodeOnly({ toolchains: [{ tool: 'python', version: '3.12' }] }),
    ).toBe(false);
  });
  it('is false when apt packages are requested even if node-only', () => {
    expect(isNodeOnly({ toolchains: [], aptPackages: ['libpq-dev'] })).toBe(
      false,
    );
  });
});
