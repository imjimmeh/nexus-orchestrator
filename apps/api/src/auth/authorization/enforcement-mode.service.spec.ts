import { describe, it, expect, vi } from 'vitest';
import { EnforcementModeService } from './enforcement-mode.service';

describe('EnforcementModeService', () => {
  function make(values: Record<string, string>) {
    const settings = {
      get: vi.fn(async (key: string, def: unknown) => values[key] ?? def),
    } as any;
    return new EnforcementModeService(settings);
  }

  it('defaults to audit when nothing configured', async () => {
    expect(await make({}).getMode('workflows')).toBe('audit');
  });

  it('returns the resource-specific mode when set', async () => {
    const svc = make({ 'rbac_enforcement_mode.workflows': 'enforce' });
    expect(await svc.getMode('workflows')).toBe('enforce');
  });

  it('falls back to the global override when no resource key', async () => {
    const svc = make({ 'rbac_enforcement_mode.__global__': 'warn' });
    expect(await svc.getMode('agents')).toBe('warn');
  });

  it('prefers the resource key over the global override', async () => {
    const svc = make({
      'rbac_enforcement_mode.__global__': 'audit',
      'rbac_enforcement_mode.agents': 'enforce',
    });
    expect(await svc.getMode('agents')).toBe('enforce');
  });

  it('coerces an unknown stored value to audit (fail-safe)', async () => {
    const svc = make({ 'rbac_enforcement_mode.workflows': 'banana' });
    expect(await svc.getMode('workflows')).toBe('audit');
  });
});
