import { describe, expect, it, vi } from 'vitest';
import { UsersController } from './users.controller';

const BASE_USER = {
  id: 'user-1',
  username: 'alice',
  email: 'alice@example.com',
  isActive: true,
  lastLoginAt: undefined,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  userRoles: [],
} as any;

function makeController(accessibleIds: string[]) {
  const usersService = {
    listUsers: vi.fn().mockResolvedValue({
      data: [BASE_USER],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    }),
  } as any;
  const scopeAccess = {
    restrictToAccessibleScopes: vi
      .fn()
      .mockImplementation(
        async (
          _userId: string,
          _permission: string,
          requestedScopeId?: string,
        ) => {
          if (!requestedScopeId) return accessibleIds;
          return accessibleIds.includes(requestedScopeId)
            ? [requestedScopeId]
            : [];
        },
      ),
  } as any;
  const roleAssignments = {
    listEffectiveMembersAtNode: vi.fn().mockResolvedValue([
      {
        userId: 'user-1',
        userEmail: 'alice@example.com',
        roleId: 'role-1',
        roleName: 'admin',
        source: 'direct',
        sourceScopeNodeId: 'team-a',
        sourceScopeName: 'Team A',
      },
    ]),
  } as any;
  return {
    controller: new UsersController(usersService, scopeAccess, roleAssignments),
    usersService,
    scopeAccess,
    roleAssignments,
  };
}

const REQ = { user: { userId: 'admin-1' } } as any;

describe('UsersController.listUsers default-deny scope filter', () => {
  it('returns the platform-plane full directory when no scopeNodeId is given', async () => {
    const { controller, usersService, scopeAccess } = makeController([
      'team-a',
    ]);

    const res = await controller.listUsers({} as any, REQ);

    expect(scopeAccess.restrictToAccessibleScopes).not.toHaveBeenCalled();
    expect(usersService.listUsers).toHaveBeenCalledWith({});
    expect(res.success).toBe(true);
    expect(res.data.total).toBe(1);
  });

  it('confines the directory to effective members at an accessible scope node', async () => {
    const { controller, usersService, scopeAccess, roleAssignments } =
      makeController(['team-a']);

    const res = await controller.listUsers(
      { scopeNodeId: 'team-a' } as any,
      REQ,
    );

    expect(scopeAccess.restrictToAccessibleScopes).toHaveBeenCalledWith(
      'admin-1',
      'users:read',
      'team-a',
    );
    expect(roleAssignments.listEffectiveMembersAtNode).toHaveBeenCalledWith(
      'team-a',
    );
    expect(usersService.listUsers).toHaveBeenCalledWith({
      userIds: ['user-1'],
    });
    expect(res.success).toBe(true);
    expect(res.data.total).toBe(1);
  });

  it('includes a user whose role is assigned at an ANCESTOR scope (inherited membership)', async () => {
    const { controller, usersService, roleAssignments } = makeController([
      'team-a-child',
    ]);
    // The effective-membership walk returns an INHERITED member: the role is
    // assigned at ancestor 'team-a' but resolves at descendant 'team-a-child'.
    roleAssignments.listEffectiveMembersAtNode.mockResolvedValue([
      {
        userId: 'inherited-user',
        userEmail: 'bob@example.com',
        roleId: 'role-1',
        roleName: 'admin',
        source: 'inherited',
        sourceScopeNodeId: 'team-a',
        sourceScopeName: 'Team A',
      },
    ]);

    await controller.listUsers({ scopeNodeId: 'team-a-child' } as any, REQ);

    expect(roleAssignments.listEffectiveMembersAtNode).toHaveBeenCalledWith(
      'team-a-child',
    );
    expect(usersService.listUsers).toHaveBeenCalledWith({
      userIds: ['inherited-user'],
    });
  });

  it('default-denies an out-of-subtree scopeNodeId', async () => {
    const { controller, usersService, roleAssignments } = makeController([
      'team-a',
    ]);

    const res = await controller.listUsers(
      { scopeNodeId: 'team-out-of-subtree' } as any,
      REQ,
    );

    expect(roleAssignments.listEffectiveMembersAtNode).not.toHaveBeenCalled();
    expect(usersService.listUsers).not.toHaveBeenCalled();
    expect(res).toEqual({
      success: true,
      data: { data: [], total: 0, page: 1, limit: 10, totalPages: 0 },
    });
  });

  it('returns an empty directory when no user is an effective member at the accessible scope node', async () => {
    const { controller, usersService, roleAssignments } = makeController([
      'team-a',
    ]);
    roleAssignments.listEffectiveMembersAtNode.mockResolvedValue([]);

    const res = await controller.listUsers(
      { scopeNodeId: 'team-a' } as any,
      REQ,
    );

    expect(usersService.listUsers).not.toHaveBeenCalled();
    expect(res).toEqual({
      success: true,
      data: { data: [], total: 0, page: 1, limit: 10, totalPages: 0 },
    });
  });
});
