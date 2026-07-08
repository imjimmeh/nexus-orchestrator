import { describe, expect, it, vi } from 'vitest';
import { RoleAssignmentGitopsHandler } from './role-assignment.gitops-handler';

describe('RoleAssignmentGitopsHandler', () => {
  it('serializes actual assignments with user role and scope path fields', async () => {
    const dataSource = {
      query: vi.fn().mockResolvedValue([
        {
          user_id: 'u1',
          username: 'alice',
          role_id: 'r1',
          role_name: 'viewer',
          scope_node_id: 'scope-1',
          managed_by: 'gitops',
          locked: false,
        },
      ]),
    } as any;
    const users = { findByUsername: vi.fn() } as any;
    const roles = { findByName: vi.fn() } as any;
    const scope = {
      getDescendantIds: vi.fn().mockResolvedValue(['scope-1']),
      getTree: vi.fn().mockResolvedValue({
        id: 'root',
        slug: '',
        children: [{ id: 'scope-1', slug: 'acme', children: [] }],
      }),
    } as any;
    const handler = new RoleAssignmentGitopsHandler(
      dataSource,
      users,
      roles,
      scope,
    );

    const actual = await handler.readActual('root');

    expect(actual).toEqual([
      {
        objectType: 'role_assignment',
        key: 'alice:viewer:/acme',
        fields: {
          user: 'alice',
          role: 'viewer',
          scope: '/acme',
        },
        managedBy: 'gitops',
        locked: false,
      },
    ]);
  });

  it('applies local id-shaped assignments without name lookups', async () => {
    const manager = {
      query: vi.fn().mockResolvedValue([]),
    } as any;
    const users = {
      findByUsername: vi.fn().mockResolvedValue({ id: 'u1' }),
    } as any;
    const roles = {
      findByName: vi.fn().mockResolvedValue({ id: 'r1' }),
    } as any;
    const scope = {
      getTree: vi.fn().mockResolvedValue({
        id: 'root',
        slug: '',
        children: [
          {
            id: 'scope-1',
            slug: 'scope-1',
            children: [],
          },
        ],
      }),
      getDescendantIds: vi.fn().mockResolvedValue(['scope-1']),
    } as any;
    const handler = new RoleAssignmentGitopsHandler(
      { query: vi.fn() } as any,
      users,
      roles,
      scope,
    );

    await handler.apply(
      {
        objectType: 'role_assignment',
        key: 'u1:r1:/',
        op: 'create',
        desired: {
          objectType: 'role_assignment',
          key: 'u1:r1:/',
          fields: {
            userId: 'u1',
            roleId: 'r1',
            scopeNodeId: '/',
          },
        },
        actual: null,
      },
      { manager, actorId: 'actor-1' },
    );

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO role_assignments'),
      expect.arrayContaining(['u1', 'r1', 'root']),
    );
    expect(users.findByUsername).not.toHaveBeenCalled();
    expect(roles.findByName).not.toHaveBeenCalled();
  });

  it('deletes canonical user-role-scope assignments by resolving identifiers', async () => {
    const manager = {
      query: vi.fn().mockResolvedValue([]),
    } as any;
    const users = {
      findByUsername: vi.fn().mockResolvedValue({ id: 'u1' }),
    } as any;
    const roles = {
      findByName: vi.fn().mockResolvedValue({ id: 'r1' }),
    } as any;
    const scope = {
      getTree: vi.fn().mockResolvedValue({
        id: 'root',
        slug: '',
        children: [{ id: 'scope-1', slug: 'acme', children: [] }],
      }),
      getDescendantIds: vi.fn().mockResolvedValue(['scope-1']),
    } as any;
    const handler = new RoleAssignmentGitopsHandler(
      { query: vi.fn() } as any,
      users,
      roles,
      scope,
    );

    await handler.apply(
      {
        objectType: 'role_assignment',
        key: 'alice:viewer:/acme',
        op: 'delete',
        desired: null,
        actual: {
          objectType: 'role_assignment',
          key: 'alice:viewer:/acme',
          fields: {
            user: 'alice',
            role: 'viewer',
            scope: '/acme',
          },
          managedBy: 'gitops',
          locked: false,
        },
      },
      { manager, actorId: 'actor-1' },
    );

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM role_assignments'),
      ['u1', 'r1', 'scope-1', 'gitops'],
    );
  });
});
