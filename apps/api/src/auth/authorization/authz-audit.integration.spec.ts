import { describe, it, expect, vi } from 'vitest';
import { PermissionsGuard } from './permissions.guard';
import { Reflector } from '@nestjs/core';
import { RoleAssignmentService } from './role-assignment.service';
import { AuthorizationAuditService } from './authorization-audit.service';
import { AUTHZ_EVENT_TYPES } from './authz-audit.constants';

// Build a minimal ctx helper
function ctx(user: any, params: any = {}) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user, params, query: {}, body: {} }),
    }),
  } as any;
}

describe('authz audit integration', () => {
  it('a denied request causes recordDenial to be called with correct data', async () => {
    // Arrange
    const auditLogSvc = { log: vi.fn().mockResolvedValue({ id: 'a1' }) } as any;
    const authzAudit = new AuthorizationAuditService(auditLogSvc);
    const authz = { can: vi.fn().mockResolvedValue(false) } as any;
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('workflows:update'),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );

    // Act
    const result = await guard.canActivate(
      ctx({ userId: 'u1' }, { scopeNodeId: 'proj' }),
    );

    // Assert
    expect(result).toBe(false);
    expect(auditLogSvc.log).toHaveBeenCalledWith(
      AUTHZ_EVENT_TYPES.DENIED,
      'u1',
      'denied',
      'denied',
      'proj',
      expect.objectContaining({
        requiredPermission: 'workflows:update',
        enforcementMode: 'enforce',
      }),
    );
  });

  it('a role grant causes recordRoleGranted to be called with correct data', async () => {
    // Arrange
    const auditLogSvc = { log: vi.fn().mockResolvedValue({ id: 'a2' }) } as any;
    const authzAudit = new AuthorizationAuditService(auditLogSvc);
    const assignmentRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({
        id: 'ra1',
        userId: 'u2',
        roleId: 'member',
        scopeNodeId: 'org',
      }),
      create: (x: any) => x,
    } as any;
    const svc = new RoleAssignmentService(assignmentRepo, authzAudit);

    // Act
    await svc.assignRole('u2', 'member', 'org', 'admin');

    // Assert
    expect(auditLogSvc.log).toHaveBeenCalledWith(
      AUTHZ_EVENT_TYPES.ROLE_GRANTED,
      'admin',
      'granted',
      'success',
      'org',
      expect.objectContaining({
        targetUserId: 'u2',
        roleId: 'member',
      }),
    );
  });

  it('audit mode allows the request but still records would_deny', async () => {
    const auditLogSvc = { log: vi.fn().mockResolvedValue({ id: 'a3' }) } as any;
    const authzAudit = new AuthorizationAuditService(auditLogSvc);
    const authz = { can: vi.fn().mockResolvedValue(false) } as any;
    const enforcement = { getMode: vi.fn().mockResolvedValue('audit') } as any;
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue('workflows:update'),
    } as unknown as Reflector;
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
    expect(auditLogSvc.log).toHaveBeenCalledWith(
      AUTHZ_EVENT_TYPES.DENIED,
      'u1',
      'denied',
      'denied',
      'proj',
      expect.objectContaining({ enforcementMode: 'audit' }),
    );
  });
});
