import { describe, expect, it } from 'vitest';
import { ThinkingLevelResolver } from './thinking-level-resolver.service';

function makeResolver(supported: string[]) {
  const capability = {
    getSupportedLevels: async () => supported,
  } as never;
  return new ThinkingLevelResolver(capability);
}

const base = {
  provider: 'anthropic',
  modelId: 'm',
  harnessSupportsThinkingLevels: true,
};

describe('ThinkingLevelResolver', () => {
  it('omits (dropped:false) when nothing is configured', async () => {
    const r = makeResolver(['off', 'high']);
    await expect(r.resolve({ ...base })).resolves.toEqual({ dropped: false });
  });

  it('returns the resolved level unchanged when supported', async () => {
    const r = makeResolver(['off', 'low', 'high']);
    await expect(r.resolve({ ...base, modelDefault: 'high' })).resolves.toEqual(
      { level: 'high' },
    );
  });

  it('clamps and reports clampedFrom', async () => {
    const r = makeResolver(['off', 'low', 'medium']);
    await expect(r.resolve({ ...base, stepInput: 'xhigh' })).resolves.toEqual({
      level: 'medium',
      clampedFrom: 'xhigh',
    });
  });

  it('drops when the harness does not support thinking', async () => {
    const r = makeResolver(['high']);
    await expect(
      r.resolve({
        ...base,
        harnessSupportsThinkingLevels: false,
        modelDefault: 'high',
      }),
    ).resolves.toEqual({ dropped: true });
  });

  it('drops when the model supports no non-off level', async () => {
    const r = makeResolver(['off']);
    await expect(r.resolve({ ...base, modelDefault: 'high' })).resolves.toEqual(
      { dropped: true },
    );
  });

  it('honors step > profile > model-default precedence', async () => {
    const r = makeResolver(['off', 'low', 'medium', 'high']);
    await expect(
      r.resolve({
        ...base,
        stepInput: 'high',
        agentProfile: 'low',
        modelDefault: 'medium',
      }),
    ).resolves.toEqual({ level: 'high' });
  });
});
