import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleAssignmentService } from './role-assignment.service';
import { RoleAssignment } from '../database/entities/role-assignment.entity';

function makeRepo() {
  const store: RoleAssignment[] = [];
  return {
    store,
    findOne: vi.fn(
      async ({ where }: any) =>
        store.find(
          (r) =>
            r.userId === where.userId &&
            r.roleId === where.roleId &&
            r.scopeNodeId === where.scopeNodeId,
        ) ?? null,
    ),
    create: (x: any) => x as RoleAssignment,
    save: vi.fn(async (x: RoleAssignment) => {
      store.push(x);
      return x;
    }),
    delete: vi.fn(async () => ({ affected: 1 })),
    find: vi.fn(async ({ where }: any) =>
      store.filter((r) =>
        where.userId
          ? r.userId === where.userId
          : r.scopeNodeId === where.scopeNodeId,
      ),
    ),
    query: vi.fn(),
  };
}

describe('RoleAssignmentService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: RoleAssignmentService;

  beforeEach(() => {
    repo = makeRepo();
    service = new RoleAssignmentService(repo as any);
  });

  it('assigns a role at a scope node', async () => {
    const ra = await service.assignRole('u1', 'r1', 's1');
    expect(ra.userId).toBe('u1');
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: re-assigning the same grant does not duplicate', async () => {
    await service.assignRole('u1', 'r1', 's1');
    await service.assignRole('u1', 'r1', 's1');
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.store).toHaveLength(1);
  });

  it('writes through the supplied transaction manager instead of the injected repository', async () => {
    const txRepo = makeRepo();
    const manager = {
      getRepository: vi.fn(() => txRepo),
    };

    const ra = await service.assignRole(
      'u1',
      'r1',
      's1',
      'actor',
      manager as any,
    );

    expect(ra.userId).toBe('u1');
    // The write went through the transaction manager's repository...
    expect(manager.getRepository).toHaveBeenCalledTimes(1);
    expect(txRepo.save).toHaveBeenCalledTimes(1);
    // ...and NOT through the injected (non-transactional) repository.
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('revokes a grant by user, role, and scope', async () => {
    await service.assignRole('u1', 'r1', 's1');
    await service.revokeRole('u1', 'r1', 's1');
    expect(repo.delete).toHaveBeenCalledWith({
      userId: 'u1',
      roleId: 'r1',
      scopeNodeId: 's1',
    });
  });

  it('lists assignments for a user', async () => {
    await service.assignRole('u1', 'r1', 's1');
    const list = await service.listAssignmentsForUser('u1');
    expect(list).toHaveLength(1);
  });

  it('lists assignments at a node', async () => {
    await service.assignRole('u1', 'r1', 's1');
    const list = await service.listAssignmentsAtNode('s1');
    expect(list).toHaveLength(1);
  });

  it('lists effective members: direct (depth 0) and inherited (depth > 0)', async () => {
    const rows = [
      {
        user_id: 'u1',
        user_email: 'u1@x.com',
        role_id: 'r1',
        role_name: 'member',
        source_scope_node_id: 's1',
        source_scope_name: 'Team',
        depth: 0,
      },
      {
        user_id: 'u2',
        user_email: 'u2@x.com',
        role_id: 'r2',
        role_name: 'platform_admin',
        source_scope_node_id: 'root',
        source_scope_name: 'Platform',
        depth: 2,
      },
    ];
    repo.query = vi.fn().mockResolvedValue(rows);
    const members = await service.listEffectiveMembersAtNode('s1');
    expect(repo.query).toHaveBeenCalledWith(
      expect.stringContaining('scope_node_closure'),
      ['s1'],
    );
    expect(members).toEqual([
      {
        userId: 'u1',
        userEmail: 'u1@x.com',
        roleId: 'r1',
        roleName: 'member',
        source: 'direct',
        sourceScopeNodeId: 's1',
        sourceScopeName: 'Team',
      },
      {
        userId: 'u2',
        userEmail: 'u2@x.com',
        roleId: 'r2',
        roleName: 'platform_admin',
        source: 'inherited',
        sourceScopeNodeId: 'root',
        sourceScopeName: 'Platform',
      },
    ]);
  });
});
