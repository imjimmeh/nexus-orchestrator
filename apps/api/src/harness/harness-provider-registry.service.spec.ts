import { HarnessProviderRegistryService } from './harness-provider-registry.service';

describe('HarnessProviderRegistryService', () => {
  const svc = new HarnessProviderRegistryService();

  it('resolves the built-in pi entry', () => {
    const e = svc.resolve('pi');
    expect(e.harnessId).toBe('pi');
    expect(e.transport).toBe('kernel');
    expect(e.capabilities.toolModel).toBe('execute_wrapped');
  });

  it('resolves the built-in claude-code entry', () => {
    const e = svc.resolve('claude-code');
    expect(e.capabilities.toolModel).toBe('permission_callback');
    expect(e.capabilities.supportsBranching).toBe(false);
  });

  it('throws on an unknown harness id', () => {
    expect(() => svc.resolve('custom:nope')).toThrow(/not registered/i);
  });

  it('lists enabled built-ins', () => {
    expect(
      svc
        .list()
        .map((e) => e.harnessId)
        .sort(),
    ).toEqual(['claude-code', 'pi']);
  });

  describe('validateForStep', () => {
    it('returns satisfied selection when capabilities match', () => {
      const r = svc.validateForStep('pi', { supportsBranching: true });
      expect(r.harnessId).toBe('pi');
      expect(r.fallbackReason).toBeUndefined();
    });

    it('falls back to platform default when claude-code is asked to branch', () => {
      const r = svc.validateForStep(
        'claude-code',
        { supportsBranching: true },
        'pi',
      );
      expect(r.harnessId).toBe('pi');
      expect(r.fallbackReason).toMatch(/branching/i);
    });
  });
});
