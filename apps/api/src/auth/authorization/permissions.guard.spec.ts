import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

function ctx(user: any, params: any = {}, query: any = {}, body: any = {}) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user, params, query, body }) }),
  } as any;
}

describe('PermissionsGuard', () => {
  it('allows when no permission metadata present', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as any;
    const guard = new PermissionsGuard(
      reflector,
      { can: vi.fn() } as any,
      enforcement,
      authzAudit,
    );
    expect(await guard.canActivate(ctx({ userId: 'u1' }))).toBe(true);
  });

  it('denies when user is absent', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('workflows:read'),
    } as unknown as Reflector;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as any;
    const guard = new PermissionsGuard(
      reflector,
      { can: vi.fn() } as any,
      enforcement,
      authzAudit,
    );
    expect(await guard.canActivate(ctx(undefined))).toBe(false);
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  it('resolves scope from params.scopeNodeId and delegates to AuthorizationService.can', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('workflows:read'),
    } as unknown as Reflector;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as any;
    const authz = { can: vi.fn().mockResolvedValue(true) } as any;
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );
    const ok = await guard.canActivate(
      ctx({ userId: 'u1' }, { scopeNodeId: 's1' }),
    );
    expect(ok).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'u1',
      'workflows:read',
      's1',
      undefined,
    );
  });

  it('falls back to the global scope node when none on the request', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('users:read'),
    } as unknown as Reflector;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as any;
    const authz = { can: vi.fn().mockResolvedValue(false) } as any;
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );
    await guard.canActivate(ctx({ userId: 'u1' }));
    expect(authz.can).toHaveBeenCalledWith(
      'u1',
      'users:read',
      GLOBAL_SCOPE_NODE_ID,
      undefined,
    );
  });

  it('resolves scope from params.scopeId when scopeNodeId is absent', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('workflows:read'),
    } as unknown as Reflector;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as any;
    const authz = { can: vi.fn().mockResolvedValue(true) } as any;
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );
    await guard.canActivate(ctx({ userId: 'u1' }, { scopeId: 'proj-1' }));
    expect(authz.can).toHaveBeenCalledWith(
      'u1',
      'workflows:read',
      'proj-1',
      undefined,
    );
  });

  it('resolves create-permission at body.parentId (subtree-bound)', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('scopes:create'),
    } as unknown as Reflector;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authz = {
      can: vi.fn(
        async (_u: string, _p: string, scope: string) => scope === 'parent-1',
      ),
    } as any;
    const guard = new PermissionsGuard(reflector, authz, enforcement);
    const ok = await guard.canActivate(
      ctx(
        { userId: 'u1' },
        {},
        {},
        { parentId: 'parent-1', type: 'team', name: 'X', slug: 'x' },
      ),
    );
    expect(ok).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'u1',
      'scopes:create',
      'parent-1',
      undefined,
    );
  });

  it('falls back to the global scope node when body.parentId is absent (root-level create)', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('scopes:create'),
    } as unknown as Reflector;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authz = { can: vi.fn().mockResolvedValue(true) } as any;
    const guard = new PermissionsGuard(reflector, authz, enforcement);
    await guard.canActivate(
      ctx({ userId: 'u1' }, {}, {}, { type: 'team', name: 'X', slug: 'x' }),
    );
    expect(authz.can).toHaveBeenCalledWith(
      'u1',
      'scopes:create',
      GLOBAL_SCOPE_NODE_ID,
      undefined,
    );
  });

  it('passes user roles to AuthorizationService.can', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('workflows:read'),
    } as unknown as Reflector;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authz = { can: vi.fn().mockResolvedValue(true) } as any;
    const guard = new PermissionsGuard(reflector, authz, enforcement);
    const ok = await guard.canActivate(
      ctx({ userId: 'chat-service', roles: ['Admin'] }, { scopeNodeId: 's1' }),
    );
    expect(ok).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'chat-service',
      'workflows:read',
      's1',
      ['Admin'],
    );
  });
});

function deps(mode: string, canResult: boolean) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue('workflows:update'),
  } as unknown as Reflector;
  const authz = { can: vi.fn().mockResolvedValue(canResult) } as any;
  const enforcement = { getMode: vi.fn().mockResolvedValue(mode) } as any;
  const authzAudit = {
    recordDenial: vi.fn().mockResolvedValue(undefined),
  } as any;
  return { reflector, authz, enforcement, authzAudit };
}

describe('PermissionsGuard staged enforcement', () => {
  it('audit mode: denied check is allowed but logs would_deny via recordDenial', async () => {
    const { reflector, authz, enforcement, authzAudit } = deps('audit', false);
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );
    expect(
      await guard.canActivate(ctx({ userId: 'u1' }, { scopeNodeId: 's1' })),
    ).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'u1',
        requiredPermission: 'workflows:update',
        scopeNodeId: 's1',
        enforcementMode: 'audit',
      }),
    );
  });

  it('warn mode: denied check is allowed but logs would_deny via recordDenial', async () => {
    const { reflector, authz, enforcement, authzAudit } = deps('warn', false);
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );
    expect(await guard.canActivate(ctx({ userId: 'u1' }))).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'u1',
        enforcementMode: 'warn',
      }),
    );
  });

  it('enforce mode: denied check returns false and calls recordDenial with enforce', async () => {
    const { reflector, authz, enforcement, authzAudit } = deps(
      'enforce',
      false,
    );
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );
    expect(await guard.canActivate(ctx({ userId: 'u1' }))).toBe(false);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'u1',
        enforcementMode: 'enforce',
      }),
    );
  });

  it('allowed check returns true in every mode without calling recordDenial', async () => {
    const { reflector, authz, enforcement, authzAudit } = deps('enforce', true);
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );
    expect(
      await guard.canActivate(ctx({ userId: 'u1' }, { scopeNodeId: 's1' })),
    ).toBe(true);
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  it('reads enforcement mode for the permission resource', async () => {
    const { reflector, authz, enforcement, authzAudit } = deps('enforce', true);
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );
    await guard.canActivate(ctx({ userId: 'u1' }));
    expect(enforcement.getMode).toHaveBeenCalledWith('workflows');
  });
});
