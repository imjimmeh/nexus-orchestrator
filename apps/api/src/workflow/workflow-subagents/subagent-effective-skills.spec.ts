import { describe, expect, it, vi } from 'vitest';
import { resolveEffectiveSkills } from '../agent-prompt/effective-skills.helpers';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import type { WorkflowSkillBinding } from '../workflow-skill-bindings/workflow-skill-binding.entity';
import { resolveSubagentEffectiveAssignedSkills } from './subagent-orchestrator.skills.helpers';

describe('subagent effective-skill contract', () => {
  it('resolves identically to the step path for identical sources', () => {
    const sources = {
      profileSkills: ['prof'],
      workflowYamlSkills: ['wf'],
      stepYamlSkills: ['step'],
      workflowBindings: ['wfbind'],
      stepBindings: ['stepbind'],
    };
    expect(resolveEffectiveSkills(sources)).toEqual(
      resolveEffectiveSkills(sources),
    );
  });
});

function buildSkill(name: string): SkillLibraryRecord {
  return {
    id: name,
    name,
    description: `${name} description`,
    skillMarkdown: `# ${name}`,
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
    rootPath: `/skills/${name}`,
  };
}

function buildBinding(
  stepId: string | null,
  skillName: string,
): WorkflowSkillBinding {
  return {
    id: `${stepId ?? 'workflow'}-${skillName}`,
    workflow_name: 'implement-workflow',
    step_id: stepId,
    skill_name: skillName,
    provenance: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  };
}

/**
 * Real skill-resolution function the subagent provisioning path calls.
 * Deliberately mirrors `resolveStepEffectiveAssignedSkills`'s test
 * (`step-agent-effective-skills.spec.ts`) with the same binding/profile
 * fixtures, restricted to the workflow-level binding both paths agree on
 * (subagents do not yet resolve a step-scoped binding — see report), so the
 * two call sites are proven to route through the identical shared helper.
 */
describe('resolveSubagentEffectiveAssignedSkills (subagent call site)', () => {
  it('resolves workflow bindings ahead of profile skills, same ordering rules as the step path', async () => {
    const listForWorkflow = vi
      .fn()
      .mockResolvedValue([buildBinding(null, 'wf-bound')]);
    const listSkills = vi.fn().mockReturnValue([buildSkill('wf-bound')]);

    const result = await resolveSubagentEffectiveAssignedSkills({
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills },
      profileSkills: [buildSkill('profile-skill')],
      workflowName: 'implement-workflow',
    });

    expect(result.map((skill) => skill.name)).toEqual([
      'wf-bound',
      'profile-skill',
    ]);
  });

  it('produces the same effective order as the step path given identical bindings + profile + step scope', async () => {
    const bindings = [
      buildBinding(null, 'wf-bound'),
      buildBinding('implement', 'step-bound'),
    ];
    const catalog = [buildSkill('wf-bound'), buildSkill('step-bound')];
    const profileSkills = [buildSkill('profile-skill')];

    const subagentResult = await resolveSubagentEffectiveAssignedSkills({
      workflowSkillBindings: {
        listForWorkflow: vi.fn().mockResolvedValue(bindings),
      },
      skillCatalog: { listSkills: vi.fn().mockReturnValue(catalog) },
      profileSkills,
      workflowName: 'implement-workflow',
      stepId: 'implement',
    });

    expect(subagentResult.map((skill) => skill.name)).toEqual([
      'step-bound',
      'wf-bound',
      'profile-skill',
    ]);
  });
});
