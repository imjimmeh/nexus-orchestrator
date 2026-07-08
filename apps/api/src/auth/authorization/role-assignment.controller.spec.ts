import { describe, it, expect, vi } from 'vitest';
import { RoleAssignmentController } from './role-assignment.controller';

describe('RoleAssignmentController', () => {
  function make() {
    const service = {
      assignRole: vi.fn().mockResolvedValue({
        id: 'ra1',
        userId: 'u1',
        roleId: 'r1',
        scopeNodeId: 's1',
      }),
      revokeRole: vi.fn().mockResolvedValue(undefined),
      listAssignmentsAtNode: vi.fn().mockResolvedValue([{ id: 'ra1' }]),
      listAssignmentsForUser: vi.fn().mockResolvedValue([{ id: 'ra1' }]),
      listEffectiveMembersAtNode: vi.fn().mockResolvedValue([{ userId: 'u1' }]),
    } as any;
    const roleRepository = {
      find: vi.fn().mockResolvedValue([{ id: 'r1', name: 'member' }]),
    } as any;
    return {
      service,
      roleRepository,
      controller: new RoleAssignmentController(service, roleRepository),
    };
  }

  it('assigns a role at the scope node from the route param', async () => {
    const { service, controller } = make();
    const res = await controller.assign('s1', { userId: 'u1', roleId: 'r1' });
    expect(service.assignRole).toHaveBeenCalledWith('u1', 'r1', 's1');
    expect(res).toEqual({
      success: true,
      data: {
        id: 'ra1',
        userId: 'u1',
        roleId: 'r1',
        scopeNodeId: 's1',
      },
    });
  });

  it('revokes a role at the scope node from the route param', async () => {
    const { service, controller } = make();
    await controller.revoke('s1', { userId: 'u1', roleId: 'r1' });
    expect(service.revokeRole).toHaveBeenCalledWith('u1', 'r1', 's1');
  });

  it('lists assignments at a node', async () => {
    const { service, controller } = make();
    const res = await controller.listAtNode('s1');
    expect(service.listAssignmentsAtNode).toHaveBeenCalledWith('s1');
    expect(res).toEqual({ success: true, data: [{ id: 'ra1' }] });
  });

  it('lists assignments for a user', async () => {
    const { service, controller } = make();
    const res = await controller.listForUser('u1');
    expect(service.listAssignmentsForUser).toHaveBeenCalledWith('u1');
    expect(res).toEqual({ success: true, data: [{ id: 'ra1' }] });
  });

  it('lists effective members at a node', async () => {
    const { service, controller } = make();
    const res = await controller.listMembers('s1');
    expect(service.listEffectiveMembersAtNode).toHaveBeenCalledWith('s1');
    expect(res).toEqual({ success: true, data: [{ userId: 'u1' }] });
  });

  it('lists all roles in the catalog', async () => {
    const { roleRepository, controller } = make();
    const res = await controller.listRoles();
    expect(roleRepository.find).toHaveBeenCalledWith();
    expect(res).toEqual({
      success: true,
      data: [{ id: 'r1', name: 'member' }],
    });
  });
});
