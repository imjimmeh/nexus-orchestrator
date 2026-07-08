import { describe, it, expect, vi } from 'vitest';
import { AdminAccessIntegrityService } from './admin-access-integrity.service';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

describe('AdminAccessIntegrityService', () => {
  it('queries user_roles left-joined against root-scoped role_assignments', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([]) };
    const svc = new AdminAccessIntegrityService(dataSource as never);
    await svc.findLegacyRolesMissingRootAssignment();
    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).toContain('user_roles');
    expect(sql).toContain('role_assignments');
    expect(params).toEqual([GLOBAL_SCOPE_NODE_ID]);
  });

  it('returns the orphaned legacy role rows', async () => {
    const dataSource = {
      query: vi.fn().mockResolvedValue([{ user_id: 'u1', role_id: 'r1' }]),
    };
    const svc = new AdminAccessIntegrityService(dataSource as never);
    const orphans = await svc.findLegacyRolesMissingRootAssignment();
    expect(orphans).toEqual([{ userId: 'u1', roleId: 'r1' }]);
  });

  it('onApplicationBootstrap logs an error when orphans exist and stays non-fatal', async () => {
    const dataSource = {
      query: vi.fn().mockResolvedValue([{ user_id: 'u1', role_id: 'r1' }]),
    };
    const svc = new AdminAccessIntegrityService(dataSource as never);
    const errorSpy = vi
      .spyOn(
        (svc as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('onApplicationBootstrap is silent when every legacy role has a root assignment', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([]) };
    const svc = new AdminAccessIntegrityService(dataSource as never);
    const errorSpy = vi
      .spyOn(
        (svc as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    await svc.onApplicationBootstrap();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('onApplicationBootstrap stays non-fatal when the query itself rejects', async () => {
    const dataSource = {
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    const svc = new AdminAccessIntegrityService(dataSource as never);
    const errorSpy = vi
      .spyOn(
        (svc as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
