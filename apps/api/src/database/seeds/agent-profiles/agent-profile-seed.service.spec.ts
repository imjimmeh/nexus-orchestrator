import { describe, expect, it, vi } from 'vitest';
import { ToolPolicyEffect } from '@nexus/core';
import { AgentProfileSeedService } from './agent-profile-seed.service';

describe('AgentProfileSeedService', () => {
  it('persists file-seeded tool policy documents on agent profiles', async () => {
    const toolPolicy = {
      default: ToolPolicyEffect.DENY,
      rules: [
        {
          effect: ToolPolicyEffect.ALLOW,
          tool: 'invoke_agent_workflow',
          arguments: { workflow_id: { operator: 'absent' } },
        },
      ],
    };
    const repository = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => value),
      save: vi.fn().mockResolvedValue({}),
    };
    const service = new AgentProfileSeedService(
      repository as never,
      {
        loadDefinitions: vi.fn().mockReturnValue({
          definitions: [
            {
              name: 'ceo-agent',
              system_prompt: 'Lead orchestration.',
              tier_preference: 'heavy',
              allowed_tools: ['invoke_agent_workflow'],
              assigned_skills: [],
              tool_policy: toolPolicy,
              is_active: true,
            },
          ],
          seedRoot: 'seed/agents',
          usedLegacyAssignments: false,
        }),
      } as never,
      {
        resolveAssignedSkills: vi.fn().mockReturnValue([]),
        areSkillAssignmentsEqual: vi.fn().mockReturnValue(true),
      } as never,
    );

    await service.seed();

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ tool_policy: toolPolicy }),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ tool_policy: toolPolicy }),
    );
  });

  it('uses per-agent model_name and provider_name from seed definition instead of DB default', async () => {
    const repository = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => value),
      save: vi.fn().mockResolvedValue({}),
    };
    const service = new AgentProfileSeedService(
      repository as never,
      {
        loadDefinitions: vi.fn().mockReturnValue({
          definitions: [
            {
              name: 'agent-a',
              system_prompt: 'Prompt A',
              tier_preference: 'heavy',
              allowed_tools: ['read'],
              assigned_skills: [],
              model_name: 'override-model',
              provider_name: 'override-provider',
              is_active: true,
            },
          ],
          seedRoot: 'seed/agents',
          usedLegacyAssignments: false,
        }),
      } as never,
      {
        resolveAssignedSkills: vi.fn().mockReturnValue([]),
        areSkillAssignmentsEqual: vi.fn().mockReturnValue(true),
      } as never,
    );

    await service.seed();

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agent-a',
        model_name: 'override-model',
        provider_name: 'override-provider',
      }),
    );
  });

  it('leaves model_name and provider_name null when seed definition omits them', async () => {
    const repository = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => value),
      save: vi.fn().mockResolvedValue({}),
    };
    const service = new AgentProfileSeedService(
      repository as never,
      {
        loadDefinitions: vi.fn().mockReturnValue({
          definitions: [
            {
              name: 'agent-b',
              system_prompt: 'Prompt B',
              tier_preference: 'light',
              allowed_tools: ['write'],
              assigned_skills: [],
              is_active: true,
            },
          ],
          seedRoot: 'seed/agents',
          usedLegacyAssignments: false,
        }),
      } as never,
      {
        resolveAssignedSkills: vi.fn().mockReturnValue([]),
        areSkillAssignmentsEqual: vi.fn().mockReturnValue(true),
      } as never,
    );

    await service.seed();

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agent-b',
        model_name: null,
        provider_name: null,
      }),
    );
  });

  it('seeds provider_id and provider_source from file-based definition', async () => {
    const repository = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => value),
      save: vi.fn().mockResolvedValue({}),
    };
    const service = new AgentProfileSeedService(
      repository as never,
      {
        loadDefinitions: vi.fn().mockReturnValue({
          definitions: [
            {
              name: 'scoped-agent',
              system_prompt: 'Scoped prompt',
              tier_preference: 'heavy',
              allowed_tools: ['read'],
              assigned_skills: [],
              provider_name: 'openai',
              model_name: 'gpt-5.5',
              provider_id: '00000000-0000-4000-8000-000000000001',
              provider_source: 'user',
              is_active: true,
            },
          ],
          seedRoot: 'seed/agents',
          usedLegacyAssignments: false,
        }),
      } as never,
      {
        resolveAssignedSkills: vi.fn().mockReturnValue([]),
        areSkillAssignmentsEqual: vi.fn().mockReturnValue(true),
      } as never,
    );

    await service.seed();

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'scoped-agent',
        provider_name: 'openai',
        model_name: 'gpt-5.5',
        provider_id: '00000000-0000-4000-8000-000000000001',
        provider_source: 'user',
      }),
    );
  });

  it('preserves manually-administered provider_id and provider_source when seed file omits them', async () => {
    const existingProfile = {
      name: 'scoped-agent',
      system_prompt: 'Scoped prompt',
      tier_preference: 'heavy',
      allowed_tools: ['read'],
      denied_tools: undefined,
      approval_required_tools: undefined,
      allowed_mount_aliases: undefined,
      denied_mount_aliases: undefined,
      allow_rw_mount_aliases: undefined,
      model_name: 'gpt-5.5',
      provider_name: 'openai',
      provider_id: '00000000-0000-4000-8000-000000000001',
      provider_source: 'user',
      source: 'seeded',
      created_by_profile: null,
      created_by_workflow_run_id: null,
      factory_context: null,
      tool_policy: null,
      is_active: true,
      assigned_skills: [],
    };
    let mergedProfile: unknown;
    const repository = {
      findOne: vi.fn().mockResolvedValue(existingProfile),
      merge: vi.fn((profile, updates) => {
        mergedProfile = { ...profile, ...updates };
        return mergedProfile;
      }),
      save: vi.fn().mockResolvedValue({}),
    };
    const service = new AgentProfileSeedService(
      repository as never,
      {
        loadDefinitions: vi.fn().mockReturnValue({
          definitions: [
            {
              name: 'scoped-agent',
              system_prompt: 'Scoped prompt update',
              tier_preference: 'heavy',
              allowed_tools: ['read'],
              assigned_skills: [],
              provider_name: 'openai',
              model_name: 'gpt-5.5',
              is_active: true,
            },
          ],
          seedRoot: 'seed/agents',
          usedLegacyAssignments: false,
        }),
      } as never,
      {
        resolveAssignedSkills: vi.fn().mockReturnValue([]),
        areSkillAssignmentsEqual: vi.fn().mockReturnValue(true),
      } as never,
    );

    await service.seed();

    expect(repository.merge).toHaveBeenCalled();
    expect(mergedProfile).toHaveProperty(
      'provider_id',
      '00000000-0000-4000-8000-000000000001',
    );
    expect(mergedProfile).toHaveProperty('provider_source', 'user');
    expect(mergedProfile).toHaveProperty(
      'system_prompt',
      'Scoped prompt update',
    );
  });

  it('clears a previously seeded tool policy when the file omits it', async () => {
    const existingToolPolicy = {
      default: ToolPolicyEffect.DENY,
      rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'read' }],
    };
    const existingProfile = {
      name: 'ceo-agent',
      system_prompt: 'Lead orchestration.',
      tier_preference: 'heavy',
      allowed_tools: ['invoke_agent_workflow'],
      denied_tools: undefined,
      approval_required_tools: undefined,
      allowed_mount_aliases: undefined,
      denied_mount_aliases: undefined,
      allow_rw_mount_aliases: undefined,
      model_name: 'claude-sonnet-4.5',
      provider_name: 'anthropic',
      source: 'seeded',
      created_by_profile: null,
      created_by_workflow_run_id: null,
      factory_context: null,
      tool_policy: existingToolPolicy,
      is_active: true,
      assigned_skills: [],
    };
    const repository = {
      findOne: vi.fn().mockResolvedValue(existingProfile),
      merge: vi.fn((profile, updates) => ({ ...profile, ...updates })),
      save: vi.fn().mockResolvedValue({}),
    };
    const service = new AgentProfileSeedService(
      repository as never,
      {
        loadDefinitions: vi.fn().mockReturnValue({
          definitions: [
            {
              name: 'ceo-agent',
              system_prompt: 'Lead orchestration.',
              tier_preference: 'heavy',
              allowed_tools: ['invoke_agent_workflow'],
              assigned_skills: [],
              is_active: true,
            },
          ],
          seedRoot: 'seed/agents',
          usedLegacyAssignments: false,
        }),
      } as never,
      {
        resolveAssignedSkills: vi.fn().mockReturnValue([]),
        areSkillAssignmentsEqual: vi.fn().mockReturnValue(true),
      } as never,
    );

    await service.seed();

    expect(repository.merge).toHaveBeenCalledWith(
      existingProfile,
      expect.objectContaining({ tool_policy: null }),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ tool_policy: null }),
    );
  });
});
