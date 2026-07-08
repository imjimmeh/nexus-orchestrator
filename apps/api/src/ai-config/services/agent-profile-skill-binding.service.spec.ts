import { describe, expect, it, vi } from 'vitest';
import { AgentProfileSkillBindingService } from './agent-profile-skill-binding.service';

function makeRepo() {
  const rows: any[] = [];
  return {
    rows,
    upsert: vi.fn(async (input: any) => {
      const row = { id: `b${rows.length + 1}`, ...input };
      rows.push(row);
      return row;
    }),
    listForScopeNodeIds: vi.fn(async (ids: string[]) =>
      rows.filter((r) => ids.includes(r.scope_node_id)),
    ),
  };
}

function makeProfiles() {
  return {
    findByName: vi.fn(async (name: string) =>
      name === 'unknown-profile' ? null : { id: `profile-${name}`, name },
    ),
  };
}

function makeScope() {
  return {
    getAncestorIds: vi.fn(async (nodeId: string) => [nodeId, 'org-root']),
    isLiveScope: vi.fn(async () => true),
  };
}

describe('AgentProfileSkillBindingService.addProjectScopedBinding', () => {
  it('inserts a whole-scope binding with a null agent_profile_id', async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );

    await service.addProjectScopedBinding({
      skillName: 'incident-response',
      scopeNodeId: 'scope-1',
    });

    expect(repo.upsert).toHaveBeenCalledWith({
      agent_profile_id: null,
      scope_node_id: 'scope-1',
      skill_name: 'incident-response',
      provenance: null,
    });
  });
});

describe('AgentProfileSkillBindingService.addProfileScopedBinding', () => {
  it('resolves the profile name and inserts a profile-scoped binding', async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );

    await service.addProfileScopedBinding({
      skillName: 'incident-response',
      scopeNodeId: 'scope-1',
      profileName: 'backend-engineer',
    });

    expect(repo.upsert).toHaveBeenCalledWith({
      agent_profile_id: 'profile-backend-engineer',
      scope_node_id: 'scope-1',
      skill_name: 'incident-response',
      provenance: null,
    });
  });

  it('throws when the profile name does not resolve', async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );

    await expect(
      service.addProfileScopedBinding({
        skillName: 'incident-response',
        scopeNodeId: 'scope-1',
        profileName: 'unknown-profile',
      }),
    ).rejects.toThrow('unknown-profile');
  });
});

describe('AgentProfileSkillBindingService.listApplicableSkillNames', () => {
  it('returns an empty array when no scopeNodeId is given', async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );

    const names = await service.listApplicableSkillNames({});
    expect(names).toEqual([]);
    expect(repo.listForScopeNodeIds).not.toHaveBeenCalled();
  });

  it('includes whole-scope bindings for any profile', async () => {
    const repo = makeRepo();
    const scope = makeScope();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      scope as any,
    );
    await service.addProjectScopedBinding({
      skillName: 'incident-response',
      scopeNodeId: 'scope-1',
    });

    const names = await service.listApplicableSkillNames({
      scopeNodeId: 'scope-1',
      agentProfileName: 'backend-engineer',
    });

    expect(names).toEqual(['incident-response']);
    expect(scope.getAncestorIds).toHaveBeenCalledWith('scope-1');
  });

  it('includes ancestor-scope bindings (org-level binding reaches a child project)', async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );
    await service.addProjectScopedBinding({
      skillName: 'org-wide-skill',
      scopeNodeId: 'org-root',
    });

    const names = await service.listApplicableSkillNames({
      scopeNodeId: 'scope-1',
    });

    expect(names).toEqual(['org-wide-skill']);
  });

  it('excludes a profile-scoped binding for a different profile', async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );
    await service.addProfileScopedBinding({
      skillName: 'incident-response',
      scopeNodeId: 'scope-1',
      profileName: 'backend-engineer',
    });

    const names = await service.listApplicableSkillNames({
      scopeNodeId: 'scope-1',
      agentProfileName: 'frontend-engineer',
    });

    expect(names).toEqual([]);
  });
});

describe('AgentProfileSkillBindingService — scope validation', () => {
  it('addProjectScopedBinding throws when the scope node is not live', async () => {
    const repo = makeRepo();
    const scope = makeScope();
    scope.isLiveScope.mockResolvedValue(false);
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      scope as any,
    );

    await expect(
      service.addProjectScopedBinding({
        skillName: 'incident-response',
        scopeNodeId: 'archived-scope',
      }),
    ).rejects.toThrow('archived-scope');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('addProfileScopedBinding throws when the scope node is not live', async () => {
    const repo = makeRepo();
    const scope = makeScope();
    scope.isLiveScope.mockResolvedValue(false);
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      scope as any,
    );

    await expect(
      service.addProfileScopedBinding({
        skillName: 'incident-response',
        scopeNodeId: 'archived-scope',
        profileName: 'backend-engineer',
      }),
    ).rejects.toThrow('archived-scope');
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});
