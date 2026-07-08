import { describe, expect, it, vi } from 'vitest';
import { AgentProfileSeedService } from './agent-profile-seed.service';

/**
 * Regression coverage for issue gs65: orchestration profiles (e.g. ceo-agent,
 * qa_automation) must seed with NULL model_name/provider_name so they inherit
 * the scoped/DB default instead of having the execution-default baked in.
 *
 * Profiles only carry an explicit model/provider when the agent.json declares
 * one. Both an explicit `null` and an omitted field stay null so the profile
 * inherits the scoped/DB default at runtime — the seeder never backfills a
 * boot-time default into the row.
 */
function buildService(
  definition: Record<string, unknown>,
  repositoryOverrides: Record<string, unknown> = {},
): { service: AgentProfileSeedService; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn((value: unknown) => value);

  const service = new AgentProfileSeedService(
    {
      findOne: vi.fn().mockResolvedValue(null),
      create,
      save: vi.fn().mockResolvedValue({}),
      merge: vi.fn((existing: unknown, updates: unknown) => ({
        ...(existing as object),
        ...(updates as object),
      })),
      ...repositoryOverrides,
    } as never,
    {
      loadDefinitions: vi.fn().mockReturnValue({
        definitions: [definition],
        seedRoot: 'seed/agents',
        usedLegacyAssignments: false,
      }),
    } as never,
    {
      resolveAssignedSkills: vi.fn().mockReturnValue([]),
      areSkillAssignmentsEqual: vi.fn().mockReturnValue(false),
    } as never,
    undefined,
  );

  return { service, create };
}

describe('AgentProfileSeedService — inherit AI defaults (issue gs65)', () => {
  it('seeds model_name/provider_name as null when the definition sets them to null', async () => {
    const { service, create } = buildService({
      name: 'ceo-agent',
      system_prompt: 'You are the CEO agent.',
      tier_preference: 'heavy',
      model_name: null,
      provider_name: null,
      assigned_skills: [],
      is_active: true,
    });

    await service.seed();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ceo-agent',
        model_name: null,
        provider_name: null,
      }),
    );
  });

  it('leaves model_name/provider_name null when the definition omits them', async () => {
    const { service, create } = buildService({
      name: 'junior_dev',
      system_prompt: 'You are a junior dev.',
      tier_preference: 'heavy',
      assigned_skills: [],
      is_active: true,
    });

    await service.seed();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'junior_dev',
        model_name: null,
        provider_name: null,
      }),
    );
  });

  it('durably resets a previously baked-in model/provider back to null on re-seed', async () => {
    const existingProfile = {
      name: 'ceo-agent',
      system_prompt: 'You are the CEO agent.',
      tier_preference: 'heavy',
      model_name: 'claude-opus-4-8',
      provider_name: 'Anthropic (Claude Pro/Max)',
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
    const { service } = buildService(
      {
        name: 'ceo-agent',
        system_prompt: 'You are the CEO agent.',
        tier_preference: 'heavy',
        model_name: null,
        provider_name: null,
        assigned_skills: [],
        is_active: true,
      },
      {
        findOne: vi.fn().mockResolvedValue(existingProfile),
        save,
        merge: vi.fn((existing: unknown, updates: unknown) => ({
          ...(existing as object),
          ...(updates as object),
        })),
      },
    );

    await service.seed();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ model_name: null, provider_name: null }),
    );
  });
});
