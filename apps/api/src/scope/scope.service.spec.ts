import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ScopeService } from './scope.service';
import { GLOBAL_SCOPE_NODE_ID } from './scope.constants';

function makeQueryRunner() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    queries,
    manager: {
      query: vi.fn(
        async (sql: string, params?: unknown[]): Promise<unknown[]> => {
          queries.push({ sql, params });
          return [];
        },
      ),
    },
  };
}

describe('ScopeService.createNode', () => {
  let nodeRepo: any;
  let dataSource: any;
  let qr: ReturnType<typeof makeQueryRunner>;

  beforeEach(() => {
    qr = makeQueryRunner();
    const original = qr.manager.query;
    qr.manager.query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT type FROM scope_nodes')) {
        return [{ type: 'org' }];
      }
      return original(sql, params);
    });
    nodeRepo = {
      create: (x: any) => x,
      findOne: vi.fn().mockResolvedValue({ id: 'parent', parentId: null }),
    };
    dataSource = {
      transaction: vi.fn(async (cb: any) => cb(qr.manager)),
    };
  });

  it('inserts the node and its closure rows (ancestors + self at depth 0)', async () => {
    const service = new ScopeService(nodeRepo, dataSource);
    const node = await service.createNode({
      id: 'child',
      parentId: 'parent',
      type: 'team',
      name: 'Eng',
      slug: 'eng',
    });
    expect(node.id).toBe('child');
    // self row
    expect(
      qr.queries.some(
        (q) => q.sql.includes('scope_node_closure') && q.sql.includes('depth'),
      ),
    ).toBe(true);
    // ancestor-copy insert references parent
    expect(
      qr.queries.some(
        (q) =>
          q.sql.includes('descendant_id = $1') ||
          q.sql.includes('WHERE descendant_id'),
      ),
    ).toBe(true);
  });

  it('rejects an unknown node type', async () => {
    const service = new ScopeService(nodeRepo, dataSource);
    await expect(
      service.createNode({
        id: 'x',
        parentId: 'parent',
        type: 'galaxy' as any,
        name: 'X',
        slug: 'x',
      }),
    ).rejects.toThrow(/unknown scope node type/i);
  });

  it('persists is_tenant_root when provided', async () => {
    const service = new ScopeService(nodeRepo, dataSource);
    await service.createNode({
      id: 'org-1',
      parentId: GLOBAL_SCOPE_NODE_ID,
      type: 'org',
      name: 'Acme',
      slug: 'acme',
      isTenantRoot: true,
    });
    const insert = qr.queries.find((q) =>
      q.sql.includes('INSERT INTO scope_nodes'),
    );
    expect(insert?.sql).toContain('is_tenant_root');
    expect(insert?.params).toContain(true);
  });

  it('rejects isTenantRoot on a type other than org/platform', async () => {
    // Default mock resolves parent type to 'org'; requesting a 'team' child
    // with isTenantRoot:true must be rejected regardless of typing validity.
    const service = new ScopeService(nodeRepo, dataSource);
    await expect(
      service.createNode({
        id: 'x',
        parentId: 'org-1',
        type: 'team',
        name: 'T',
        slug: 't',
        isTenantRoot: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a node whose type may not nest under its parent', async () => {
    // Parent resolves to type 'team'; 'org' under 'team' is invalid.
    qr.manager.query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT type FROM scope_nodes'))
        return [{ type: 'team' }];
      return [];
    });
    const service = new ScopeService(nodeRepo, dataSource);
    await expect(
      service.createNode({
        id: 'x',
        parentId: 'team-parent',
        type: 'org',
        name: 'X',
        slug: 'x',
      }),
    ).rejects.toThrow(/cannot nest under/i);
  });

  it('rejects when the parent node does not exist', async () => {
    qr.manager.query = vi.fn(async () => []);
    const service = new ScopeService(nodeRepo, dataSource);
    await expect(
      service.createNode({
        id: 'x',
        parentId: 'missing',
        type: 'project',
        name: 'X',
        slug: 'x',
      }),
    ).rejects.toThrow(/does not exist/i);
  });
});

describe('ScopeService.moveNode', () => {
  function makeQr(typeById: Record<string, string>) {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const manager = {
      query: vi.fn(
        async (sql: string, params?: unknown[]): Promise<unknown[]> => {
          queries.push({ sql, params });
          if (sql.includes('SELECT type FROM scope_nodes')) {
            const id = (params?.[0] as string) ?? '';
            return typeById[id] ? [{ type: typeById[id] }] : [];
          }
          if (sql.includes('SELECT 1 FROM scope_nodes'))
            return [{ '?column?': 1 }];
          if (sql.includes('SELECT 1 FROM scope_node_closure')) return [];
          return [];
        },
      ),
    };
    return { queries, manager };
  }

  it('rejects a move that violates the typing matrix', async () => {
    const qr = makeQr({ 'org-node': 'org', 'team-parent': 'team' });
    const dataSource = {
      transaction: vi.fn(async (cb: any) => cb(qr.manager)),
    } as any;
    const service = new ScopeService({} as any, dataSource);
    // Moving an 'org' under a 'team' is invalid (team → org not allowed).
    await expect(service.moveNode('org-node', 'team-parent')).rejects.toThrow(
      /cannot nest under/i,
    );
  });

  it('allows a move that satisfies the typing matrix', async () => {
    const qr = makeQr({ 'team-node': 'team', 'org-parent': 'org' });
    const dataSource = {
      transaction: vi.fn(async (cb: any) => cb(qr.manager)),
    } as any;
    const service = new ScopeService({} as any, dataSource);
    // Moving a 'team' under an 'org' is valid.
    await expect(
      service.moveNode('team-node', 'org-parent'),
    ).resolves.toBeUndefined();
    expect(
      qr.queries.some((q) =>
        q.sql.includes('UPDATE scope_nodes SET parent_id'),
      ),
    ).toBe(true);
  });

  it('throws ForbiddenException and performs no mutation when the actor lacks scopes:create on the destination', async () => {
    const qr = makeQr({ 'team-node': 'team', 'org-parent': 'org' });
    const dataSource = {
      transaction: vi.fn(async (cb: any) => cb(qr.manager)),
    } as any;
    const scopeAccessSvc = {
      // Destination not in the actor's accessible set → deny.
      restrictToAccessibleScopes: vi.fn().mockResolvedValue([]),
    };
    const service = new ScopeService(
      {} as any,
      dataSource,
      undefined,
      scopeAccessSvc as any,
    );

    await expect(
      service.moveNode('team-node', 'org-parent', 'actor-1'),
    ).rejects.toThrow(ForbiddenException);

    expect(scopeAccessSvc.restrictToAccessibleScopes).toHaveBeenCalledWith(
      'actor-1',
      'scopes:create',
      'org-parent',
    );
    // No closure/parent mutation should have been attempted.
    expect(
      qr.queries.some((q) =>
        q.sql.includes('UPDATE scope_nodes SET parent_id'),
      ),
    ).toBe(false);
    expect(
      qr.queries.some((q) => q.sql.includes('DELETE FROM scope_node_closure')),
    ).toBe(false);
  });

  it('allows the move when the actor has scopes:create on the destination', async () => {
    const qr = makeQr({ 'team-node': 'team', 'org-parent': 'org' });
    const dataSource = {
      transaction: vi.fn(async (cb: any) => cb(qr.manager)),
    } as any;
    const scopeAccessSvc = {
      restrictToAccessibleScopes: vi.fn().mockResolvedValue(['org-parent']),
    };
    const service = new ScopeService(
      {} as any,
      dataSource,
      undefined,
      scopeAccessSvc as any,
    );

    await expect(
      service.moveNode('team-node', 'org-parent', 'actor-1'),
    ).resolves.toBeUndefined();

    expect(
      qr.queries.some((q) =>
        q.sql.includes('UPDATE scope_nodes SET parent_id'),
      ),
    ).toBe(true);
  });

  it('skips destination authorization when no actorId is provided (degradation, e.g. internal callers)', async () => {
    const qr = makeQr({ 'team-node': 'team', 'org-parent': 'org' });
    const dataSource = {
      transaction: vi.fn(async (cb: any) => cb(qr.manager)),
    } as any;
    const scopeAccessSvc = {
      restrictToAccessibleScopes: vi.fn().mockResolvedValue([]),
    };
    const service = new ScopeService(
      {} as any,
      dataSource,
      undefined,
      scopeAccessSvc as any,
    );

    await expect(
      service.moveNode('team-node', 'org-parent'),
    ).resolves.toBeUndefined();
    expect(scopeAccessSvc.restrictToAccessibleScopes).not.toHaveBeenCalled();
  });

  it('records a scope-moved audit event with the actor, old parent, and new parent', async () => {
    const manager = {
      query: vi.fn(
        async (sql: string, params?: unknown[]): Promise<unknown[]> => {
          const id = (params?.[0] as string) ?? '';
          if (sql.includes('SELECT type FROM scope_nodes')) {
            const typeById: Record<string, string> = {
              'team-node': 'team',
              'org-parent': 'org',
            };
            return typeById[id] ? [{ type: typeById[id] }] : [];
          }
          if (sql.includes('SELECT parent_id FROM scope_nodes')) {
            return id === 'team-node' ? [{ parent_id: 'old-parent' }] : [];
          }
          if (sql.includes('SELECT 1 FROM scope_nodes'))
            return [{ '?column?': 1 }];
          if (sql.includes('SELECT 1 FROM scope_node_closure')) return [];
          return [];
        },
      ),
    };
    const dataSource = {
      transaction: vi.fn(async (cb: any) => cb(manager)),
    } as any;
    const authzAudit = {
      recordScopeMoved: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ScopeService({} as any, dataSource, authzAudit as any);

    await service.moveNode('team-node', 'org-parent', 'actor-1');

    expect(authzAudit.recordScopeMoved).toHaveBeenCalledWith({
      actorId: 'actor-1',
      scopeNodeId: 'team-node',
      oldParentId: 'old-parent',
      newParentId: 'org-parent',
    });
  });

  it('defaults the move audit actorId to "system" when no actorId is provided', async () => {
    const qr = makeQr({ 'team-node': 'team', 'org-parent': 'org' });
    const dataSource = {
      transaction: vi.fn(async (cb: any) => cb(qr.manager)),
    } as any;
    const authzAudit = {
      recordScopeMoved: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ScopeService({} as any, dataSource, authzAudit as any);

    await service.moveNode('team-node', 'org-parent');

    expect(authzAudit.recordScopeMoved).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'system' }),
    );
  });
});

describe('ScopeService.getTree', () => {
  function entity(overrides: Record<string, unknown>) {
    return {
      metadata: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      archivedAt: null,
      ...overrides,
    };
  }

  it('returns full tree for a user with root-level access', async () => {
    const rows = [
      entity({
        id: 'child',
        parentId: 'p1',
        type: 'team',
        name: 'Eng',
        slug: 'eng',
      }),
      entity({
        id: 'p2',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'project',
        name: 'Beta',
        slug: 'beta',
      }),
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: 'platform',
        name: 'Platform',
        slug: 'platform',
      }),
      entity({
        id: 'p1',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'project',
        name: 'Alpha',
        slug: 'alpha',
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const scopeAccessSvc = {
      getAccessibleScopeIds: vi
        .fn()
        .mockResolvedValue([GLOBAL_SCOPE_NODE_ID, 'p1', 'p2', 'child']),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    const tree = await service.getTree('admin-user');

    expect(tree?.id).toBe(GLOBAL_SCOPE_NODE_ID);
    expect(tree?.children.map((c) => c.id)).toEqual(['p1', 'p2']);
    const alpha = tree?.children.find((c) => c.id === 'p1');
    expect(alpha?.children.map((c) => c.id)).toEqual(['child']);
  });

  it('returns null when the global root is absent', async () => {
    const nodeRepo = { find: vi.fn().mockResolvedValue([]) };
    const scopeAccessSvc = {
      getAccessibleScopeIds: vi.fn().mockResolvedValue([]),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );
    expect(await service.getTree('admin-user')).toBeNull();
  });

  it('returns the full tree when ScopeAccessService is not injected (isolated unit test)', async () => {
    const rows = [
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: 'platform',
        name: 'Platform',
        slug: 'platform',
      }),
      entity({
        id: 'p1',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'project',
        name: 'Alpha',
        slug: 'alpha',
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const service = new ScopeService(nodeRepo as any, {} as any);

    const tree = await service.getTree('any-user');
    expect(tree?.id).toBe(GLOBAL_SCOPE_NODE_ID);
    expect(tree?.children.map((c) => c.id)).toEqual(['p1']);
  });

  it('returns the full tree when userId is not provided', async () => {
    const rows = [
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: 'platform',
        name: 'Platform',
        slug: 'platform',
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const scopeAccessSvc = { getAccessibleScopeIds: vi.fn() };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    const tree = await service.getTree();
    expect(tree?.id).toBe(GLOBAL_SCOPE_NODE_ID);
    expect(scopeAccessSvc.getAccessibleScopeIds).not.toHaveBeenCalled();
  });

  it('returns only accessible subtree + ancestors for a scoped user', async () => {
    const rows = [
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: 'platform',
        name: 'Platform',
        slug: 'platform',
      }),
      entity({
        id: 'p1',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'project',
        name: 'Alpha',
        slug: 'alpha',
      }),
      entity({
        id: 'p2',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'project',
        name: 'Beta',
        slug: 'beta',
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const scopeAccessSvc = {
      getAccessibleScopeIds: vi.fn().mockResolvedValue(['p1']),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    const tree = await service.getTree('scoped-user');

    expect(tree?.id).toBe(GLOBAL_SCOPE_NODE_ID);
    expect(tree?.children.map((c) => c.id)).toEqual(['p1']);
  });

  it('returns null for a user with no accessible scopes', async () => {
    const rows = [
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: 'platform',
        name: 'Platform',
        slug: 'platform',
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const scopeAccessSvc = {
      getAccessibleScopeIds: vi.fn().mockResolvedValue([]),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    expect(await service.getTree('nobody')).toBeNull();
  });

  it('confines a scoped user to the union of assigned subtrees and hides siblings', async () => {
    const rows = [
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: 'platform',
        name: 'Platform',
        slug: 'platform',
      }),
      entity({
        id: 'org-a',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'org',
        name: 'Acme',
        slug: 'acme',
      }),
      entity({
        id: 'org-b',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'org',
        name: 'Beta',
        slug: 'beta',
      }),
      entity({
        id: 'team-a1',
        parentId: 'org-a',
        type: 'team',
        name: 'A1',
        slug: 'a1',
      }),
      entity({
        id: 'team-b1',
        parentId: 'org-b',
        type: 'team',
        name: 'B1',
        slug: 'b1',
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const scopeAccessSvc = {
      // User granted only inside org-a's subtree.
      getAccessibleScopeIds: vi.fn().mockResolvedValue(['org-a', 'team-a1']),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    const tree = await service.getTree('scoped-user');

    // Root is retained as an ancestor breadcrumb, but only org-a hangs off it.
    expect(tree?.children.map((c) => c.id)).toEqual(['org-a']);
    const orgA = tree?.children.find((c) => c.id === 'org-a');
    expect(orgA?.children.map((c) => c.id)).toEqual(['team-a1']);
    // The sibling tenant and its subtree never appear.
    const ids = JSON.stringify(tree);
    expect(ids).not.toContain('org-b');
    expect(ids).not.toContain('team-b1');
  });

  it('returns the union of two disjoint assigned subtrees under different tenants', async () => {
    const rows = [
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: 'platform',
        name: 'Platform',
        slug: 'platform',
      }),
      entity({
        id: 'org-a',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'org',
        name: 'Acme',
        slug: 'acme',
      }),
      entity({
        id: 'org-b',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'org',
        name: 'Beta',
        slug: 'beta',
      }),
      entity({
        id: 'org-c',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'org',
        name: 'Charlie',
        slug: 'charlie',
      }),
      entity({
        id: 'team-a1',
        parentId: 'org-a',
        type: 'team',
        name: 'A1',
        slug: 'a1',
      }),
      entity({
        id: 'team-b1',
        parentId: 'org-b',
        type: 'team',
        name: 'B1',
        slug: 'b1',
      }),
      entity({
        id: 'team-c1',
        parentId: 'org-c',
        type: 'team',
        name: 'C1',
        slug: 'c1',
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const scopeAccessSvc = {
      // Granted in two DIFFERENT tenants' subtrees, neither being the global
      // root (which would short-circuit to the unfiltered branch).
      getAccessibleScopeIds: vi.fn().mockResolvedValue(['team-a1', 'team-b1']),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    const tree = await service.getTree('scoped-user');

    // BOTH tenants surface (guards against a bug that processed only the first
    // accessible id); the third sibling tenant is absent.
    expect(tree?.id).toBe(GLOBAL_SCOPE_NODE_ID);
    expect(tree?.children.map((c) => c.id)).toEqual(['org-a', 'org-b']);
    const orgA = tree?.children.find((c) => c.id === 'org-a');
    expect(orgA?.children.map((c) => c.id)).toEqual(['team-a1']);
    const orgB = tree?.children.find((c) => c.id === 'org-b');
    expect(orgB?.children.map((c) => c.id)).toEqual(['team-b1']);
    const json = JSON.stringify(tree);
    expect(json).not.toContain('org-c');
    expect(json).not.toContain('team-c1');
  });

  it('calls find with an archived_at filter', async () => {
    const nodeRepo = { find: vi.fn().mockResolvedValue([]) };
    const scopeAccessSvc = {
      getAccessibleScopeIds: vi.fn().mockResolvedValue([]),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    await service.getTree('user');

    expect(nodeRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ archivedAt: expect.anything() }),
      }),
    );
  });

  it('projects isTenantRoot onto tree nodes (tenant-boundary badge lock-in)', async () => {
    const rows = [
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: 'platform',
        name: 'Platform',
        slug: 'platform',
        isTenantRoot: false,
      }),
      entity({
        id: 'org-1',
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'org',
        name: 'Acme',
        slug: 'acme',
        isTenantRoot: true,
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const service = new ScopeService(nodeRepo as any, {} as any);

    const tree = await service.getTree();

    expect(tree?.isTenantRoot).toBe(false);
    const org = tree?.children.find((c) => c.id === 'org-1');
    expect(org?.isTenantRoot).toBe(true);
  });
});

describe('ScopeService.ensureNode', () => {
  let nodeRepo: any;
  let dataSource: any;
  const existingNode = {
    id: 'proj-uuid',
    type: 'project',
    name: 'Web App',
    slug: 'web-app',
    parent_id: null,
  };

  beforeEach(() => {
    // The final SELECT in ensureNode must return the node row.
    const qr = {
      manager: {
        query: vi.fn(async (sql: string) => {
          if (sql.startsWith('SELECT * FROM scope_nodes'))
            return [existingNode];
          return [];
        }),
      },
    };
    nodeRepo = {
      create: (x: any) => x,
    };
    dataSource = {
      transaction: vi.fn(async (cb: any) => cb(qr.manager)),
    };
  });

  it('always uses an atomic transaction (upsert) and returns the node', async () => {
    const service = new ScopeService(nodeRepo, dataSource);

    const result = await service.ensureNode({
      id: 'proj-uuid',
      parentId: null,
      type: 'project',
      name: 'Web App',
      slug: 'web-app',
    });

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(result).toEqual(existingNode);
  });

  it('returns the node row whether it pre-existed or was just inserted', async () => {
    const service = new ScopeService(nodeRepo, dataSource);

    const result = await service.ensureNode({
      id: 'proj-uuid',
      parentId: null,
      type: 'project',
      name: 'New Project',
      slug: 'new-project',
    });

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(result.id).toBe('proj-uuid');
  });

  it('rejects when no id is provided', async () => {
    const service = new ScopeService(nodeRepo, dataSource);
    await expect(
      service.ensureNode({
        id: undefined,
        parentId: null,
        type: 'project',
        name: 'X',
        slug: 'x',
      }),
    ).rejects.toThrow(/requires an explicit id/i);
  });

  it('rejects an unknown node type', async () => {
    const service = new ScopeService(nodeRepo, dataSource);
    await expect(
      service.ensureNode({
        id: 'x',
        parentId: null,
        type: 'galaxy' as any,
        name: 'X',
        slug: 'x',
      }),
    ).rejects.toThrow(/unknown scope node type/i);
  });
});

describe('ScopeService.archiveNode', () => {
  function makeService(
    nodeOverride?: Partial<{
      id: string;
      type: string;
      archivedAt: Date | null;
    }>,
  ) {
    const node = {
      id: 'proj-1',
      type: 'project',
      archivedAt: null,
      ...nodeOverride,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn().mockResolvedValue(node),
    };
    return { service: new ScopeService(nodeRepo as any, {} as any), nodeRepo };
  }

  it('sets archivedAt to a Date on a project node', async () => {
    const { service, nodeRepo } = makeService();
    await service.archiveNode('proj-1');
    expect(nodeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ archivedAt: expect.any(Date) }),
    );
  });

  it('throws BadRequestException for the global platform root', async () => {
    const { service } = makeService({
      id: GLOBAL_SCOPE_NODE_ID,
      type: 'platform',
    });
    await expect(service.archiveNode(GLOBAL_SCOPE_NODE_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException for a non-project type', async () => {
    const { service } = makeService({ id: 'team-1', type: 'team' });
    await expect(service.archiveNode('team-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when node is not found', async () => {
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(null),
      save: vi.fn(),
    };
    const service = new ScopeService(nodeRepo as any, {} as any);
    await expect(service.archiveNode('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('records a scope-archived audit event with the acting user', async () => {
    const node = { id: 'proj-1', type: 'project', archivedAt: null };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn().mockResolvedValue(node),
    };
    const authzAudit = {
      recordScopeArchived: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      authzAudit as any,
    );

    await service.archiveNode('proj-1', 'actor-1');

    expect(authzAudit.recordScopeArchived).toHaveBeenCalledWith({
      actorId: 'actor-1',
      scopeNodeId: 'proj-1',
    });
  });

  it('defaults the archive audit actorId to "system" when no actorId is provided', async () => {
    const node = { id: 'proj-1', type: 'project', archivedAt: null };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn().mockResolvedValue(node),
    };
    const authzAudit = {
      recordScopeArchived: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      authzAudit as any,
    );

    await service.archiveNode('proj-1');

    expect(authzAudit.recordScopeArchived).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'system' }),
    );
  });
});

describe('ScopeService.restoreNode', () => {
  function makeService(
    nodeOverride?: Partial<{
      id: string;
      type: string;
      archivedAt: Date | null;
    }>,
  ) {
    const node = {
      id: 'proj-1',
      type: 'project',
      archivedAt: new Date(),
      ...nodeOverride,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn().mockResolvedValue(node),
    };
    return { service: new ScopeService(nodeRepo as any, {} as any), nodeRepo };
  }

  it('clears archivedAt to null on a project node', async () => {
    const { service, nodeRepo } = makeService();
    await service.restoreNode('proj-1');
    expect(nodeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ archivedAt: null }),
    );
  });

  it('throws BadRequestException for the global platform root', async () => {
    const { service } = makeService({
      id: GLOBAL_SCOPE_NODE_ID,
      type: 'platform',
    });
    await expect(service.restoreNode(GLOBAL_SCOPE_NODE_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException for a non-project type', async () => {
    const { service } = makeService({ id: 'team-1', type: 'team' });
    await expect(service.restoreNode('team-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when node is not found', async () => {
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(null),
      save: vi.fn(),
    };
    const service = new ScopeService(nodeRepo as any, {} as any);
    await expect(service.restoreNode('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('records a scope-restored audit event with the acting user', async () => {
    const node = { id: 'proj-1', type: 'project', archivedAt: new Date() };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn().mockResolvedValue(node),
    };
    const authzAudit = {
      recordScopeRestored: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      authzAudit as any,
    );

    await service.restoreNode('proj-1', 'actor-1');

    expect(authzAudit.recordScopeRestored).toHaveBeenCalledWith({
      actorId: 'actor-1',
      scopeNodeId: 'proj-1',
    });
  });

  it('defaults the restore audit actorId to "system" when no actorId is provided', async () => {
    const node = { id: 'proj-1', type: 'project', archivedAt: new Date() };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn().mockResolvedValue(node),
    };
    const authzAudit = {
      recordScopeRestored: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      authzAudit as any,
    );

    await service.restoreNode('proj-1');

    expect(authzAudit.recordScopeRestored).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'system' }),
    );
  });
});

describe('ScopeService.findOrphanedProjectNodes', () => {
  it('returns project nodes that are live and not in any source table', async () => {
    const orphan = {
      id: 'orphan-1',
      type: 'project',
      archivedAt: null,
      name: 'Orphan',
      slug: 'o1',
    };
    const nodeRepo = { query: vi.fn().mockResolvedValue([orphan]) };
    const service = new ScopeService(nodeRepo as any, {} as any);

    const result = await service.findOrphanedProjectNodes();

    expect(nodeRepo.query).toHaveBeenCalledWith(
      expect.stringContaining('archived_at IS NULL'),
      expect.any(Array),
    );
    expect(result).toEqual([orphan]);
  });

  it('returns an empty array when no orphans exist', async () => {
    const nodeRepo = { query: vi.fn().mockResolvedValue([]) };
    const service = new ScopeService(nodeRepo as any, {} as any);

    const result = await service.findOrphanedProjectNodes();

    expect(result).toEqual([]);
  });
});

describe('ScopeService.isLiveScope', () => {
  it('returns true for a live (non-archived) scope node', async () => {
    const nodeRepo = {
      findOne: vi.fn(async () => ({ id: 'scope-1', archivedAt: null })),
    };
    const service = new ScopeService(nodeRepo as any, {} as any);

    await expect(service.isLiveScope('scope-1')).resolves.toBe(true);
    expect(nodeRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'scope-1', archivedAt: expect.anything() },
    });
  });

  it('returns false when the scope node does not exist', async () => {
    const nodeRepo = { findOne: vi.fn(async () => null) };
    const service = new ScopeService(nodeRepo as any, {} as any);

    await expect(service.isLiveScope('missing-scope')).resolves.toBe(false);
  });
});
