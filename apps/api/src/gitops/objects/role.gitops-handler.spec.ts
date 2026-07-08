import { describe, expect, it, vi } from 'vitest';
import { RoleGitopsHandler } from './role.gitops-handler';

describe('RoleGitopsHandler', () => {
  it('serializes owner scope ids as scope paths when reading actual roles', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM roles')) {
        return [
          {
            id: 'role-db-id',
            name: 'viewer',
            description: 'Read-only',
            owner_scope_node_id: 'scope-1',
            managed_by: 'gitops',
            locked: false,
          },
        ];
      }
      if (sql.includes('role_permissions')) {
        return [{ role_id: 'role-db-id', name: 'reports:view' }];
      }
      return [];
    });
    const dataSource = { query } as any;
    const scope = {
      getTree: vi.fn().mockResolvedValue({
        id: 'root-scope',
        slug: '',
        children: [{ id: 'scope-1', slug: 'acme', children: [] }],
      }),
    } as any;
    const handler = new RoleGitopsHandler(dataSource, scope);

    const actual = await handler.readActual('root-scope');

    expect(actual).toEqual([
      {
        objectType: 'role',
        key: 'viewer',
        fields: {
          description: 'Read-only',
          ownerScope: '/acme',
          permissions: ['reports:view'],
        },
        managedBy: 'gitops',
        locked: false,
      },
    ]);
  });

  it('serializes role objects and permits gitops-managed edits', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([]) } as any;
    const scope = {
      getTree: vi.fn().mockResolvedValue({
        id: 'root-scope',
        slug: '',
        children: [],
      }),
    } as any;
    const handler = new RoleGitopsHandler(dataSource, scope);

    expect(handler.objectType).toBe('role');
    expect(
      handler.serialize({
        objectType: 'role',
        key: 'viewer',
        fields: { description: 'Read-only' },
        managedBy: 'gitops',
        locked: false,
      }),
    ).toEqual({
      objectType: 'role',
      key: 'viewer',
      fields: { description: 'Read-only' },
      managedBy: 'gitops',
      locked: false,
    });
  });

  it('resolves explicit root ownership and syncs permissions on create', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id FROM roles')) {
        return [{ id: 'role-db-id' }];
      }
      return [];
    });
    const dataSource = { query } as any;
    const scope = {
      getTree: vi.fn().mockResolvedValue({
        id: 'root-scope',
        slug: '',
        children: [],
      }),
    } as any;
    const handler = new RoleGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'role',
        key: 'ops-lead',
        op: 'create',
        desired: {
          objectType: 'role',
          key: 'ops-lead',
          fields: {
            description: 'Ops lead',
            ownerScope: '/',
            permissions: ['reports:view', 'reports:edit'],
          },
        },
        actual: null,
      },
      { actorId: 'actor-1', manager: { query } as any },
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO roles'),
      expect.arrayContaining(['ops-lead', 'Ops lead', 'root-scope']),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM role_permissions'),
      expect.arrayContaining(['role-db-id']),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO role_permissions'),
      expect.arrayContaining(['role-db-id', ['reports:view', 'reports:edit']]),
    );
  });

  it('updates owner scope and permissions from desired role docs', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id FROM roles')) {
        return [{ id: 'role-db-id' }];
      }
      return [];
    });
    const dataSource = { query } as any;
    const scope = {
      getTree: vi.fn().mockResolvedValue({
        id: 'root-scope',
        slug: '',
        children: [],
      }),
    } as any;
    const handler = new RoleGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'role',
        key: 'ops-lead',
        op: 'update',
        desired: {
          objectType: 'role',
          key: 'ops-lead',
          fields: {
            description: 'Ops lead v2',
            ownerScope: '/',
            permissions: ['reports:view', 'reports:edit'],
          },
        },
        actual: {
          objectType: 'role',
          key: 'ops-lead',
          fields: {
            description: 'Ops lead',
            ownerScope: '/acme',
            permissions: ['reports:view'],
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          description: { from: 'Ops lead', to: 'Ops lead v2' },
          ownerScope: { from: '/acme', to: '/' },
          permissions: {
            from: ['reports:view'],
            to: ['reports:view', 'reports:edit'],
          },
        },
      },
      { actorId: 'actor-1', manager: { query } as any },
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'UPDATE roles SET description = $2, owner_scope_node_id = $3',
      ),
      expect.arrayContaining([
        'ops-lead',
        'Ops lead v2',
        'root-scope',
        'gitops',
      ]),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM role_permissions'),
      expect.arrayContaining(['role-db-id']),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO role_permissions'),
      expect.arrayContaining(['role-db-id', ['reports:view', 'reports:edit']]),
    );
  });

  it('does not clear description when an update omits it', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id FROM roles')) {
        return [{ id: 'role-db-id' }];
      }
      return [];
    });
    const dataSource = { query } as any;
    const scope = {
      getTree: vi.fn().mockResolvedValue({
        id: 'root-scope',
        slug: '',
        children: [],
      }),
    } as any;
    const handler = new RoleGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'role',
        key: 'ops-lead',
        op: 'update',
        desired: {
          objectType: 'role',
          key: 'ops-lead',
          fields: {
            permissions: ['reports:view'],
          },
        },
        actual: {
          objectType: 'role',
          key: 'ops-lead',
          fields: {
            description: 'Keep me',
            ownerScope: null,
            permissions: [],
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          permissions: { from: [], to: ['reports:view'] },
        },
      },
      { actorId: 'actor-1', manager: { query } as any },
    );

    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE roles SET description'),
      expect.anything(),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO role_permissions'),
      expect.arrayContaining(['role-db-id', ['reports:view']]),
    );
  });
});
