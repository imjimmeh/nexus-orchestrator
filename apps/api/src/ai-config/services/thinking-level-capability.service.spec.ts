import { describe, expect, it, vi } from 'vitest';

const getModel = vi.fn();
const getSupportedThinkingLevels = vi.fn();
vi.mock('@earendil-works/pi-ai', () => ({
  getModel: (...a: unknown[]) => getModel(...a),
  getSupportedThinkingLevels: (...a: unknown[]) =>
    getSupportedThinkingLevels(...a),
}));

import { ThinkingLevelCapabilityService } from './thinking-level-capability.service';

describe('ThinkingLevelCapabilityService', () => {
  const svc = new ThinkingLevelCapabilityService();

  it('returns pi-SDK supported levels when the model is in the catalog', async () => {
    getModel.mockReturnValue({ id: 'm', provider: 'anthropic' });
    getSupportedThinkingLevels.mockReturnValue(['off', 'high', 'xhigh']);
    await expect(
      svc.getSupportedLevels({ provider: 'anthropic', modelId: 'm' }),
    ).resolves.toEqual(['off', 'high', 'xhigh']);
  });

  it('falls back to thinkingLevelMap non-null keys when not in the catalog', async () => {
    getModel.mockImplementation(() => {
      throw new Error('unknown model');
    });
    await expect(
      svc.getSupportedLevels({
        provider: 'custom',
        modelId: 'x',
        thinkingLevelMap: { low: 'x-low', high: null, medium: 'x-med' },
      }),
    ).resolves.toEqual(expect.arrayContaining(['low', 'medium']));
  });

  it('returns [] when neither catalog nor map knows the model', async () => {
    getModel.mockReturnValue(undefined);
    await expect(
      svc.getSupportedLevels({ provider: 'custom', modelId: 'x' }),
    ).resolves.toEqual([]);
  });
});
