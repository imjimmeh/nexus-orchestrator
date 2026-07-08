import { describe, expect, it, vi } from 'vitest';
import { applySkillAssignments } from './skill-create.applier';

describe('applySkillAssignments', () => {
  it('assigns to profiles and workflow bindings and records rollback data', async () => {
    const skills = { addProfileSkills: vi.fn(async () => undefined) };
    const bindings = { addBinding: vi.fn(async () => undefined) };
    const applied = await applySkillAssignments(
      {
        skillName: 'merge-doctor',
        targets: [
          { type: 'agent_profile', profileName: 'merge-agent' },
          {
            type: 'workflow_step',
            workflowName: 'auto_merge',
            stepId: 'quality_gate',
          },
        ],
        proposalId: 'p1',
      },
      { skills: skills, bindings: bindings },
    );
    expect(skills.addProfileSkills).toHaveBeenCalledWith('merge-agent', [
      'merge-doctor',
    ]);
    expect(bindings.addBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: 'auto_merge',
        stepId: 'quality_gate',
        skillName: 'merge-doctor',
      }),
    );
    expect(applied).toHaveLength(2);
  });

  it('applies a workflow-level binding (no stepId) with stepId:null', async () => {
    const skills = { addProfileSkills: vi.fn(async () => undefined) };
    const bindings = { addBinding: vi.fn(async () => undefined) };
    const applied = await applySkillAssignments(
      {
        skillName: 'merge-doctor',
        targets: [{ type: 'workflow_step', workflowName: 'auto_merge' }],
        proposalId: 'p1',
      },
      { skills: skills, bindings: bindings },
    );
    expect(bindings.addBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: 'auto_merge',
        stepId: null,
        skillName: 'merge-doctor',
        provenance: { proposalId: 'p1' },
      }),
    );
    expect(applied).toEqual([
      {
        status: 'applied',
        target: { type: 'workflow_step', workflowName: 'auto_merge' },
      },
    ]);
  });

  it('records an unresolved target as unrouted instead of throwing', async () => {
    const skills = {
      addProfileSkills: vi.fn(async () => {
        throw new Error('Agent profile with name ghost-agent not found');
      }),
    };
    const bindings = { addBinding: vi.fn(async () => undefined) };

    const outcomes = await applySkillAssignments(
      {
        skillName: 'merge-doctor',
        targets: [{ type: 'agent_profile', profileName: 'ghost-agent' }],
        proposalId: 'p1',
      },
      { skills: skills, bindings: bindings },
    );

    expect(outcomes).toEqual([
      {
        status: 'unrouted',
        target: { type: 'agent_profile', profileName: 'ghost-agent' },
        reason: 'Agent profile with name ghost-agent not found',
      },
    ]);
  });

  it('returns an empty list when there are no targets', async () => {
    const skills = { addProfileSkills: vi.fn(async () => undefined) };
    const bindings = { addBinding: vi.fn(async () => undefined) };

    const outcomes = await applySkillAssignments(
      { skillName: 'merge-doctor', targets: [], proposalId: 'p1' },
      { skills: skills, bindings: bindings },
    );

    expect(outcomes).toEqual([]);
    expect(skills.addProfileSkills).not.toHaveBeenCalled();
    expect(bindings.addBinding).not.toHaveBeenCalled();
  });

  it('routes an agent_profile target through addScopedProfileSkill when scopeId is present', async () => {
    const skills = {
      addProfileSkills: vi.fn(),
      addScopedProfileSkill: vi.fn(),
    };
    const bindings = { addBinding: vi.fn() };

    const outcomes = await applySkillAssignments(
      {
        skillName: 'incident-response',
        targets: [{ type: 'agent_profile', profileName: 'backend-engineer' }],
        proposalId: 'proposal-1',
        scopeId: 'scope-1',
      },
      { skills, bindings },
    );

    expect(skills.addScopedProfileSkill).toHaveBeenCalledWith({
      profileName: 'backend-engineer',
      skillName: 'incident-response',
      scopeNodeId: 'scope-1',
    });
    expect(skills.addProfileSkills).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      {
        status: 'applied',
        target: { type: 'agent_profile', profileName: 'backend-engineer' },
      },
    ]);
  });

  it('falls back to global addProfileSkills when scopeId is absent', async () => {
    const skills = {
      addProfileSkills: vi.fn(),
      addScopedProfileSkill: vi.fn(),
    };
    const bindings = { addBinding: vi.fn() };

    await applySkillAssignments(
      {
        skillName: 'incident-response',
        targets: [{ type: 'agent_profile', profileName: 'backend-engineer' }],
        proposalId: 'proposal-1',
      },
      { skills, bindings },
    );

    expect(skills.addProfileSkills).toHaveBeenCalledWith('backend-engineer', [
      'incident-response',
    ]);
    expect(skills.addScopedProfileSkill).not.toHaveBeenCalled();
  });

  it('records an unrouted outcome (not a throw) when addScopedProfileSkill rejects', async () => {
    const skills = {
      addProfileSkills: vi.fn(),
      addScopedProfileSkill: vi
        .fn()
        .mockRejectedValue(new Error('profile not found')),
    };
    const bindings = { addBinding: vi.fn() };

    const outcomes = await applySkillAssignments(
      {
        skillName: 'incident-response',
        targets: [{ type: 'agent_profile', profileName: 'unknown' }],
        proposalId: 'proposal-1',
        scopeId: 'scope-1',
      },
      { skills, bindings },
    );

    expect(outcomes).toEqual([
      {
        status: 'unrouted',
        target: { type: 'agent_profile', profileName: 'unknown' },
        reason: 'profile not found',
      },
    ]);
  });
});
