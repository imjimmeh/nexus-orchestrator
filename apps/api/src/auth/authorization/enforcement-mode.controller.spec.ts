import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { EnforcementModeController } from './enforcement-mode.controller';
import { RESOURCES } from './permission-catalog';

describe('EnforcementModeController', () => {
  it('lists the mode for every catalog resource', async () => {
    const enforcement = { getMode: vi.fn().mockResolvedValue('audit') } as any;
    const settings = { set: vi.fn() } as any;
    const res = await new EnforcementModeController(
      enforcement,
      settings,
    ).list();
    expect(Object.keys(res.modes)).toEqual([...RESOURCES]);
  });

  it('rejects an unknown mode value with BadRequestException', async () => {
    const controller = new EnforcementModeController(
      { getMode: vi.fn() } as any,
      { set: vi.fn() } as any,
    );
    await expect(
      controller.setMode('workflows', { mode: 'nope' as any }),
    ).rejects.toThrow(BadRequestException);
  });

  it('persists a valid mode via settings', async () => {
    const settings = { set: vi.fn().mockResolvedValue({}) } as any;
    const controller = new EnforcementModeController(
      { getMode: vi.fn() } as any,
      settings,
    );
    await controller.setMode('workflows', { mode: 'enforce' });
    expect(settings.set).toHaveBeenCalledWith(
      'rbac_enforcement_mode.workflows',
      'enforce',
      expect.any(String),
    );
  });
});
