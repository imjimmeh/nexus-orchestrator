import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

function ctx(user: any, params: any = {}, query: any = {}, body: any = {}) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user, params, query, body }) }),
  } as any;
}

describe('PermissionsGuard with AuthorizationAuditService', () => {
  it('calls recordDenial with enforce mode on a real deny', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('workflows:update'),
    } as unknown as Reflector;
    const authz = { can: vi.fn().mockResolvedValue(false) } as any;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as any;
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );

    const result = await guard.canActivate(
      ctx({ userId: 'u1' }, { scopeNodeId: 'proj' }),
    );

    expect(result).toBe(false);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'u1',
        requiredPermission: 'workflows:update',
        scopeNodeId: 'proj',
        enforcementMode: 'enforce',
      }),
    );
  });

  it('calls recordDenial with audit mode for a would-deny', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('workflows:update'),
    } as unknown as Reflector;
    const authz = { can: vi.fn().mockResolvedValue(false) } as any;
    const enforcement = { getMode: vi.fn().mockResolvedValue('audit') } as any;
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as any;
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );

    const result = await guard.canActivate(
      ctx({ userId: 'u1' }, { scopeNodeId: 'proj' }),
    );

    expect(result).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        enforcementMode: 'audit',
      }),
    );
  });

  it('does not call recordDenial on allow', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('workflows:read'),
    } as unknown as Reflector;
    const authz = { can: vi.fn().mockResolvedValue(true) } as any;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authzAudit = { recordDenial: vi.fn() } as any;
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );

    expect(await guard.canActivate(ctx({ userId: 'u1' }))).toBe(true);
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  it('works without authzAudit dependency (optional)', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('users:read'),
    } as unknown as Reflector;
    const authz = { can: vi.fn().mockResolvedValue(false) } as any;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const guard = new PermissionsGuard(reflector, authz, enforcement);

    expect(await guard.canActivate(ctx({ userId: 'u1' }))).toBe(false);
  });
});
