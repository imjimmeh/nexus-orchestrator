import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { AgentProfileChangeApplier } from './agent-profile-change.applier';
import type { AiConfigAdminService } from '../../ai-config/ai-config-admin.service';
import type { AgentSkillsService } from '../../ai-config/services/agent-skills.service';
import type { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import type { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';
import type { ImprovementProposal } from '../database/entities/improvement-proposal.entity';

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile-uuid-1',
    name: 'implementation-agent',
    system_prompt: 'Base prompt.',
    model_name: null,
    provider_name: null,
    thinking_level: null,
    tool_policy: { default: 'deny', rules: [] },
    assigned_skills: ['testing-unit-patterns'],
    overrides: null,
    ...overrides,
  } as AgentProfile;
}

function makeProposal(
  overrides: Partial<ImprovementProposal> = {},
): ImprovementProposal {
  return {
    id: 'proposal-uuid-1',
    kind: 'agent_profile_change',
    status: 'approved',
    payload: {
      profileName: 'implementation-agent',
      patch: {
        system_prompt: { mode: 'append', value: 'Always run the linter.' },
      },
      changeSummary: 'Append lint reminder',
    },
    rollback_data: null,
    ...overrides,
  } as ImprovementProposal;
}

function buildApplier(profile: AgentProfile | null = makeProfile()) {
  const mocks = {
    aiConfigAdmin: { updateAgentProfile: vi.fn().mockResolvedValue(undefined) },
    agentSkills: {
      addProfileSkills: vi.fn().mockResolvedValue([]),
      removeProfileSkills: vi.fn().mockResolvedValue([]),
    },
    profileRepository: {
      findByName: vi.fn().mockResolvedValue(profile),
      update: vi.fn().mockResolvedValue(profile),
    },
    proposalRepository: { update: vi.fn().mockResolvedValue(undefined) },
  };
  const applier = new AgentProfileChangeApplier(
    mocks.aiConfigAdmin as unknown as AiConfigAdminService,
    mocks.agentSkills as unknown as AgentSkillsService,
    mocks.profileRepository as unknown as AgentProfileRepository,
    mocks.proposalRepository as unknown as Repository<ImprovementProposal>,
  );
  return { applier, mocks };
}

describe('AgentProfileChangeApplier.apply', () => {
  it('writes rollback_data BEFORE mutating the profile', async () => {
    const { applier, mocks } = buildApplier();
    await applier.apply(makeProposal());
    const snapshotOrder =
      mocks.proposalRepository.update.mock.invocationCallOrder[0];
    const mutateOrder =
      mocks.aiConfigAdmin.updateAgentProfile.mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(mutateOrder);
    expect(mocks.proposalRepository.update).toHaveBeenCalledWith(
      'proposal-uuid-1',
      {
        rollback_data: expect.objectContaining({
          system_prompt: 'Base prompt.',
        }),
      },
    );
  });

  it('rollback_data survives a mutation failure (failure injection)', async () => {
    const { applier, mocks } = buildApplier();
    mocks.aiConfigAdmin.updateAgentProfile.mockRejectedValue(
      new Error('db down'),
    );
    const result = await applier.apply(makeProposal());
    expect(result.ok).toBe(false);
    expect(mocks.proposalRepository.update).toHaveBeenCalledWith(
      'proposal-uuid-1',
      expect.objectContaining({ rollback_data: expect.anything() }),
    );
  });

  it('does not re-snapshot on retry (idempotency)', async () => {
    const { applier, mocks } = buildApplier();
    const proposal = makeProposal({
      rollback_data: {
        profileId: 'profile-uuid-1',
        system_prompt: 'Original.',
      },
    });
    const result = await applier.apply(proposal);
    expect(result.ok).toBe(true);
    expect(mocks.proposalRepository.update).not.toHaveBeenCalled();
  });

  it('appends to the existing system prompt and pins overrides with provenance', async () => {
    const { applier, mocks } = buildApplier();
    await applier.apply(makeProposal());
    expect(mocks.aiConfigAdmin.updateAgentProfile).toHaveBeenCalledWith(
      'profile-uuid-1',
      expect.objectContaining({
        system_prompt: 'Base prompt.\n\nAlways run the linter.',
      }),
    );
    expect(mocks.profileRepository.update).toHaveBeenCalledWith(
      'profile-uuid-1',
      {
        overrides: expect.objectContaining({
          improvement_proposal: expect.objectContaining({
            proposal_id: 'proposal-uuid-1',
          }),
        }),
      },
    );
  });

  it('applies assigned_skills add/remove through AgentSkillsService', async () => {
    const { applier, mocks } = buildApplier();
    await applier.apply(
      makeProposal({
        payload: {
          profileName: 'implementation-agent',
          patch: {
            assigned_skills: {
              add: ['workflow-yaml-authoring'],
              remove: ['testing-unit-patterns'],
            },
          },
          changeSummary: 'Swap skills',
        },
      }),
    );
    expect(mocks.agentSkills.addProfileSkills).toHaveBeenCalledWith(
      'profile-uuid-1',
      ['workflow-yaml-authoring'],
    );
    expect(mocks.agentSkills.removeProfileSkills).toHaveBeenCalledWith(
      'profile-uuid-1',
      ['testing-unit-patterns'],
    );
  });

  it('returns ok:false without mutating when the profile does not exist', async () => {
    const { applier, mocks } = buildApplier(null);
    const result = await applier.apply(makeProposal());
    expect(result.ok).toBe(false);
    expect(mocks.aiConfigAdmin.updateAgentProfile).not.toHaveBeenCalled();
    expect(mocks.proposalRepository.update).not.toHaveBeenCalled();
  });

  it('returns ok:false without mutating on an invalid payload', async () => {
    const { applier, mocks } = buildApplier();
    const result = await applier.apply(
      makeProposal({ payload: { profileName: '', patch: {} } }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.profileRepository.findByName).not.toHaveBeenCalled();
    expect(mocks.aiConfigAdmin.updateAgentProfile).not.toHaveBeenCalled();
  });

  it('only changes the fields present in a partial patch', async () => {
    const { applier, mocks } = buildApplier(
      makeProfile({ model_name: 'gpt-4', provider_name: 'openai' }),
    );
    await applier.apply(
      makeProposal({
        payload: {
          profileName: 'implementation-agent',
          patch: { thinking_level: 'high' },
          changeSummary: 'Bump thinking level',
        },
      }),
    );
    expect(mocks.aiConfigAdmin.updateAgentProfile).toHaveBeenCalledWith(
      'profile-uuid-1',
      { thinking_level: 'high' },
    );
  });
});

describe('AgentProfileChangeApplier.rollback', () => {
  it('restores the snapshot via the service path and clears the overrides marker', async () => {
    const { applier, mocks } = buildApplier();
    await applier.rollback(
      makeProposal({
        rollback_data: {
          profileId: 'profile-uuid-1',
          profileName: 'implementation-agent',
          system_prompt: 'Base prompt.',
          model_name: null,
          provider_name: null,
          thinking_level: null,
          tool_policy: { default: 'deny', rules: [] },
          assigned_skills: ['testing-unit-patterns'],
          overrides: null,
        },
      }),
    );
    expect(mocks.aiConfigAdmin.updateAgentProfile).toHaveBeenCalledWith(
      'profile-uuid-1',
      expect.objectContaining({ system_prompt: 'Base prompt.' }),
    );
    expect(mocks.profileRepository.update).toHaveBeenCalledWith(
      'profile-uuid-1',
      expect.objectContaining({
        overrides: null,
        assigned_skills: ['testing-unit-patterns'],
      }),
    );
  });

  it('throws when rollback_data is absent', async () => {
    const { applier } = buildApplier();
    await expect(
      applier.rollback(makeProposal({ rollback_data: null })),
    ).rejects.toThrow();
  });

  it('restores a null system_prompt via the raw repository path, not the service path', async () => {
    const { applier, mocks } = buildApplier();
    await applier.rollback(
      makeProposal({
        rollback_data: {
          profileId: 'profile-uuid-1',
          profileName: 'implementation-agent',
          system_prompt: null,
          model_name: null,
          provider_name: null,
          thinking_level: null,
          tool_policy: { default: 'deny', rules: [] },
          assigned_skills: ['testing-unit-patterns'],
          overrides: null,
        },
      }),
    );
    expect(mocks.profileRepository.update).toHaveBeenCalledWith(
      'profile-uuid-1',
      expect.objectContaining({ system_prompt: null }),
    );
    const serviceCallArgs =
      mocks.aiConfigAdmin.updateAgentProfile.mock.calls[0]?.[1];
    expect(serviceCallArgs).not.toHaveProperty('system_prompt');
  });
});
