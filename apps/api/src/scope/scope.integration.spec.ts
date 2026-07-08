import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScopeService } from './scope.service';
import { GLOBAL_SCOPE_NODE_ID } from './scope.constants';

/**
 * In-memory closure-table simulation for integration tests.
 * Tracks scope_nodes and scope_node_closure state across operations.
 */
function makeInMemoryFixture() {
  const nodes = new Map<string, any>();
  const closure = new Map<
    string,
    { ancestorId: string; descendantId: string; depth: number }
  >();

  const closureKey = (a: string, d: string) => `${a}:${d}`;

  // Seed the global root
  nodes.set(GLOBAL_SCOPE_NODE_ID, {
    id: GLOBAL_SCOPE_NODE_ID,
    parentId: null,
    type: 'platform',
    name: 'Platform',
    slug: 'platform',
  });
  closure.set(closureKey(GLOBAL_SCOPE_NODE_ID, GLOBAL_SCOPE_NODE_ID), {
    ancestorId: GLOBAL_SCOPE_NODE_ID,
    descendantId: GLOBAL_SCOPE_NODE_ID,
    depth: 0,
  });

  const query = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('INSERT INTO SCOPE_NODES')) {
      const [id, parentId, type, name, slug] = params;
      if (!nodes.has(id)) nodes.set(id, { id, parentId, type, name, slug });
      return [];
    }
    if (s.startsWith('INSERT INTO SCOPE_NODE_CLOSURE')) {
      if (s.includes('SELECT ANCESTOR_ID')) {
        // Copy ancestor rows from parent: INSERT ... SELECT ancestor_id, $1, depth+1 WHERE descendant_id=$2
        const [newId, parentId] = params;
        for (const row of closure.values()) {
          if (row.descendantId === parentId) {
            const key = closureKey(row.ancestorId, newId);
            if (!closure.has(key)) {
              closure.set(key, {
                ancestorId: row.ancestorId,
                descendantId: newId,
                depth: row.depth + 1,
              });
            }
          }
        }
        return [];
      }
      // Self-closure: INSERT ... VALUES ($1, $1, 0)
      const [id] = params;
      const key = closureKey(id, id);
      if (!closure.has(key))
        closure.set(key, { ancestorId: id, descendantId: id, depth: 0 });
      return [];
    }
    if (
      s.startsWith('SELECT ANCESTOR_ID') &&
      s.includes('DESCENDANT_ID = $1')
    ) {
      // getAncestorIds
      const [nodeId] = params;
      return [...closure.values()]
        .filter((r) => r.descendantId === nodeId)
        .sort((a, b) => b.depth - a.depth)
        .map((r) => ({ ancestor_id: r.ancestorId }));
    }
    if (
      s.startsWith('SELECT DESCENDANT_ID') &&
      s.includes('ANCESTOR_ID = $1')
    ) {
      // getDescendantIds
      const [nodeId] = params;
      return [...closure.values()]
        .filter((r) => r.ancestorId === nodeId)
        .map((r) => ({ descendant_id: r.descendantId }));
    }
    if (s.startsWith('SELECT GEN_RANDOM_UUID')) {
      return [{ id: `auto-${Math.random().toString(36).slice(2, 8)}` }];
    }
    return [];
  });

  const nodeRepo = { query };
  const dataSource = {
    transaction: vi.fn(async (cb: any) => cb({ query })),
  };

  return { nodeRepo, dataSource, nodes, closure };
}

describe('ScopeService integration', () => {
  let service: ScopeService;
  let fixture: ReturnType<typeof makeInMemoryFixture>;

  beforeEach(() => {
    fixture = makeInMemoryFixture();
    service = new ScopeService(
      fixture.nodeRepo as any,
      fixture.dataSource as any,
    );
  });

  it('maintains ancestry across create operations', async () => {
    const org = await service.createNode({
      parentId: null,
      type: 'org',
      name: 'Acme',
      slug: 'acme',
      id: 'org-1',
    });
    const team = await service.createNode({
      parentId: org.id,
      type: 'team',
      name: 'Eng',
      slug: 'eng',
      id: 'team-1',
    });
    const proj = await service.createNode({
      parentId: team.id,
      type: 'project',
      name: 'Web',
      slug: 'web',
      id: 'proj-1',
    });

    const ancestorIds = await service.getAncestorIds(proj.id);
    expect(ancestorIds).toContain(GLOBAL_SCOPE_NODE_ID);
    expect(ancestorIds).toContain(org.id);
    expect(ancestorIds).toContain(team.id);
    expect(ancestorIds).toContain(proj.id);
    // root comes first (highest depth in closure = most ancestors = root-first ordering)
    expect(ancestorIds[0]).toBe(GLOBAL_SCOPE_NODE_ID);
    expect(ancestorIds[ancestorIds.length - 1]).toBe(proj.id);
  });

  it('getDescendantIds includes all children', async () => {
    const org = await service.createNode({
      parentId: null,
      type: 'org',
      name: 'Acme',
      slug: 'acme',
      id: 'org-2',
    });
    const team = await service.createNode({
      parentId: org.id,
      type: 'team',
      name: 'Eng',
      slug: 'eng',
      id: 'team-2',
    });
    const proj = await service.createNode({
      parentId: team.id,
      type: 'project',
      name: 'Web',
      slug: 'web',
      id: 'proj-2',
    });

    const descendantIds = await service.getDescendantIds(org.id);
    expect(descendantIds).toContain(team.id);
    expect(descendantIds).toContain(proj.id);
  });

  it('rejects unknown node types', async () => {
    await expect(
      service.createNode({
        parentId: null,
        type: 'galaxy' as any,
        name: 'X',
        slug: 'x',
        id: 'x-1',
      }),
    ).rejects.toThrow(/unknown scope node type/i);
  });
});
