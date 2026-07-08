import { describe, expect, it, vi } from 'vitest';
import { AgentProfilesController } from './agent-profiles.controller';

describe('AgentProfilesController GitOps actor propagation', () => {
  function makeController() {
    const admin = {
      updateAgentProfile: vi.fn().mockResolvedValue({ id: 'profile-1' }),
      deleteAgentProfile: vi.fn().mockResolvedValue(undefined),
      createScopedAgentOverride: vi.fn().mockResolvedValue({ id: 'profile-2' }),
    } as any;
    return {
      controller: new AgentProfilesController(admin, {} as any, {} as any),
      admin,
    };
  }

  it('passes the authenticated actor to profile updates', async () => {
    const { controller, admin } = makeController();

    await controller.updateAgentProfile(
      'profile-1',
      { system_prompt: 'updated' },
      { user: { userId: 'user-1' } },
    );

    expect(admin.updateAgentProfile).toHaveBeenCalledWith(
      'profile-1',
      { system_prompt: 'updated' },
      'user-1',
    );
  });

  it('passes the authenticated actor to profile deletes', async () => {
    const { controller, admin } = makeController();

    await controller.deleteAgentProfile('profile-1', {
      user: { userId: 'user-1' },
    });

    expect(admin.deleteAgentProfile).toHaveBeenCalledWith(
      'profile-1',
      'user-1',
    );
  });

  it('passes the authenticated actor to scoped profile overrides', async () => {
    const { controller, admin } = makeController();

    await controller.forkAgentForScope(
      'profile-1',
      'scope-1',
      { system_prompt: 'scoped' },
      { user: { userId: 'user-1' } },
    );

    expect(admin.createScopedAgentOverride).toHaveBeenCalledWith(
      'profile-1',
      'scope-1',
      { system_prompt: 'scoped' },
      'user-1',
    );
  });
});

describe('AgentProfilesController.listAgentProfiles default-deny scope filter', () => {
  const REQ = { user: { userId: 'user-1' } } as any;

  function makeController(accessibleIds: string[]) {
    const admin = {
      listAgentProfiles: vi.fn().mockResolvedValue([]),
    } as any;
    const scopeAccess = {
      restrictToAccessibleScopes: vi
        .fn()
        .mockImplementation(
          async (
            _userId: string,
            _permission: string,
            requestedScopeId?: string,
          ) => {
            if (!requestedScopeId) return accessibleIds;
            return accessibleIds.includes(requestedScopeId)
              ? [requestedScopeId]
              : [];
          },
        ),
    } as any;
    return {
      controller: new AgentProfilesController(admin, {} as any, scopeAccess),
      admin,
      scopeAccess,
    };
  }

  it('with no scopeNodeId, restricts the query to the caller accessible scope set', async () => {
    const { controller, admin, scopeAccess } = makeController([
      'team-a',
      'team-a-child',
    ]);

    await controller.listAgentProfiles(undefined, REQ);

    expect(scopeAccess.restrictToAccessibleScopes).toHaveBeenCalledWith(
      'user-1',
      'agents:read',
      undefined,
    );
    expect(admin.listAgentProfiles).toHaveBeenCalledWith([
      'team-a',
      'team-a-child',
    ]);
  });

  it('with an in-subtree scopeNodeId, confines the query to that scope', async () => {
    const { controller, admin } = makeController(['team-a', 'team-a-child']);

    await controller.listAgentProfiles('team-a-child', REQ);

    expect(admin.listAgentProfiles).toHaveBeenCalledWith(['team-a-child']);
  });

  it('with an out-of-subtree scopeNodeId, returns an empty default-deny result', async () => {
    const { controller, admin } = makeController(['team-a']);

    await controller.listAgentProfiles('team-z', REQ);

    expect(admin.listAgentProfiles).toHaveBeenCalledWith([]);
  });
});
