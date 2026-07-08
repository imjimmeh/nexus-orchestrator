import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthorizationAuditService } from './authorization-audit.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { AUTHZ_EVENT_TYPES } from './authz-audit.constants';

const mockAuditLog = {
  log: vi.fn(),
};

describe('AuthorizationAuditService', () => {
  let service: AuthorizationAuditService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationAuditService,
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get(AuthorizationAuditService);
  });

  it('recordDenial calls auditLog.log with DENIED event type, actorId, action, result, scopeNodeId and metadata', async () => {
    mockAuditLog.log.mockResolvedValueOnce({});

    await service.recordDenial({
      actorId: 'user-1',
      requiredPermission: 'scope:read',
      scopeNodeId: 'scope-42',
      scopePath: ['root', 'child'],
      enforcementMode: 'enforce',
    });

    expect(mockAuditLog.log).toHaveBeenCalledWith(
      AUTHZ_EVENT_TYPES.DENIED,
      'user-1',
      'denied',
      'denied',
      'scope-42',
      {
        requiredPermission: 'scope:read',
        scopePath: ['root', 'child'],
        enforcementMode: 'enforce',
      },
    );
  });

  it('recordRoleGranted calls auditLog.log with ROLE_GRANTED event type, granted action, success result, and correct metadata', async () => {
    mockAuditLog.log.mockResolvedValueOnce({});

    await service.recordRoleGranted({
      actorId: 'admin-1',
      userId: 'user-2',
      roleId: 'role-99',
      scopeNodeId: 'scope-10',
    });

    expect(mockAuditLog.log).toHaveBeenCalledWith(
      AUTHZ_EVENT_TYPES.ROLE_GRANTED,
      'admin-1',
      'granted',
      'success',
      'scope-10',
      {
        targetUserId: 'user-2',
        roleId: 'role-99',
      },
    );
  });

  it('recordRoleRevoked calls auditLog.log with ROLE_REVOKED event type, revoked action, success result', async () => {
    mockAuditLog.log.mockResolvedValueOnce({});

    await service.recordRoleRevoked({
      actorId: 'admin-1',
      userId: 'user-3',
      roleId: 'role-7',
      scopeNodeId: 'scope-5',
    });

    expect(mockAuditLog.log).toHaveBeenCalledWith(
      AUTHZ_EVENT_TYPES.ROLE_REVOKED,
      'admin-1',
      'revoked',
      'success',
      'scope-5',
      {
        targetUserId: 'user-3',
        roleId: 'role-7',
      },
    );
  });

  it('recordScopeCreated, recordScopeMoved, recordScopeDeleted each call auditLog.log with their correct event types', async () => {
    mockAuditLog.log.mockResolvedValue({});

    await service.recordScopeCreated({
      actorId: 'user-1',
      scopeNodeId: 'scope-1',
      parentId: 'root',
      type: 'team',
    });

    await service.recordScopeMoved({
      actorId: 'user-1',
      scopeNodeId: 'scope-1',
      oldParentId: 'root',
      newParentId: 'other',
    });

    await service.recordScopeDeleted({
      actorId: 'user-1',
      scopeNodeId: 'scope-1',
    });

    expect(mockAuditLog.log).toHaveBeenNthCalledWith(
      1,
      AUTHZ_EVENT_TYPES.SCOPE_CREATED,
      'user-1',
      'created',
      'success',
      'scope-1',
      { parentId: 'root', type: 'team' },
    );
    expect(mockAuditLog.log).toHaveBeenNthCalledWith(
      2,
      AUTHZ_EVENT_TYPES.SCOPE_MOVED,
      'user-1',
      'moved',
      'success',
      'scope-1',
      { oldParentId: 'root', newParentId: 'other' },
    );
    expect(mockAuditLog.log).toHaveBeenNthCalledWith(
      3,
      AUTHZ_EVENT_TYPES.SCOPE_DELETED,
      'user-1',
      'deleted',
      'success',
      'scope-1',
      {},
    );
  });

  it('recordScopeUpdated calls auditLog.log with SCOPE_UPDATED event type, updated action, success result, and changed-field metadata', async () => {
    mockAuditLog.log.mockResolvedValueOnce({});

    await service.recordScopeUpdated({
      actorId: 'user-1',
      scopeNodeId: 'scope-1',
      changedFields: ['name'],
      previous: { name: 'Old' },
      next: { name: 'New' },
    });

    expect(mockAuditLog.log).toHaveBeenCalledWith(
      AUTHZ_EVENT_TYPES.SCOPE_UPDATED,
      'user-1',
      'updated',
      'success',
      'scope-1',
      {
        changedFields: ['name'],
        previous: { name: 'Old' },
        next: { name: 'New' },
      },
    );
  });

  it('recordScopeArchived calls auditLog.log with SCOPE_ARCHIVED event type, archived action, success result', async () => {
    mockAuditLog.log.mockResolvedValueOnce({});

    await service.recordScopeArchived({
      actorId: 'user-1',
      scopeNodeId: 'scope-1',
    });

    expect(mockAuditLog.log).toHaveBeenCalledWith(
      AUTHZ_EVENT_TYPES.SCOPE_ARCHIVED,
      'user-1',
      'archived',
      'success',
      'scope-1',
      {},
    );
  });

  it('recordScopeRestored calls auditLog.log with SCOPE_RESTORED event type, restored action, success result', async () => {
    mockAuditLog.log.mockResolvedValueOnce({});

    await service.recordScopeRestored({
      actorId: 'user-1',
      scopeNodeId: 'scope-1',
    });

    expect(mockAuditLog.log).toHaveBeenCalledWith(
      AUTHZ_EVENT_TYPES.SCOPE_RESTORED,
      'user-1',
      'restored',
      'success',
      'scope-1',
      {},
    );
  });

  it('never throws if auditLog.log rejects — resolves to undefined', async () => {
    mockAuditLog.log.mockRejectedValueOnce(new Error('DB down'));

    await expect(
      service.recordDenial({
        actorId: 'user-1',
        requiredPermission: 'scope:read',
        scopeNodeId: 'scope-42',
        scopePath: null,
        enforcementMode: 'audit',
      }),
    ).resolves.toBeUndefined();
  });
});
