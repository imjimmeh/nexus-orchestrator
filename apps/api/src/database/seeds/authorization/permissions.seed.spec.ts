import { describe, it, expect, vi } from 'vitest';
import { PermissionSeedService } from './permissions.seed';
import { PERMISSION_CATALOG } from '../../../auth/authorization/permission-catalog';

describe('PermissionSeedService', () => {
  it('inserts every catalog permission idempotently', async () => {
    const repo = {
      findOne: vi.fn().mockResolvedValue(null),
      create: (x: any) => x,
      save: vi.fn(),
    } as any;
    await new PermissionSeedService(repo).seed();
    expect(repo.save).toHaveBeenCalledTimes(PERMISSION_CATALOG.length);
  });
  it('skips existing permissions', async () => {
    const repo = {
      findOne: vi.fn().mockResolvedValue({ id: 'x' }),
      create: (x: any) => x,
      save: vi.fn(),
    } as any;
    await new PermissionSeedService(repo).seed();
    expect(repo.save).not.toHaveBeenCalled();
  });
});
