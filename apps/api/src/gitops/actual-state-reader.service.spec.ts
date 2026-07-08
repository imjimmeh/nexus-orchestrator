import { describe, it, expect, vi } from 'vitest';
import { ActualStateReaderService } from './actual-state-reader.service';
import { GITOPS_MANAGED_BY } from './gitops.constants';

describe('ActualStateReaderService', () => {
  function makeService() {
    const dataSource = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('scope_nodes')) {
          return [
            {
              id: '00000000-0000-0000-0000-000000000000',
              parent_id: null,
              type: 'platform',
              name: 'Platform',
              slug: 'platform',
              managed_by: 'gitops',
              locked: false,
            },
            {
              id: 'org-acme',
              parent_id: '00000000-0000-0000-0000-000000000000',
              type: 'org',
              name: 'Acme',
              slug: 'acme',
              managed_by: 'gitops',
              locked: false,
            },
            {
              id: 'team-rogue',
              parent_id: 'org-acme',
              type: 'team',
              name: 'Rogue',
              slug: 'rogue',
              managed_by: 'gitops',
              locked: false,
            },
          ];
        }
        if (sql.includes('FROM roles')) {
          return [
            {
              id: 'r1',
              name: 'viewer',
              description: 'Read-only',
              owner_scope_node_id: 'org-acme',
              managed_by: 'gitops',
              locked: false,
            },
          ];
        }
        if (sql.includes('role_permissions')) {
          return [
            {
              role_id: 'r1',
              name: 'reports:view',
            },
          ];
        }
        if (sql.includes('role_assignments')) {
          return [
            {
              user_id: 'u1',
              username: 'alice',
              role_id: 'r1',
              role_name: 'viewer',
              scope_node_id: 'org-acme',
              managed_by: null,
              locked: false,
            },
          ];
        }
        return [];
      }),
    } as any;
    const scope = {
      getDescendantIds: vi.fn().mockResolvedValue(['org-acme']),
    } as any;
    return new ActualStateReaderService(dataSource, scope);
  }

  it('projects scope nodes into ActualObject with managed_by + locked', async () => {
    const svc = makeService();
    const state = await svc.read(
      new Set(['scope_node::/acme', 'role::viewer']),
    );
    const node = state.objects.find(
      (o) => o.type === 'scope_node' && o.key === '/acme',
    );
    expect(node?.managedBy).toBe(GITOPS_MANAGED_BY);
    expect(node?.fields).toMatchObject({ name: 'Acme', slug: 'acme' });
  });

  it('flags foreign descendants for managed nodes whose subtree leaks outside desired-state', async () => {
    const svc = makeService();
    // getDescendantIds returns UUIDs; team-rogue maps to path /acme/rogue which is NOT in desired-state
    (svc as any).scope.getDescendantIds = vi
      .fn()
      .mockResolvedValue(['org-acme', 'team-rogue']);
    // desired-state only knows about /acme, not /acme/rogue
    const state = await svc.read(new Set(['scope_node::/acme']));
    const node = state.objects.find(
      (o) => o.type === 'scope_node' && o.key === '/acme',
    );
    expect(node?.hasForeignDescendants).toBe(true);
  });

  it('projects role assignments with composite key user:role:scope', async () => {
    const svc = makeService();
    const state = await svc.read(new Set());
    const assignment = state.objects.find((o) => o.type === 'role_assignment');
    expect(assignment?.key).toBe('alice:viewer:/acme');
    expect(assignment?.fields).toEqual({
      user: 'alice',
      role: 'viewer',
      scope: '/acme',
    });
  });

  it('projects the global root scope as slash', async () => {
    const svc = makeService();
    const state = await svc.read(new Set(['scope_node::/']));
    const root = state.objects.find(
      (o) =>
        o.type === 'scope_node' &&
        o.fields.id === '00000000-0000-0000-0000-000000000000',
    );
    expect(root?.key).toBe('/');
  });

  it('projects role objects with owner scope paths and permissions', async () => {
    const svc = makeService();
    const state = await svc.read(new Set());
    const role = state.objects.find(
      (o) => o.type === 'role' && o.key === 'viewer',
    );
    expect(role?.fields).toEqual({
      description: 'Read-only',
      ownerScope: '/acme',
      permissions: ['reports:view'],
    });
  });
});
