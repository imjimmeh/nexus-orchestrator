import { describe, it, expect, vi } from 'vitest';
import { AuthorizationService } from './authorization.service';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

/**
 * In-memory simulation of the closure-based permission query:
 *   SELECT DISTINCT p.name
 *     FROM role_assignments ra
 *     JOIN scope_node_closure c ON c.ancestor_id = ra.scope_node_id AND c.descendant_id = $targetNode
 *     JOIN role_permissions rp ON rp.role_id = ra.role_id
 *     JOIN permissions p ON p.id = rp.permission_id
 *    WHERE ra.user_id = $userId
 */
function makeFixture() {
  // Closure table: ancestor → {descendant, depth}
  const closure = new Map<string, Map<string, number>>(); // ancestor → (descendant → depth)
  // role_assignments: userId → [{roleId, scopeNodeId}]
  const assignments: Array<{
    userId: string;
    roleId: string;
    scopeNodeId: string;
  }> = [];
  // role_permissions: roleId → Set<permissionName>
  const rolePerms = new Map<string, Set<string>>();

  function addClosure(ancestor: string, descendant: string, depth: number) {
    if (!closure.has(ancestor)) closure.set(ancestor, new Map());
    closure.get(ancestor)!.set(descendant, depth);
  }

  function addNode(id: string, parentId: string | null) {
    // Self-closure
    addClosure(id, id, 0);
    // Copy all ancestors of parentId (if any), incrementing depth
    if (parentId) {
      for (const [anc, descs] of closure.entries()) {
        if (descs.has(parentId)) {
          addClosure(anc, id, descs.get(parentId)! + 1);
        }
      }
    }
  }

  // Seed the global root
  addNode(GLOBAL_SCOPE_NODE_ID, null);

  function assignRole(userId: string, roleId: string, scopeNodeId: string) {
    assignments.push({ userId, roleId, scopeNodeId });
  }

  function grantPermissions(roleId: string, permissions: string[]) {
    if (!rolePerms.has(roleId)) rolePerms.set(roleId, new Set());
    for (const p of permissions) rolePerms.get(roleId)!.add(p);
  }

  function makeAuthzService(): AuthorizationService {
    const repo = {
      query: vi.fn(
        async (_sql: string, [userId, targetNode]: [string, string]) => {
          // Simulate: find all role_assignments where ancestor_id is in closure ancestors of targetNode
          const ancestorIds = new Set<string>();
          for (const [anc, descs] of closure.entries()) {
            if (descs.has(targetNode)) ancestorIds.add(anc);
          }
          const perms = new Set<string>();
          for (const ra of assignments) {
            if (ra.userId === userId && ancestorIds.has(ra.scopeNodeId)) {
              const rolePermSet = rolePerms.get(ra.roleId);
              if (rolePermSet) rolePermSet.forEach((p) => perms.add(p));
            }
          }
          return [...perms].map((name) => ({ name }));
        },
      ),
    } as any;
    return new AuthorizationService(repo);
  }

  return { addNode, assignRole, grantPermissions, makeAuthzService };
}

describe('Scoped role assignment inheritance (EPIC-204C)', () => {
  it('platform_admin at root can act on a deep project', async () => {
    const fix = makeFixture();

    fix.grantPermissions('platform_admin', [
      'workflows:manage',
      'roles:manage',
    ]);

    const orgId = 'org-1';
    const teamId = 'team-1';
    const scopeId = 'scope-1';
    fix.addNode(orgId, GLOBAL_SCOPE_NODE_ID);
    fix.addNode(teamId, orgId);
    fix.addNode(scopeId, teamId);

    const ADMIN_ID = '00000000-0000-4000-8000-000000000010';
    fix.assignRole(ADMIN_ID, 'platform_admin', GLOBAL_SCOPE_NODE_ID);

    const authz = fix.makeAuthzService();

    // Root admin can act on the deep scope (inheritance flows down)
    expect(await authz.can(ADMIN_ID, 'workflows:update', scopeId)).toBe(true);
    expect(await authz.can(ADMIN_ID, 'roles:manage', scopeId)).toBe(true);
  });

  it('member at teamA can act on teamA child project but NOT sibling teamB', async () => {
    const fix = makeFixture();

    fix.grantPermissions('member', [
      'workflows:read',
      'workflows:create',
      'resources:read',
    ]);

    const orgId = 'org-2';
    const teamAId = 'teamA-2';
    const teamBId = 'teamB-2';
    const projectAId = 'projectA-2';
    fix.addNode(orgId, GLOBAL_SCOPE_NODE_ID);
    fix.addNode(teamAId, orgId);
    fix.addNode(teamBId, orgId);
    fix.addNode(projectAId, teamAId);

    const MEMBER_ID = '00000000-0000-4000-8000-000000000020';
    fix.assignRole(MEMBER_ID, 'member', teamAId);

    const authz = fix.makeAuthzService();

    // Inherits down to teamA's child project
    expect(await authz.can(MEMBER_ID, 'workflows:read', projectAId)).toBe(true);
    expect(await authz.can(MEMBER_ID, 'workflows:create', teamAId)).toBe(true);

    // Does NOT leak to sibling teamB (no path from teamA to teamB via closure)
    expect(await authz.can(MEMBER_ID, 'workflows:read', teamBId)).toBe(false);

    // Does NOT leak upward to the org (no path from teamA to orgId)
    expect(await authz.can(MEMBER_ID, 'workflows:read', orgId)).toBe(false);
  });
});
