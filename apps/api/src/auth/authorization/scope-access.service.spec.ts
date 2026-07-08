import { describe, it, expect, vi } from 'vitest';
import { ScopeAccessService } from './scope-access.service';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

/**
 * In-memory closure-backed fake that EVALUATES the join/WHERE semantics of
 * `getAccessibleScopeIds` from the user's role assignments — rather than
 * returning canned rows. Modelled on the fixture in
 * `cross-team-isolation.integration.spec.ts`. The fake filters assignments by
 * the `$1` user param, checks the role holds one of the requested permissions,
 * and expands each assigned scope to its closure descendants. This makes any
 * sibling-subtree absence a real consequence of the user's assignments, so the
 * test fails if the user-param binding (the WHERE filter input) or the closure
 * descendant expansion is broken.
 */
function makeClosureFixture() {
  const closure = new Map<string, Map<string, number>>(); // ancestor -> desc -> depth
  const assignments: Array<{
    userId: string;
    roleId: string;
    scopeNodeId: string;
  }> = [];
  const rolePerms = new Map<string, Set<string>>();

  function addClosure(ancestor: string, descendant: string, depth: number) {
    if (!closure.has(ancestor)) closure.set(ancestor, new Map());
    closure.get(ancestor)!.set(descendant, depth);
  }

  function addNode(id: string, parentId: string | null) {
    addClosure(id, id, 0);
    if (parentId) {
      for (const [anc, descs] of closure.entries()) {
        if (descs.has(parentId)) addClosure(anc, id, descs.get(parentId)! + 1);
      }
    }
  }

  function grant(roleId: string, permissions: string[]) {
    if (!rolePerms.has(roleId)) rolePerms.set(roleId, new Set());
    for (const p of permissions) rolePerms.get(roleId)!.add(p);
  }

  function assign(userId: string, roleId: string, scopeNodeId: string) {
    assignments.push({ userId, roleId, scopeNodeId });
  }

  function makeSvc() {
    const dataSource = {
      query: vi.fn(async (_sql: string, params: unknown[]) => {
        const [userId, permName, managePerm] = params as string[];
        const wanted = new Set([permName, managePerm]);
        const scopeIds = new Set<string>();
        for (const ra of assignments) {
          if (ra.userId !== userId) continue; // WHERE ra.user_id = $1
          const perms = rolePerms.get(ra.roleId);
          if (!perms || ![...wanted].some((p) => perms.has(p))) continue;
          const descendants = closure.get(ra.scopeNodeId); // JOIN closure ON ancestor_id = ra.scope_node_id
          if (descendants) for (const d of descendants.keys()) scopeIds.add(d);
        }
        return [...scopeIds].map((scope_id) => ({ scope_id }));
      }),
    } as any;
    return { svc: new ScopeAccessService(dataSource), dataSource };
  }

  return { addNode, grant, assign, makeSvc };
}

describe('ScopeAccessService', () => {
  function make(rows: Array<{ scope_id: string }>) {
    const dataSource = { query: vi.fn().mockResolvedValue(rows) } as any;
    return { svc: new ScopeAccessService(dataSource), dataSource };
  }

  it('returns the union of subtree node ids where the user holds the permission', async () => {
    const { svc, dataSource } = make([
      { scope_id: 'team-a' },
      { scope_id: 'team-a-child-1' },
      { scope_id: 'team-a-child-2' },
    ]);
    const ids = await svc.getAccessibleScopeIds('u1', 'resources:read');
    expect(new Set(ids)).toEqual(
      new Set(['team-a', 'team-a-child-1', 'team-a-child-2']),
    );
    const sql = dataSource.query.mock.calls[0][0] as string;
    expect(sql).toContain('scope_node_closure');
    expect(dataSource.query.mock.calls[0][1]).toEqual([
      'u1',
      'resources:read',
      'resources:manage',
    ]);
  });

  it('honors manage as a superset of the requested action', async () => {
    const { svc, dataSource } = make([{ scope_id: 'team-b' }]);
    await svc.getAccessibleScopeIds('u1', 'resources:read');
    expect(dataSource.query.mock.calls[0][1][2]).toBe('resources:manage');
  });

  it('returns an empty array when the user holds the permission nowhere', async () => {
    const { svc } = make([]);
    expect(await svc.getAccessibleScopeIds('nobody', 'resources:read')).toEqual(
      [],
    );
  });

  it('de-duplicates overlapping subtrees', async () => {
    const { svc } = make([
      { scope_id: 'x' },
      { scope_id: 'x' },
      { scope_id: 'y' },
    ]);
    expect(await svc.getAccessibleScopeIds('u1', 'goals:read')).toEqual([
      'x',
      'y',
    ]);
  });

  it('confines a user to the union of their own assigned subtrees, isolating another user’s subtree', async () => {
    // Two users, one shared closure/assignment model. u1 is granted in two
    // disjoint subtrees (team-a, team-c); u2 is granted only in team-b. Because
    // the fake resolves results from assignments through the closure join (not
    // canned rows), the absence of team-b for u1 is a real consequence of the
    // WHERE user filter — and would flip if the user param binding were broken.
    const fix = makeClosureFixture();
    fix.grant('member', ['scopes:read']);
    // GLOBAL → team-a → team-a-child ; GLOBAL → team-b ; GLOBAL → team-c
    fix.addNode(GLOBAL_SCOPE_NODE_ID, null);
    fix.addNode('team-a', GLOBAL_SCOPE_NODE_ID);
    fix.addNode('team-a-child', 'team-a');
    fix.addNode('team-b', GLOBAL_SCOPE_NODE_ID);
    fix.addNode('team-c', GLOBAL_SCOPE_NODE_ID);
    fix.assign('u1', 'member', 'team-a');
    fix.assign('u1', 'member', 'team-c');
    fix.assign('u2', 'member', 'team-b');
    const { svc } = fix.makeSvc();

    const u1 = new Set(await svc.getAccessibleScopeIds('u1', 'scopes:read'));
    expect(u1.has('team-a')).toBe(true);
    expect(u1.has('team-a-child')).toBe(true); // descendant via closure join
    expect(u1.has('team-c')).toBe(true);
    expect(u1.has('team-b')).toBe(false); // u2's subtree — never leaks to u1

    const u2 = new Set(await svc.getAccessibleScopeIds('u2', 'scopes:read'));
    expect(u2.has('team-b')).toBe(true);
    expect(u2.has('team-a')).toBe(false); // u1's subtree — never leaks to u2
    expect(u2.has('team-a-child')).toBe(false);
  });

  it('pins the nil-UUID platform root: root-assigned user gets it, subtree user is default-denied it', async () => {
    // The platform root is the literal nil-UUID GLOBAL_SCOPE_NODE_ID. This
    // characterises the pass-through contract the scoped list pages rely on:
    // Providers/Secrets/Workflows/etc. send GLOBAL_SCOPE_NODE_ID verbatim as
    // requestedScopeId at the platform plane. A user assigned AT the root must
    // get it back (self-closure → still visible); a user assigned only in a
    // subtree must be denied it, since the root is an ANCESTOR — never a
    // descendant — of their assignment, so the closure join excludes it.
    const fix = makeClosureFixture();
    fix.grant('member', ['scopes:read']);
    fix.addNode(GLOBAL_SCOPE_NODE_ID, null);
    fix.addNode('team-a', GLOBAL_SCOPE_NODE_ID);
    fix.addNode('team-a-child', 'team-a');
    fix.assign('u_root', 'member', GLOBAL_SCOPE_NODE_ID);
    fix.assign('u_team', 'member', 'team-a');
    const { svc } = fix.makeSvc();

    // Root-assigned user: the nil-UUID is genuinely in their accessible set via
    // the self-closure row, and descendants cascade.
    const rootAccessible = new Set(
      await svc.getAccessibleScopeIds('u_root', 'scopes:read'),
    );
    expect(rootAccessible.has(GLOBAL_SCOPE_NODE_ID)).toBe(true);
    expect(rootAccessible.has('team-a')).toBe(true);
    expect(rootAccessible.has('team-a-child')).toBe(true);

    // Pass-through: requesting the literal nil-UUID returns exactly it.
    await expect(
      svc.restrictToAccessibleScopes(
        'u_root',
        'scopes:read',
        GLOBAL_SCOPE_NODE_ID,
      ),
    ).resolves.toEqual([GLOBAL_SCOPE_NODE_ID]);

    // Default-deny: a subtree user cannot reach the platform root via the
    // nil-UUID — the root is not a descendant of their assigned node.
    const teamAccessible = new Set(
      await svc.getAccessibleScopeIds('u_team', 'scopes:read'),
    );
    expect(teamAccessible.has(GLOBAL_SCOPE_NODE_ID)).toBe(false);
    await expect(
      svc.restrictToAccessibleScopes(
        'u_team',
        'scopes:read',
        GLOBAL_SCOPE_NODE_ID,
      ),
    ).resolves.toEqual([]);
  });

  it('constrains the closure join to descendants of assigned nodes only', async () => {
    const { svc, dataSource } = make([{ scope_id: 'team-a' }]);
    await svc.getAccessibleScopeIds('u1', 'scopes:read');
    const sql = dataSource.query.mock.calls[0][0] as string;
    // Descendants resolve via ancestor_id = assigned node — never a bare table scan.
    expect(sql).toContain('c.ancestor_id = ra.scope_node_id');
    expect(sql).toContain('WHERE ra.user_id = $1');
  });

  describe('restrictToAccessibleScopes', () => {
    it('returns the full accessible set when no scope is requested', async () => {
      const { svc } = make([]);
      vi.spyOn(svc, 'getAccessibleScopeIds').mockResolvedValue(['a', 'b']);
      await expect(
        svc.restrictToAccessibleScopes('u1', 'workflows:read'),
      ).resolves.toEqual(['a', 'b']);
    });

    it('confines to the requested scope when it is accessible', async () => {
      const { svc } = make([]);
      vi.spyOn(svc, 'getAccessibleScopeIds').mockResolvedValue(['a', 'b']);
      await expect(
        svc.restrictToAccessibleScopes('u1', 'workflows:read', 'b'),
      ).resolves.toEqual(['b']);
    });

    it('default-denies a requested scope outside the accessible subtree', async () => {
      const { svc } = make([]);
      vi.spyOn(svc, 'getAccessibleScopeIds').mockResolvedValue(['a', 'b']);
      await expect(
        svc.restrictToAccessibleScopes('u1', 'workflows:read', 'z'),
      ).resolves.toEqual([]);
    });

    it('returns an empty set when the user has no accessible scopes at all', async () => {
      const { svc } = make([]);
      vi.spyOn(svc, 'getAccessibleScopeIds').mockResolvedValue([]);
      await expect(
        svc.restrictToAccessibleScopes('u1', 'workflows:read'),
      ).resolves.toEqual([]);
      await expect(
        svc.restrictToAccessibleScopes('u1', 'workflows:read', 'a'),
      ).resolves.toEqual([]);
    });
  });
});
