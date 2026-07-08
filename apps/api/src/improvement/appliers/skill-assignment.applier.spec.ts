import { describe, expect, it, vi } from 'vitest';
import { SkillAssignmentApplier } from './skill-assignment.applier';

function deps() {
  return {
    skills: {
      skillExists: vi.fn(() => true),
      addProfileSkills: vi.fn(async () => undefined),
      addScopedProfileSkill: vi.fn(async () => undefined),
      removeProfileSkills: vi.fn(async () => undefined),
    },
    bindings: {
      addBinding: vi.fn(async () => undefined),
      removeBinding: vi.fn(async () => undefined),
    },
    proposals: { updateById: vi.fn(async () => undefined) },
  };
}

describe('SkillAssignmentApplier', () => {
  it('applies agent_profile and workflow_step targets and records rollback data', async () => {
    const d = deps();
    const applier = new SkillAssignmentApplier(
      d.skills,
      d.bindings,
      d.proposals as any,
    );

    const result = await applier.apply({
      id: 'p1',
      kind: 'skill_assignment',
      provenance: {},
      payload: {
        skillName: 'sk',
        assignment_targets: [
          { type: 'agent_profile', profileName: 'agent-x' },
          { type: 'workflow_step', workflowName: 'auto_merge', stepId: 'gate' },
        ],
      },
      rollback_data: null,
    } as any);

    expect(result.ok).toBe(true);
    expect(result.unrouted).toBeFalsy();
    expect(d.skills.skillExists).toHaveBeenCalledWith('sk');
    expect(d.skills.addProfileSkills).toHaveBeenCalledWith('agent-x', ['sk']);
    expect(d.bindings.addBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: 'auto_merge',
        stepId: 'gate',
        skillName: 'sk',
      }),
    );
    expect(d.proposals.updateById).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        rollback_data: expect.objectContaining({
          applied_targets: [
            { type: 'agent_profile', profileName: 'agent-x' },
            {
              type: 'workflow_step',
              workflowName: 'auto_merge',
              stepId: 'gate',
            },
          ],
          unrouted_targets: [],
        }),
      }),
    );
  });

  it('does not itself set status:applied — the ImprovementProposalService wrapper owns the status transition', async () => {
    const d = deps();
    const applier = new SkillAssignmentApplier(
      d.skills,
      d.bindings,
      d.proposals as any,
    );

    await applier.apply({
      id: 'p1',
      kind: 'skill_assignment',
      provenance: {},
      payload: {
        skillName: 'sk',
        assignment_targets: [{ type: 'agent_profile', profileName: 'agent-x' }],
      },
      rollback_data: null,
    } as any);

    const [, patch] = (d.proposals.updateById as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, Record<string, unknown>];
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('applied_at');
  });

  it('fails without applying anything when the skill does not exist', async () => {
    const d = deps();
    d.skills.skillExists.mockReturnValue(false);
    const applier = new SkillAssignmentApplier(
      d.skills,
      d.bindings,
      d.proposals as any,
    );

    const result = await applier.apply({
      id: 'p1',
      kind: 'skill_assignment',
      provenance: {},
      payload: {
        skillName: 'ghost-skill',
        assignment_targets: [{ type: 'agent_profile', profileName: 'agent-x' }],
      },
      rollback_data: null,
    } as any);

    expect(result.ok).toBe(false);
    expect(d.skills.addProfileSkills).not.toHaveBeenCalled();
    expect(d.bindings.addBinding).not.toHaveBeenCalled();
    expect(d.proposals.updateById).not.toHaveBeenCalled();
  });

  it('records an unrouted target instead of failing the whole proposal', async () => {
    const d = deps();
    d.skills.addProfileSkills.mockRejectedValueOnce(
      new Error('Agent profile with name ghost-agent not found'),
    );
    const applier = new SkillAssignmentApplier(
      d.skills,
      d.bindings,
      d.proposals as any,
    );

    const result = await applier.apply({
      id: 'p1',
      kind: 'skill_assignment',
      provenance: {},
      payload: {
        skillName: 'sk',
        assignment_targets: [
          { type: 'agent_profile', profileName: 'ghost-agent' },
        ],
      },
      rollback_data: null,
    } as any);

    expect(result.ok).toBe(true);
    expect(result.unrouted).toBe(true);
    expect(d.proposals.updateById).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        rollback_data: expect.objectContaining({
          applied_targets: [],
          unrouted_targets: [
            {
              target: { type: 'agent_profile', profileName: 'ghost-agent' },
              reason: 'Agent profile with name ghost-agent not found',
            },
          ],
        }),
      }),
    );
  });

  it('surfaces unrouted:true when only some targets fail to resolve', async () => {
    const d = deps();
    d.skills.addProfileSkills.mockImplementation(
      async (profileName: string) => {
        if (profileName === 'ghost-agent') {
          throw new Error('Agent profile with name ghost-agent not found');
        }
      },
    );
    const applier = new SkillAssignmentApplier(
      d.skills,
      d.bindings,
      d.proposals as any,
    );

    const result = await applier.apply({
      id: 'p1',
      kind: 'skill_assignment',
      provenance: {},
      payload: {
        skillName: 'sk',
        assignment_targets: [
          { type: 'agent_profile', profileName: 'agent-x' },
          { type: 'agent_profile', profileName: 'ghost-agent' },
        ],
      },
      rollback_data: null,
    } as any);

    expect(result.ok).toBe(true);
    expect(result.unrouted).toBe(true);
    expect(d.proposals.updateById).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        rollback_data: expect.objectContaining({
          applied_targets: [{ type: 'agent_profile', profileName: 'agent-x' }],
          unrouted_targets: [
            expect.objectContaining({
              target: { type: 'agent_profile', profileName: 'ghost-agent' },
            }),
          ],
        }),
      }),
    );
  });

  it('rollback removes previously applied targets', async () => {
    const d = deps();
    const applier = new SkillAssignmentApplier(
      d.skills,
      d.bindings,
      d.proposals as any,
    );

    await applier.rollback({
      id: 'p1',
      kind: 'skill_assignment',
      payload: { skillName: 'sk' },
      rollback_data: {
        applied_targets: [
          { type: 'agent_profile', profileName: 'agent-x' },
          { type: 'workflow_step', workflowName: 'auto_merge', stepId: 'gate' },
        ],
      },
    } as any);

    expect(d.skills.removeProfileSkills).toHaveBeenCalledWith('agent-x', [
      'sk',
    ]);
    expect(d.bindings.removeBinding).toHaveBeenCalledWith({
      workflowName: 'auto_merge',
      stepId: 'gate',
      skillName: 'sk',
    });
  });

  it('rollback is a no-op when there is nothing recorded to undo', async () => {
    const d = deps();
    const applier = new SkillAssignmentApplier(
      d.skills,
      d.bindings,
      d.proposals as any,
    );

    await applier.rollback({
      id: 'p1',
      kind: 'skill_assignment',
      payload: { skillName: 'sk' },
      rollback_data: null,
    } as any);

    expect(d.skills.removeProfileSkills).not.toHaveBeenCalled();
    expect(d.bindings.removeBinding).not.toHaveBeenCalled();
  });

  it('passes provenance.scope_id through to applySkillAssignments', async () => {
    const d = deps();
    const applier = new SkillAssignmentApplier(
      d.skills,
      d.bindings,
      d.proposals as any,
    );

    await applier.apply({
      id: 'proposal-1',
      kind: 'skill_assignment',
      payload: {
        skillName: 'incident-response',
        assignment_targets: [
          { type: 'agent_profile', profileName: 'backend-engineer' },
        ],
      },
      provenance: { scope_id: 'scope-1' },
      rollback_data: null,
    } as any);

    expect(d.skills.addScopedProfileSkill).toHaveBeenCalledWith({
      profileName: 'backend-engineer',
      skillName: 'incident-response',
      scopeNodeId: 'scope-1',
    });
    expect(d.skills.addProfileSkills).not.toHaveBeenCalled();
  });
});
