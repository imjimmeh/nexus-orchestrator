import { describe, it, expect, vi } from 'vitest';
import { HarnessScopedDefaultsController } from './harness-scoped-defaults.controller';

describe('HarnessScopedDefaultsController', () => {
  it('getPlatform reads the null-scope default', async () => {
    const svc = {
      getForScope: vi.fn(async () => ({ harnessId: 'pi' })),
      setForScope: vi.fn(),
    } as never;
    const ctrl = new HarnessScopedDefaultsController(svc);
    expect(await ctrl.getPlatform()).toEqual({ harnessId: 'pi' });
  });

  it('getForScope reads a scoped default', async () => {
    const getForScope = vi.fn(async () => ({ harnessId: 'claude-code' }));
    const svc = { getForScope, setForScope: vi.fn() } as never;
    const ctrl = new HarnessScopedDefaultsController(svc);
    expect(await ctrl.getForScope('scope-a')).toEqual({
      harnessId: 'claude-code',
    });
    expect(getForScope).toHaveBeenCalledWith('scope-a');
  });

  it('setForScope delegates the patch to the service', async () => {
    const setForScope = vi.fn(async () => ({ harnessId: 'claude-code' }));
    const svc = { getForScope: vi.fn(), setForScope } as never;
    const ctrl = new HarnessScopedDefaultsController(svc);
    await ctrl.setForScope('scope-a', {
      harnessId: 'claude-code',
      providerName: 'anthropic',
    });
    expect(setForScope).toHaveBeenCalledWith('scope-a', {
      harnessId: 'claude-code',
      providerName: 'anthropic',
    });
  });
});
