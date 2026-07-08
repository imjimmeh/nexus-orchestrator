import { describe, it, expect, vi } from 'vitest';
import { AuthorizationService } from './authorization.service';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

const USER_UUID = 'a1b2c3d4-e5f6-4789-abcd-000000000001';
const SCOPE_UUID = 'b2c3d4e5-f6a7-4890-bcde-000000000002';
const SCOPE_UUID_2 = 'c3d4e5f6-a7b8-4901-cdef-000000000003';
const NODE_UUID = 'd4e5f6a7-b8c9-4012-def0-000000000004';

describe('AuthorizationService (scope-aware, EPIC-204C)', () => {
  function makeService(rows: Array<{ name: string }>) {
    const repo = { query: vi.fn().mockResolvedValue(rows) } as any;
    return { svc: new AuthorizationService(repo), repo };
  }

  it('resolves permissions via role_assignments joined to scope_node_closure', async () => {
    const { svc, repo } = makeService([{ name: 'workflows:read' }]);
    await svc.getEffectivePermissions(USER_UUID, NODE_UUID);
    const [sql, params] = repo.query.mock.calls[0];
    expect(sql).toContain('role_assignments');
    expect(sql).toContain('scope_node_closure');
    expect(sql).toContain('c.ancestor_id = ra.scope_node_id');
    expect(sql).toContain('c.descendant_id = $2');
    expect(params).toEqual([USER_UUID, NODE_UUID]);
  });

  it('defaults the target scope node to the global root when none given', async () => {
    const { svc, repo } = makeService([]);
    await svc.getEffectivePermissions(USER_UUID);
    expect(repo.query.mock.calls[0][1]).toEqual([
      USER_UUID,
      GLOBAL_SCOPE_NODE_ID,
    ]);
  });

  it('returns the union of inherited permissions', async () => {
    const { svc } = makeService([
      { name: 'workflows:read' },
      { name: 'workflows:create' },
    ]);
    const perms = await svc.getEffectivePermissions(USER_UUID, SCOPE_UUID);
    expect(perms.has('workflows:read')).toBe(true);
    expect(perms.has('workflows:create')).toBe(true);
  });

  it('can() honors manage as a superset', async () => {
    const { svc } = makeService([{ name: 'workflows:manage' }]);
    expect(await svc.can(USER_UUID, 'workflows:update', SCOPE_UUID)).toBe(true);
    expect(await svc.can(USER_UUID, 'agents:update', SCOPE_UUID)).toBe(false);
  });

  it('can() returns true on exact match', async () => {
    const { svc } = makeService([{ name: 'agents:read' }]);
    expect(await svc.can(USER_UUID, 'agents:read', SCOPE_UUID)).toBe(true);
  });

  it('memoizes effective permissions per userId+scopeNodeId within a request', async () => {
    const repo = {
      query: vi.fn().mockResolvedValue([{ name: 'workflows:read' }]),
    } as any;
    const svc = new AuthorizationService(repo);
    await svc.getEffectivePermissions(USER_UUID, SCOPE_UUID);
    await svc.getEffectivePermissions(USER_UUID, SCOPE_UUID);
    expect(repo.query).toHaveBeenCalledTimes(1);
  });

  it('does not share the memo across distinct scope nodes', async () => {
    const repo = { query: vi.fn().mockResolvedValue([]) } as any;
    const svc = new AuthorizationService(repo);
    await svc.getEffectivePermissions(USER_UUID, SCOPE_UUID);
    await svc.getEffectivePermissions(USER_UUID, SCOPE_UUID_2);
    expect(repo.query).toHaveBeenCalledTimes(2);
  });

  describe('non-UUID userId (agent tokens and service tokens)', () => {
    it('returns empty permissions without querying the DB for agent token userId when no roles are passed', async () => {
      const { svc, repo } = makeService([{ name: 'agents:read' }]);
      const agentUserId =
        'agent:684d9025-501a-40af-b076-b6b013e928f2:ceo_orchestration_decision';
      const perms = await svc.getEffectivePermissions(agentUserId, 's1');
      expect(perms.size).toBe(0);
      expect(repo.query).not.toHaveBeenCalled();
    });

    it('resolves permissions from DB roles when roles are passed for non-UUID userId', async () => {
      const { svc, repo } = makeService([{ name: 'workflows:read' }]);
      const perms = await svc.getEffectivePermissions('chat-service', 's1', [
        'Admin',
      ]);
      expect(perms.has('workflows:read')).toBe(true);
      expect(repo.query).toHaveBeenCalled();
      const [sql, params] = repo.query.mock.calls[0];
      expect(sql).toContain('FROM roles r');
      expect(sql).toContain('LOWER(r.name) = ANY($1)');
      expect(params).toEqual([['admin']]);
    });

    it('returns empty permissions for any non-UUID string userId without querying the DB when no roles are passed', async () => {
      const { svc, repo } = makeService([{ name: 'agents:read' }]);
      const perms = await svc.getEffectivePermissions(
        'agent:chat:some-chat-session-id',
        's1',
      );
      expect(perms.size).toBe(0);
      expect(repo.query).not.toHaveBeenCalled();
    });

    it('can() returns true when roles match permission', async () => {
      const { svc, repo } = makeService([{ name: 'workflows:read' }]);
      const agentUserId =
        'agent:684d9025-501a-40af-b076-b6b013e928f2:ceo_orchestration_decision';
      const result = await svc.can(agentUserId, 'workflows:read', 's1', [
        'Agent',
      ]);
      expect(result).toBe(true);
      expect(repo.query).toHaveBeenCalled();
    });

    it('can() returns false for non-UUID userId without throwing when no roles are passed', async () => {
      const { svc, repo } = makeService([]);
      const agentUserId =
        'agent:684d9025-501a-40af-b076-b6b013e928f2:ceo_orchestration_decision';
      const result = await svc.can(agentUserId, 'agents:read', 's1');
      expect(result).toBe(false);
      expect(repo.query).not.toHaveBeenCalled();
    });
  });
});
