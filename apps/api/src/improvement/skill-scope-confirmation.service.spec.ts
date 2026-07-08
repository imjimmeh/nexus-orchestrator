import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillScopeConfirmationService } from './skill-scope-confirmation.service';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';

function buildPendingProposal(
  recommendedScope: Record<string, unknown> | null,
) {
  return {
    id: 'proposal-1',
    payload: { target_skill_name: 'incident-response' },
    provenance: {
      materialization: {
        materialized: true,
        scope_confirmation: {
          pending: true,
          recommended_scope: recommendedScope,
          scope_rationale: 'generalizes across projects',
        },
      },
    },
  };
}

describe('SkillScopeConfirmationService.confirm', () => {
  let proposals: any;
  let authz: any;
  let skillsService: any;
  let scopeService: any;
  let service: SkillScopeConfirmationService;

  beforeEach(() => {
    proposals = {
      findById: vi.fn(),
      updateById: vi.fn(),
    };
    authz = { can: vi.fn() };
    skillsService = {
      getSkill: vi.fn().mockReturnValue({
        name: 'incident-response',
        skillMarkdown:
          '---\nname: incident-response\ndescription: handles incidents\n---\n',
      }),
      updateSkill: vi.fn(),
    };
    scopeService = { isLiveScope: vi.fn(async () => true) };
    service = new SkillScopeConfirmationService(
      proposals,
      authz,
      skillsService,
      scopeService,
    );
  });

  it('applies the recommended scope when the user has skills:update at every target project', async () => {
    proposals.findById.mockResolvedValue(
      buildPendingProposal({
        projects: ['scope-2'],
        agents: [],
        workflows: [],
      }),
    );
    authz.can.mockResolvedValue(true);

    const result = await service.confirm('proposal-1', 'user-1');

    expect(result.confirmed).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'user-1',
      'skills:update',
      'scope-2',
    );
    expect(skillsService.updateSkill).toHaveBeenCalledWith(
      'incident-response',
      {
        skill_markdown: expect.stringContaining('scope-2'),
      },
    );
    expect(proposals.updateById).toHaveBeenCalledWith(
      'proposal-1',
      expect.objectContaining({
        provenance: expect.objectContaining({
          materialization: expect.objectContaining({
            scope_confirmation: expect.objectContaining({
              pending: false,
              auto_applied: false,
            }),
          }),
        }),
      }),
    );
  });

  it('checks GLOBAL_SCOPE_NODE_ID when the recommendation has no project restriction', async () => {
    proposals.findById.mockResolvedValue(
      buildPendingProposal({ projects: [], agents: [], workflows: [] }),
    );
    authz.can.mockResolvedValue(true);

    await service.confirm('proposal-1', 'user-1');

    expect(authz.can).toHaveBeenCalledWith(
      'user-1',
      'skills:update',
      GLOBAL_SCOPE_NODE_ID,
    );
  });

  it('refuses to apply when the user lacks permission at any target scope', async () => {
    proposals.findById.mockResolvedValue(
      buildPendingProposal({
        projects: ['scope-2', 'scope-3'],
        agents: [],
        workflows: [],
      }),
    );
    authz.can.mockImplementation(
      async (_userId: string, _perm: string, scopeNodeId: string) =>
        scopeNodeId === 'scope-2',
    );

    const result = await service.confirm('proposal-1', 'user-1');

    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain('scope-3');
    expect(skillsService.updateSkill).not.toHaveBeenCalled();
  });

  it('refuses to apply when the recommendation names an agent and the user lacks skills:update at GLOBAL_SCOPE_NODE_ID, even with per-project permission', async () => {
    proposals.findById.mockResolvedValue(
      buildPendingProposal({
        projects: ['scope-2'],
        agents: ['architect'],
        workflows: [],
      }),
    );
    authz.can.mockImplementation(
      async (_userId: string, _perm: string, scopeNodeId: string) =>
        scopeNodeId === 'scope-2',
    );

    const result = await service.confirm('proposal-1', 'user-1');

    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain(GLOBAL_SCOPE_NODE_ID);
    expect(skillsService.updateSkill).not.toHaveBeenCalled();
  });

  it('refuses to apply when the recommendation names a workflow and the user lacks skills:update at GLOBAL_SCOPE_NODE_ID, even with per-project permission', async () => {
    proposals.findById.mockResolvedValue(
      buildPendingProposal({
        projects: ['scope-2'],
        agents: [],
        workflows: ['wf-1'],
      }),
    );
    authz.can.mockImplementation(
      async (_userId: string, _perm: string, scopeNodeId: string) =>
        scopeNodeId === 'scope-2',
    );

    const result = await service.confirm('proposal-1', 'user-1');

    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain(GLOBAL_SCOPE_NODE_ID);
    expect(skillsService.updateSkill).not.toHaveBeenCalled();
  });

  it('applies the recommended scope when the recommendation names an agent and the user has skills:update at both the project AND GLOBAL_SCOPE_NODE_ID', async () => {
    proposals.findById.mockResolvedValue(
      buildPendingProposal({
        projects: ['scope-2'],
        agents: ['architect'],
        workflows: [],
      }),
    );
    authz.can.mockResolvedValue(true);

    const result = await service.confirm('proposal-1', 'user-1');

    expect(result.confirmed).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'user-1',
      'skills:update',
      'scope-2',
    );
    expect(authz.can).toHaveBeenCalledWith(
      'user-1',
      'skills:update',
      GLOBAL_SCOPE_NODE_ID,
    );
    expect(skillsService.updateSkill).toHaveBeenCalledWith(
      'incident-response',
      {
        skill_markdown: expect.stringContaining('architect'),
      },
    );
  });

  it('does not require a GLOBAL_SCOPE_NODE_ID check for a projects-only recommendation (no regression)', async () => {
    proposals.findById.mockResolvedValue(
      buildPendingProposal({
        projects: ['scope-2'],
        agents: [],
        workflows: [],
      }),
    );
    authz.can.mockImplementation(
      async (_userId: string, _perm: string, scopeNodeId: string) =>
        scopeNodeId === 'scope-2',
    );

    const result = await service.confirm('proposal-1', 'user-1');

    expect(result.confirmed).toBe(true);
    expect(authz.can).not.toHaveBeenCalledWith(
      'user-1',
      'skills:update',
      GLOBAL_SCOPE_NODE_ID,
    );
  });

  it('throws when the proposal has no pending scope confirmation', async () => {
    proposals.findById.mockResolvedValue({
      id: 'proposal-1',
      payload: {},
      provenance: {},
    });

    await expect(service.confirm('proposal-1', 'user-1')).rejects.toThrow(
      'no pending scope confirmation',
    );
  });

  it('rejects confirmation when a recommended project scope no longer resolves to a live scope node', async () => {
    const staleScopeService = { isLiveScope: vi.fn(async () => false) };
    const staleService = new SkillScopeConfirmationService(
      proposals,
      authz,
      skillsService,
      staleScopeService as any,
    );
    proposals.findById.mockResolvedValue(
      buildPendingProposal({
        projects: ['deleted-project'],
        agents: [],
        workflows: [],
      }),
    );

    await expect(staleService.confirm('proposal-1', 'user-1')).rejects.toThrow(
      'deleted-project',
    );
    expect(authz.can).not.toHaveBeenCalled();
    expect(skillsService.updateSkill).not.toHaveBeenCalled();
  });
});

describe('SkillScopeConfirmationService.reject', () => {
  it('clears pending without changing the applied origin scope', async () => {
    const proposals = {
      findById: vi.fn().mockResolvedValue(
        buildPendingProposal({
          projects: ['scope-2'],
          agents: [],
          workflows: [],
        }),
      ),
      updateById: vi.fn(),
    };
    const authz = { can: vi.fn() };
    const skillsService = { getSkill: vi.fn(), updateSkill: vi.fn() };
    const scopeService = { isLiveScope: vi.fn(async () => true) };
    const service = new SkillScopeConfirmationService(
      proposals as any,
      authz as any,
      skillsService as any,
      scopeService as any,
    );

    await service.reject('proposal-1');

    expect(skillsService.updateSkill).not.toHaveBeenCalled();
    expect(proposals.updateById).toHaveBeenCalledWith(
      'proposal-1',
      expect.objectContaining({
        provenance: expect.objectContaining({
          materialization: expect.objectContaining({
            scope_confirmation: expect.objectContaining({ pending: false }),
          }),
        }),
      }),
    );
  });
});
