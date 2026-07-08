import { describe, it, expect } from 'vitest';
import { gatherContributionSources } from './gather-contribution-sources';

const piExtAsset = {
  id: 'ext-001',
  name: 'my-extension',
  runtime: 'ts-module',
  entry: './dist/index.js',
  source: { kind: 'authored' },
  checksum: 'sha256:abc123',
};

describe('gatherContributionSources', () => {
  it('orders sources step → profile → skill and validates each', () => {
    const sources = gatherContributionSources({
      stepInput: { hooks: [{ event: 'session_start', command: 'step' }] },
      profile: { settings: { outputStyle: 'verbose' } },
      skills: [
        {
          metadata: {
            contributions: {
              extensions: [piExtAsset],
            },
          },
        },
      ],
    });
    expect(sources.map((s) => s.origin)).toEqual(['step', 'profile', 'skill']);
    const stepHook = sources[0].contributions.hooks?.[0];
    expect(
      stepHook && 'command' in stepHook ? stepHook.command : undefined,
    ).toBe('step');
    expect(sources[2].contributions.extensions?.[0].name).toBe('my-extension');
  });

  it('drops invalid author input rather than throwing', () => {
    const sources = gatherContributionSources({
      stepInput: { hooks: [{ event: 'not-a-real-event', command: 'x' }] },
      profile: null,
      skills: [],
    });
    expect(sources).toEqual([]);
  });

  it('drops an extension asset with missing required fields', () => {
    // Extension assets require id, name, runtime, entry, source, checksum.
    const sources = gatherContributionSources({
      stepInput: { extensions: [{ name: 'incomplete-ext' }] },
      profile: null,
      skills: [],
    });
    expect(sources).toEqual([]);
  });

  it('ignores skills without a contributions block', () => {
    const sources = gatherContributionSources({
      stepInput: undefined,
      profile: undefined,
      skills: [{ metadata: { foo: 'bar' } }, { metadata: null }],
    });
    expect(sources).toEqual([]);
  });

  it('collects pluginRefs and extensionRefs from a surface alongside hooks', () => {
    const sources = gatherContributionSources({
      stepInput: {
        hooks: [{ event: 'session_start', command: 'do-something' }],
        pluginRefs: ['plug-aaa', 'plug-bbb'],
        extensionRefs: ['ext-ccc'],
      },
      profile: undefined,
      skills: [],
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].origin).toBe('step');
    expect(sources[0].pluginRefs).toEqual(['plug-aaa', 'plug-bbb']);
    expect(sources[0].extensionRefs).toEqual(['ext-ccc']);
    // Hooks are still present in the contributions block.
    expect(sources[0].contributions.hooks).toHaveLength(1);
  });

  it('collects pluginRefs and extensionRefs from profile and skill surfaces', () => {
    const sources = gatherContributionSources({
      stepInput: undefined,
      profile: {
        settings: { outputStyle: 'verbose' },
        pluginRefs: ['plug-from-profile'],
      },
      skills: [
        {
          metadata: {
            contributions: {
              extensions: [piExtAsset],
              extensionRefs: ['ext-from-skill'],
            },
          },
        },
      ],
    });

    expect(sources).toHaveLength(2);
    expect(sources[0].origin).toBe('profile');
    expect(sources[0].pluginRefs).toEqual(['plug-from-profile']);
    expect(sources[0].extensionRefs).toBeUndefined();

    expect(sources[1].origin).toBe('skill');
    expect(sources[1].extensionRefs).toEqual(['ext-from-skill']);
    expect(sources[1].pluginRefs).toBeUndefined();
  });

  it('yields empty/no refs when a surface carries no pluginRefs or extensionRefs', () => {
    const sources = gatherContributionSources({
      stepInput: { hooks: [{ event: 'session_start', command: 'x' }] },
      profile: undefined,
      skills: [],
    });

    expect(sources).toHaveLength(1);
    // Spread of empty refs object must not set these keys at all.
    expect(sources[0].pluginRefs).toBeUndefined();
    expect(sources[0].extensionRefs).toBeUndefined();
  });
});
