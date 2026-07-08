import { describe, expect, it, vi } from 'vitest';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import type { WorkflowSkillBinding } from '../workflow-skill-bindings/workflow-skill-binding.entity';
import { resolveAgentAssignedSkills } from './agent-assigned-skills.helpers';

function buildSkill(
  overrides: Partial<SkillLibraryRecord>,
): SkillLibraryRecord {
  return {
    id: overrides.name ?? 'skill',
    name: 'skill',
    description: 'a skill',
    skillMarkdown: '# skill',
    compatibility: null,
    category: null,
    tags: [],
    metadata: null,
    scope: null,
    isActive: true,
    version: 1,
    source: 'admin',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    rootPath: '/skills/skill',
    ...overrides,
  };
}

function buildBinding(
  overrides: Partial<WorkflowSkillBinding>,
): WorkflowSkillBinding {
  return {
    id: 'binding-id',
    workflow_name: 'wf',
    step_id: null,
    skill_name: 'binding-skill',
    provenance: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('resolveAgentAssignedSkills', () => {
  it('orders step bindings before workflow bindings before profile skills', async () => {
    const listForWorkflow = vi
      .fn()
      .mockResolvedValue([
        buildBinding({ step_id: null, skill_name: 'wf-bound' }),
        buildBinding({ step_id: 'implement', skill_name: 'step-bound' }),
        buildBinding({ step_id: 'other-step', skill_name: 'other-step-bound' }),
      ]);
    const listSkills = vi
      .fn()
      .mockReturnValue([
        buildSkill({ name: 'wf-bound' }),
        buildSkill({ name: 'step-bound' }),
        buildSkill({ name: 'other-step-bound' }),
      ]);
    const profileSkills = [buildSkill({ name: 'profile-skill' })];

    const result = await resolveAgentAssignedSkills({
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills },
      profileSkills,
      workflowName: 'wf',
      stepId: 'implement',
    });

    expect(listForWorkflow).toHaveBeenCalledWith('wf');
    expect(result.map((skill) => skill.name)).toEqual([
      'step-bound',
      'wf-bound',
      'profile-skill',
    ]);
    // A binding scoped to a different step must not leak in.
    expect(result.map((skill) => skill.name)).not.toContain('other-step-bound');
  });

  it('skips the binding lookup entirely when no workflowName is given', async () => {
    const listForWorkflow = vi.fn();
    const profileSkills = [buildSkill({ name: 'profile-skill' })];

    const result = await resolveAgentAssignedSkills({
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills: vi.fn().mockReturnValue([]) },
      profileSkills,
    });

    expect(listForWorkflow).not.toHaveBeenCalled();
    expect(result.map((skill) => skill.name)).toEqual(['profile-skill']);
  });

  it('hydrates binding-only skill names from the catalog, not just profile skills', async () => {
    const listForWorkflow = vi
      .fn()
      .mockResolvedValue([
        buildBinding({ step_id: null, skill_name: 'catalog-only' }),
      ]);
    const listSkills = vi
      .fn()
      .mockReturnValue([buildSkill({ name: 'catalog-only' })]);

    const result = await resolveAgentAssignedSkills({
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills },
      profileSkills: [],
      workflowName: 'wf',
    });

    expect(result).toEqual([buildSkill({ name: 'catalog-only' })]);
  });

  it('does not scan the skill catalog when there are no bindings and every effective skill is already covered by profile records', async () => {
    const listForWorkflow = vi.fn().mockResolvedValue([]);
    const listSkills = vi.fn().mockReturnValue([]);
    const profileSkills = [buildSkill({ name: 'profile-skill' })];

    const result = await resolveAgentAssignedSkills({
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills },
      profileSkills,
      workflowName: 'wf',
      workflowYamlSkills: ['profile-skill'],
    });

    expect(listSkills).not.toHaveBeenCalled();
    expect(result).toEqual([buildSkill({ name: 'profile-skill' })]);
  });

  it('scans the skill catalog when a binding is present, even if bindings only echo profile names', async () => {
    const listForWorkflow = vi
      .fn()
      .mockResolvedValue([
        buildBinding({ step_id: null, skill_name: 'new-binding-skill' }),
      ]);
    const listSkills = vi
      .fn()
      .mockReturnValue([buildSkill({ name: 'new-binding-skill' })]);
    const profileSkills = [buildSkill({ name: 'profile-skill' })];

    const result = await resolveAgentAssignedSkills({
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills },
      profileSkills,
      workflowName: 'wf',
    });

    expect(listSkills).toHaveBeenCalled();
    expect(result.map((skill) => skill.name)).toEqual([
      'new-binding-skill',
      'profile-skill',
    ]);
  });

  it('drops effective names that resolve to no known skill record', async () => {
    const listForWorkflow = vi
      .fn()
      .mockResolvedValue([
        buildBinding({ step_id: null, skill_name: 'ghost-skill' }),
      ]);

    const result = await resolveAgentAssignedSkills({
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills: vi.fn().mockReturnValue([]) },
      profileSkills: [],
      workflowName: 'wf',
    });

    expect(result).toEqual([]);
  });
});
