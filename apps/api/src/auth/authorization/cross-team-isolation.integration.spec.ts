import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from './authorization.service';
import { PermissionsGuard } from './permissions.guard';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

// ---------------------------------------------------------------------------
// Scope IDs used throughout
// ---------------------------------------------------------------------------
const TEAM_A_ID = 'team-a-id';
const TEAM_B_ID = 'team-b-id';
const PROJECT_A_ID = 'project-a-id';
const PROJECT_B_ID = 'project-b-id';

const MEMBER_ROLE_ID = 'member-role';
const MEMBER_PERMISSIONS = ['workflows:read', 'workflows:write'];

const USER_1 = '00000000-0000-4000-8000-000000000001'; // memberRole @ teamA
const USER_2 = '00000000-0000-4000-8000-000000000002'; // memberRole @ teamB

// ---------------------------------------------------------------------------
// In-memory fixture — mirrors the pattern in role-assignment.integration.spec.ts
// ---------------------------------------------------------------------------

/**
 * Closure table: ancestor → Map<descendant, depth>
 * role_assignments: [{userId, roleId, scopeNodeId}]
 * rolePerms: roleId → Set<permissionName>
 */
function makeFixture() {
  const closure = new Map<string, Map<string, number>>();
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
        if (descs.has(parentId)) {
          addClosure(anc, id, descs.get(parentId)! + 1);
        }
      }
    }
  }

  function grantPermissions(roleId: string, permissions: string[]) {
    if (!rolePerms.has(roleId)) rolePerms.set(roleId, new Set());
    for (const p of permissions) rolePerms.get(roleId)!.add(p);
  }

  function assignRole(userId: string, roleId: string, scopeNodeId: string) {
    assignments.push({ userId, roleId, scopeNodeId });
  }

  function makeAuthzService(): AuthorizationService {
    const repo = {
      query: vi.fn(
        async (_sql: string, [userId, targetNode]: [string, string]) => {
          // Replicate the SQL join using in-memory maps:
          // ancestors of targetNode = every ancestor entry whose descendant set includes targetNode
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

// ---------------------------------------------------------------------------
// Shared fixture factory — builds the two-team scope tree
// ---------------------------------------------------------------------------
function buildTwoTeamFixture() {
  const fix = makeFixture();

  fix.grantPermissions(MEMBER_ROLE_ID, MEMBER_PERMISSIONS);

  // Build the tree: GLOBAL → teamA → projectA, GLOBAL → teamB → projectB
  fix.addNode(GLOBAL_SCOPE_NODE_ID, null);
  fix.addNode(TEAM_A_ID, GLOBAL_SCOPE_NODE_ID);
  fix.addNode(PROJECT_A_ID, TEAM_A_ID);
  fix.addNode(TEAM_B_ID, GLOBAL_SCOPE_NODE_ID);
  fix.addNode(PROJECT_B_ID, TEAM_B_ID);

  fix.assignRole(USER_1, MEMBER_ROLE_ID, TEAM_A_ID);
  fix.assignRole(USER_2, MEMBER_ROLE_ID, TEAM_B_ID);

  return fix;
}

// ---------------------------------------------------------------------------
// Helper: minimal ExecutionContext double
// ---------------------------------------------------------------------------
function ctx(user: { userId: string }, params: Record<string, string> = {}) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user, params, query: {}, body: {} }),
    }),
  } as any;
}

// ---------------------------------------------------------------------------
// Helper: reflector that always returns the given permission
// ---------------------------------------------------------------------------
function reflectorFor(permission: string): Reflector {
  return {
    getAllAndOverride: vi
      .fn()
      .mockImplementation((key: string) =>
        key === REQUIRED_PERMISSION_KEY ? permission : undefined,
      ),
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Cross-team isolation — AuthorizationService (EPIC-204D T8)', () => {
  it('T1 — teamA member can read own projectA (descendant via closure)', async () => {
    const fix = buildTwoTeamFixture();
    const authz = fix.makeAuthzService();

    expect(await authz.can(USER_1, 'workflows:read', PROJECT_A_ID)).toBe(true);
  });

  it('T4 — teamA member can read directly at teamA scope', async () => {
    const fix = buildTwoTeamFixture();
    const authz = fix.makeAuthzService();

    expect(await authz.can(USER_1, 'workflows:read', TEAM_A_ID)).toBe(true);
  });

  it('T5 — teamB member has no access to teamA resources', async () => {
    const fix = buildTwoTeamFixture();
    const authz = fix.makeAuthzService();

    expect(await authz.can(USER_2, 'workflows:read', PROJECT_A_ID)).toBe(false);
    expect(await authz.can(USER_2, 'workflows:read', TEAM_A_ID)).toBe(false);
  });
});

describe('Cross-team isolation — PermissionsGuard enforce mode (EPIC-204D T8)', () => {
  it('T2 — teamA member denied on projectB returns false and logs deny event', async () => {
    const fix = buildTwoTeamFixture();
    const authz = fix.makeAuthzService();

    const reflector = reflectorFor('workflows:read');
    const enforcement = {
      getMode: vi.fn().mockResolvedValue('enforce'),
    } as any;
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as any;

    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );
    const result = await guard.canActivate(
      ctx({ userId: USER_1 }, { scopeNodeId: PROJECT_B_ID }),
    );

    expect(result).toBe(false);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: USER_1,
        scopeNodeId: PROJECT_B_ID,
        enforcementMode: 'enforce',
      }),
    );
  });
});

describe('Cross-team isolation — PermissionsGuard audit mode (EPIC-204D T8)', () => {
  it('T3 — audit mode: denied teamB access is allowed but logged as would_deny', async () => {
    const fix = buildTwoTeamFixture();
    const authz = fix.makeAuthzService();

    const reflector = reflectorFor('workflows:read');
    const enforcement = { getMode: vi.fn().mockResolvedValue('audit') } as any;
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as any;

    const guard = new PermissionsGuard(
      reflector,
      authz,
      enforcement,
      authzAudit,
    );
    const result = await guard.canActivate(
      ctx({ userId: USER_1 }, { scopeNodeId: PROJECT_B_ID }),
    );

    expect(result).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: USER_1,
        scopeNodeId: PROJECT_B_ID,
        enforcementMode: 'audit',
      }),
    );
  });
});
