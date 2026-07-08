import { describe, expect, it, vi } from 'vitest';
import { AgentProfileSeedService } from './agent-profile-seed.service';

const BASE_DEFINITION = {
  name: 'test-agent',
  system_prompt: 'You are a test agent.',
  tier_preference: 'heavy',
  assigned_skills: [],
  is_active: true,
};

function buildService(
  repositoryOverrides: Record<string, unknown>,
  cacheArg?: { invalidate: ReturnType<typeof vi.fn> },
): AgentProfileSeedService {
  return new AgentProfileSeedService(
    {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value: unknown) => value),
      save: vi.fn().mockResolvedValue({}),
      merge: vi.fn((existing: unknown, updates: unknown) => ({
        ...(existing as object),
        ...(updates as object),
      })),
      ...repositoryOverrides,
    } as never,
    {
      loadDefinitions: vi.fn().mockReturnValue({
        definitions: [BASE_DEFINITION],
        seedRoot: 'seed/agents',
        usedLegacyAssignments: false,
      }),
    } as never,
    {
      resolveAssignedSkills: vi.fn().mockReturnValue([]),
      areSkillAssignmentsEqual: vi.fn().mockReturnValue(false),
    } as never,
    cacheArg as never,
  );
}

describe('AgentProfileSeedService — override-safe re-seeding (EPIC-204F T7)', () => {
  describe('seeding a new record (none exists)', () => {
    it('inserts successfully when no existing row is found', async () => {
      const create = vi.fn((value: unknown) => value);
      const save = vi.fn().mockResolvedValue({});

      const service = buildService({
        findOne: vi.fn().mockResolvedValue(null),
        create,
        save,
      });

      await service.seed();

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-agent', source: 'seeded' }),
      );
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  describe('seeding with existing unlocked/uncustomised record', () => {
    it('updates successfully when existing row has locked=false and overrides=null', async () => {
      const existingProfile = {
        name: 'test-agent',
        system_prompt: 'Old prompt',
        tier_preference: 'heavy',
        model_name: 'default-model',
        provider_name: 'default-provider',
        source: 'seeded',
        scope_node_id: null,
        locked: false,
        overrides: null,
        is_active: true,
        assigned_skills: [],
        created_by_profile: null,
        created_by_workflow_run_id: null,
        factory_context: null,
        tool_policy: null,
        allowed_mount_aliases: null,
        denied_mount_aliases: null,
        allow_rw_mount_aliases: null,
        supports_vision: false,
      };

      const save = vi.fn().mockResolvedValue({});
      const merge = vi.fn((existing: unknown, updates: unknown) => ({
        ...(existing as object),
        ...(updates as object),
      }));

      const service = buildService({
        findOne: vi.fn().mockResolvedValue(existingProfile),
        save,
        merge,
      });

      await service.seed();

      expect(merge).toHaveBeenCalled();
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ system_prompt: 'You are a test agent.' }),
      );
    });
  });

  describe('locked guard', () => {
    it('skips update when existing row has locked = true', async () => {
      const lockedProfile = {
        name: 'test-agent',
        system_prompt: 'Old prompt',
        tier_preference: 'heavy',
        model_name: 'default-model',
        provider_name: 'default-provider',
        source: 'seeded',
        scope_node_id: null,
        locked: true,
        overrides: null,
        is_active: true,
        assigned_skills: [],
        created_by_profile: null,
        created_by_workflow_run_id: null,
        factory_context: null,
        tool_policy: null,
        allowed_mount_aliases: null,
        denied_mount_aliases: null,
        allow_rw_mount_aliases: null,
        supports_vision: false,
      };

      const save = vi.fn().mockResolvedValue({});
      const merge = vi.fn();

      const service = buildService({
        findOne: vi.fn().mockResolvedValue(lockedProfile),
        save,
        merge,
      });

      await service.seed();

      expect(merge).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('overrides guard', () => {
    it('skips update when existing row has overrides != null', async () => {
      const customisedProfile = {
        name: 'test-agent',
        system_prompt: 'Old prompt',
        tier_preference: 'heavy',
        model_name: 'default-model',
        provider_name: 'default-provider',
        source: 'seeded',
        scope_node_id: null,
        locked: false,
        overrides: { custom_field: 'user-value' },
        is_active: true,
        assigned_skills: [],
        created_by_profile: null,
        created_by_workflow_run_id: null,
        factory_context: null,
        tool_policy: null,
        allowed_mount_aliases: null,
        denied_mount_aliases: null,
        allow_rw_mount_aliases: null,
        supports_vision: false,
      };

      const save = vi.fn().mockResolvedValue({});
      const merge = vi.fn();

      const service = buildService({
        findOne: vi.fn().mockResolvedValue(customisedProfile),
        save,
        merge,
      });

      await service.seed();

      expect(merge).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('cache invalidation', () => {
    it('calls ConfigResolutionCache.invalidate after inserting a new profile', async () => {
      const invalidate = vi.fn();
      const cache = { invalidate };

      const service = buildService(
        {
          findOne: vi.fn().mockResolvedValue(null),
          create: vi.fn((v: unknown) => v),
          save: vi.fn().mockResolvedValue({}),
        },
        cache,
      );

      await service.seed();

      expect(invalidate).toHaveBeenCalledWith('agent_profile', 'test-agent');
    });

    it('calls ConfigResolutionCache.invalidate after updating an existing profile', async () => {
      const existingProfile = {
        name: 'test-agent',
        system_prompt: 'Old prompt',
        tier_preference: 'heavy',
        model_name: 'default-model',
        provider_name: 'default-provider',
        source: 'seeded',
        scope_node_id: null,
        locked: false,
        overrides: null,
        is_active: true,
        assigned_skills: [],
        created_by_profile: null,
        created_by_workflow_run_id: null,
        factory_context: null,
        tool_policy: null,
        allowed_mount_aliases: null,
        denied_mount_aliases: null,
        allow_rw_mount_aliases: null,
        supports_vision: false,
      };

      const invalidate = vi.fn();
      const cache = { invalidate };

      const service = buildService(
        {
          findOne: vi.fn().mockResolvedValue(existingProfile),
          save: vi.fn().mockResolvedValue({}),
          merge: vi.fn((existing: unknown, updates: unknown) => ({
            ...(existing as object),
            ...(updates as object),
          })),
        },
        cache,
      );

      await service.seed();

      expect(invalidate).toHaveBeenCalledWith('agent_profile', 'test-agent');
    });

    it('does NOT call ConfigResolutionCache.invalidate when skipped due to locked', async () => {
      const lockedProfile = {
        name: 'test-agent',
        system_prompt: 'Old prompt',
        tier_preference: 'heavy',
        model_name: 'default-model',
        provider_name: 'default-provider',
        source: 'seeded',
        scope_node_id: null,
        locked: true,
        overrides: null,
        is_active: true,
        assigned_skills: [],
        created_by_profile: null,
        created_by_workflow_run_id: null,
        factory_context: null,
        tool_policy: null,
        allowed_mount_aliases: null,
        denied_mount_aliases: null,
        allow_rw_mount_aliases: null,
        supports_vision: false,
      };

      const invalidate = vi.fn();
      const cache = { invalidate };

      const service = buildService(
        { findOne: vi.fn().mockResolvedValue(lockedProfile) },
        cache,
      );

      await service.seed();

      expect(invalidate).not.toHaveBeenCalled();
    });

    it('does NOT call ConfigResolutionCache.invalidate when skipped due to overrides', async () => {
      const customisedProfile = {
        name: 'test-agent',
        system_prompt: 'Old prompt',
        tier_preference: 'heavy',
        model_name: 'default-model',
        provider_name: 'default-provider',
        source: 'seeded',
        scope_node_id: null,
        locked: false,
        overrides: { admin_custom: true },
        is_active: true,
        assigned_skills: [],
        created_by_profile: null,
        created_by_workflow_run_id: null,
        factory_context: null,
        tool_policy: null,
        allowed_mount_aliases: null,
        denied_mount_aliases: null,
        allow_rw_mount_aliases: null,
        supports_vision: false,
      };

      const invalidate = vi.fn();
      const cache = { invalidate };

      const service = buildService(
        { findOne: vi.fn().mockResolvedValue(customisedProfile) },
        cache,
      );

      await service.seed();

      expect(invalidate).not.toHaveBeenCalled();
    });
  });
});

describe('improvement-proposal overrides marker (Epic D)', () => {
  it('skips reseed for a profile pinned by an applied improvement proposal', async () => {
    const pinnedProfile = {
      name: 'test-agent',
      system_prompt: 'Prompt changed by proposal',
      tier_preference: 'heavy',
      source: 'seeded',
      scope_node_id: null,
      locked: false,
      overrides: {
        improvement_proposal: {
          proposal_id: 'proposal-uuid-1',
          applied_at: '2026-07-02T00:00:00.000Z',
        },
      },
      is_active: true,
      assigned_skills: [],
    };
    const save = vi.fn();
    const merge = vi.fn();
    const service = buildService({
      findOne: vi.fn().mockResolvedValue(pinnedProfile),
      save,
      merge,
    });
    await service.seed();
    expect(merge).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
