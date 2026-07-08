import { describe, it, expect, vi } from 'vitest';
import { RoleAssignmentService } from './role-assignment.service';

describe('RoleAssignmentService audit', () => {
  it('records role_granted after a successful grant', async () => {
    const repo = {
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({
        id: 'ra1',
        userId: 'u2',
        roleId: 'member',
        scopeNodeId: 'org',
      }),
      create: (x: any) => x,
    } as any;
    const audit = {
      recordRoleGranted: vi.fn().mockResolvedValue(undefined),
    } as any;
    const svc = new RoleAssignmentService(repo, audit);
    await svc.assignRole('u2', 'member', 'org', 'admin');
    expect(audit.recordRoleGranted).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin',
        userId: 'u2',
        roleId: 'member',
        scopeNodeId: 'org',
      }),
    );
  });

  it('records role_revoked after a successful revoke', async () => {
    const repo = { delete: vi.fn().mockResolvedValue({ affected: 1 }) } as any;
    const audit = {
      recordRoleRevoked: vi.fn().mockResolvedValue(undefined),
    } as any;
    const svc = new RoleAssignmentService(repo, audit);
    await svc.revokeRole('u2', 'member', 'org', 'admin');
    expect(audit.recordRoleRevoked).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin',
        userId: 'u2',
        roleId: 'member',
        scopeNodeId: 'org',
      }),
    );
  });

  it('works without audit dependency (optional)', async () => {
    const repo = {
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({ id: 'ra1' }),
      create: (x: any) => x,
    } as any;
    const svc = new RoleAssignmentService(repo);
    await expect(svc.assignRole('u2', 'member', 'org')).resolves.toBeDefined();
  });
});
