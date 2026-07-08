import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from './authorization.service';
import { ScopeAccessService } from './scope-access.service';
import { PermissionsGuard } from './permissions.guard';

const USER_UUID = 'a1b2c3d4-e5f6-4789-abcd-000000000001';
const SCOPE_UUID = 'b2c3d4e5-f6a7-4890-bcde-000000000002';

function guardCtx(user: unknown) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user, params: {}, query: {}, body: {} }),
    }),
  } as never;
}

describe('role_assignments is the single authorization authority', () => {
  it('AuthorizationService resolves from role_assignments and never touches user_roles', async () => {
    const repo = { query: vi.fn().mockResolvedValue([]) } as never;
    const svc = new AuthorizationService(repo);
    await svc.getEffectivePermissions(USER_UUID, SCOPE_UUID);
    const sql = (repo as { query: { mock: { calls: string[][] } } }).query.mock
      .calls[0][0];
    expect(sql).toContain('role_assignments');
    expect(sql).not.toMatch(/user_roles/i);
  });

  it('ScopeAccessService resolves from role_assignments and never touches user_roles', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([]) };
    const svc = new ScopeAccessService(dataSource as never);
    await svc.getAccessibleScopeIds(USER_UUID, 'scopes:read');
    const sql = dataSource.query.mock.calls[0][0] as string;
    expect(sql).toContain('role_assignments');
    expect(sql).not.toMatch(/user_roles/i);
  });

  it('PermissionsGuard ignores JWT role names; a denied user with roles=["admin"] is still denied', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('workflows:read'),
    } as unknown as Reflector;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as never;
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as never;
    const authz = { can: vi.fn().mockResolvedValue(false) } as never;
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );

    const decision = await guard.canActivate(
      guardCtx({ userId: USER_UUID, roles: ['admin', 'platform_admin'] }),
    );

    expect(decision).toBe(false);
    // Decision came from role_assignments-backed can(), not the JWT roles claim.
    expect(
      (authz as { can: { mock: { calls: unknown[][] } } }).can,
    ).toHaveBeenCalledWith(USER_UUID, 'workflows:read', expect.any(String), [
      'admin',
      'platform_admin',
    ]);
  });
});
