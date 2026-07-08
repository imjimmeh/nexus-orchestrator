import { describe, expect, it, vi } from 'vitest';
import {
  resolveSubagentAssignedSkills,
  resolveSubagentProfileAndAssignedSkills,
} from './subagent-orchestrator.skills.helpers';
import type { WorkflowStageSkillPolicyService } from '../workflow-stage-skill-policy.service';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';

function buildSkillRecord(
  name: string,
  overrides: Partial<SkillLibraryRecord> = {},
): SkillLibraryRecord {
  return {
    id: `skill-${name}`,
    name,
    description: `Description for ${name}`,
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
    ...overrides,
  };
}

function buildStageSkillPolicy(
  skillsByWorkflowId: Map<string | undefined, SkillLibraryRecord[]>,
): Pick<WorkflowStageSkillPolicyService, 'resolveAssignedSkills'> {
  return {
    resolveAssignedSkills: vi
      .fn()
      .mockImplementation(
        (params: { workflowId?: string; agentProfile?: string }) => {
          const skills = skillsByWorkflowId.get(params.workflowId) ?? [];
          return Promise.resolve({ skills });
        },
      ),
  };
}

describe('resolveSubagentAssignedSkills', () => {
  describe('workflowId threading', () => {
    it('includes workflow-scoped skill when workflowId matches the skill scope', async () => {
      const workflowScopedSkill = buildSkillRecord('create-skill-guide', {
        scope: {
          projects: [],
          agents: [],
          workflows: ['create_skill'],
        },
      });
      const skillMap = new Map<string | undefined, SkillLibraryRecord[]>([
        ['create_skill', [workflowScopedSkill]],
        [undefined, []],
      ]);
      const stageSkillPolicy = buildStageSkillPolicy(skillMap);

      const result = await resolveSubagentAssignedSkills({
        stageSkillPolicy,
        agentProfile: 'test-profile',
        lifecycleStage: null,
        workflowId: 'create_skill',
      });

      expect(result).toContain(workflowScopedSkill);
      expect(stageSkillPolicy.resolveAssignedSkills).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'create_skill' }),
      );
    });

    it('excludes workflow-scoped skill when workflowId does not match the skill scope', async () => {
      const workflowScopedSkill = buildSkillRecord('create-skill-guide', {
        scope: {
          projects: [],
          agents: [],
          workflows: ['create_skill'],
        },
      });
      const skillMap = new Map<string | undefined, SkillLibraryRecord[]>([
        ['create_skill', [workflowScopedSkill]],
        [undefined, []],
      ]);
      const stageSkillPolicy = buildStageSkillPolicy(skillMap);

      const result = await resolveSubagentAssignedSkills({
        stageSkillPolicy,
        agentProfile: 'test-profile',
        lifecycleStage: null,
        workflowId: 'other_workflow',
      });

      expect(result).not.toContain(workflowScopedSkill);
      expect(result).toHaveLength(0);
      expect(stageSkillPolicy.resolveAssignedSkills).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'other_workflow' }),
      );
    });

    it('degrades to profile/scope-only behavior when workflowId is undefined', async () => {
      const profileSkill = buildSkillRecord('profile-skill');
      const workflowScopedSkill = buildSkillRecord('workflow-only-skill');
      const skillMap = new Map<string | undefined, SkillLibraryRecord[]>([
        [undefined, [profileSkill]],
        ['create_skill', [workflowScopedSkill]],
      ]);
      const stageSkillPolicy = buildStageSkillPolicy(skillMap);

      const result = await resolveSubagentAssignedSkills({
        stageSkillPolicy,
        agentProfile: 'test-profile',
        lifecycleStage: null,
        workflowId: undefined,
      });

      expect(result).toContain(profileSkill);
      expect(result).not.toContain(workflowScopedSkill);
      expect(stageSkillPolicy.resolveAssignedSkills).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: undefined }),
      );
    });
  });

  describe('scopeId threading', () => {
    it('forwards scopeId to stageSkillPolicy.resolveAssignedSkills', async () => {
      const stageSkillPolicy = buildStageSkillPolicy(
        new Map([[undefined, []]]),
      );

      await resolveSubagentAssignedSkills({
        stageSkillPolicy,
        agentProfile: 'test-profile',
        lifecycleStage: null,
        scopeId: 'scope-123',
      });

      expect(stageSkillPolicy.resolveAssignedSkills).toHaveBeenCalledWith(
        expect.objectContaining({ scopeId: 'scope-123' }),
      );
    });
  });
});

// Task 5 GATE: proves the subagent-provisioning call site parses a
// workflow's YAML-declared `skills:` block (off the persisted
// `yaml_definition`) and unions it into the resolved effective skill set —
// not a hardcoded `[]` placeholder (see the Task 4 report follow-up this
// closes for the workflow-level source).
describe('resolveSubagentProfileAndAssignedSkills (workflow YAML skills)', () => {
  it('unions a workflow-level YAML skill into the resolved effective skills', async () => {
    const stageSkillPolicy = buildStageSkillPolicy(new Map([[undefined, []]]));
    const workflowRepo = {
      findById: vi.fn().mockResolvedValue({
        name: 'implement-workflow',
        yaml_definition: `
workflow_id: implement_workflow
name: implement-workflow
skills: [workflow-yaml-skill]
steps:
  - id: implement
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
`,
      }),
    };
    const listSkills = vi
      .fn()
      .mockReturnValue([buildSkillRecord('workflow-yaml-skill')]);

    const result = await resolveSubagentProfileAndAssignedSkills({
      stageSkillPolicy,
      workflowRepo,
      workflowSkillBindings: { listForWorkflow: vi.fn().mockResolvedValue([]) },
      skillCatalog: { listSkills },
      agentProfile: 'test-profile',
      lifecycleStage: null,
      workflowId: 'implement_workflow',
      onWorkflowNameError: vi.fn(),
    });

    expect(result.map((skill) => skill.name)).toContain('workflow-yaml-skill');
  });
});

// FU-5 GATE: proves the subagent-provisioning call site now threads the
// spawning step's YAML id (`stepId`) all the way through to
// `resolveAgentAssignedSkills`, closing the "known residual gap" the Task 4/5
// reports flagged — a step-scoped `workflow_skill_bindings` row and a
// step-level YAML `inputs.skills` entry must both reach the subagent's
// resolved skill set, not just workflow-level sources.
describe('resolveSubagentProfileAndAssignedSkills (step-scoped skills, FU-5)', () => {
  it('includes a step-scoped binding ahead of a workflow-scoped binding when stepId is supplied', async () => {
    const stageSkillPolicy = buildStageSkillPolicy(new Map([[undefined, []]]));
    const workflowRepo = {
      findById: vi.fn().mockResolvedValue({
        name: 'implement-workflow',
        yaml_definition: `
workflow_id: implement_workflow
name: implement-workflow
steps:
  - id: implement
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
`,
      }),
    };
    const listForWorkflow = vi.fn().mockResolvedValue([
      {
        id: 'wf-binding',
        workflow_name: 'implement-workflow',
        step_id: null,
        skill_name: 'wf-bound',
        provenance: null,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      },
      {
        id: 'step-binding',
        workflow_name: 'implement-workflow',
        step_id: 'implement',
        skill_name: 'step-bound',
        provenance: null,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      },
    ]);
    const listSkills = vi
      .fn()
      .mockReturnValue([
        buildSkillRecord('wf-bound'),
        buildSkillRecord('step-bound'),
      ]);

    const result = await resolveSubagentProfileAndAssignedSkills({
      stageSkillPolicy,
      workflowRepo,
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills },
      agentProfile: 'test-profile',
      lifecycleStage: null,
      workflowId: 'implement_workflow',
      stepId: 'implement',
      onWorkflowNameError: vi.fn(),
    });

    expect(result.map((skill) => skill.name)).toEqual([
      'step-bound',
      'wf-bound',
    ]);
  });

  it('unions a step-level YAML skill (inputs.skills on the matching job) into the resolved effective skills', async () => {
    const stageSkillPolicy = buildStageSkillPolicy(new Map([[undefined, []]]));
    const workflowRepo = {
      findById: vi.fn().mockResolvedValue({
        name: 'implement-workflow',
        yaml_definition: `
workflow_id: implement_workflow
name: implement-workflow
steps:
  - id: implement
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
      skills: [step-yaml-skill]
`,
      }),
    };
    const listSkills = vi
      .fn()
      .mockReturnValue([buildSkillRecord('step-yaml-skill')]);

    const result = await resolveSubagentProfileAndAssignedSkills({
      stageSkillPolicy,
      workflowRepo,
      workflowSkillBindings: { listForWorkflow: vi.fn().mockResolvedValue([]) },
      skillCatalog: { listSkills },
      agentProfile: 'test-profile',
      lifecycleStage: null,
      workflowId: 'implement_workflow',
      stepId: 'implement',
      onWorkflowNameError: vi.fn(),
    });

    expect(result.map((skill) => skill.name)).toContain('step-yaml-skill');
  });

  it('omits the step-scoped binding when stepId is not supplied (existing workflow-level behavior unchanged)', async () => {
    const stageSkillPolicy = buildStageSkillPolicy(new Map([[undefined, []]]));
    const workflowRepo = {
      findById: vi.fn().mockResolvedValue({
        name: 'implement-workflow',
        yaml_definition: `
workflow_id: implement_workflow
name: implement-workflow
steps:
  - id: implement
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
`,
      }),
    };
    const listForWorkflow = vi.fn().mockResolvedValue([
      {
        id: 'wf-binding',
        workflow_name: 'implement-workflow',
        step_id: null,
        skill_name: 'wf-bound',
        provenance: null,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      },
      {
        id: 'step-binding',
        workflow_name: 'implement-workflow',
        step_id: 'implement',
        skill_name: 'step-bound',
        provenance: null,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      },
    ]);
    const listSkills = vi
      .fn()
      .mockReturnValue([
        buildSkillRecord('wf-bound'),
        buildSkillRecord('step-bound'),
      ]);

    const result = await resolveSubagentProfileAndAssignedSkills({
      stageSkillPolicy,
      workflowRepo,
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills },
      agentProfile: 'test-profile',
      lifecycleStage: null,
      workflowId: 'implement_workflow',
      onWorkflowNameError: vi.fn(),
    });

    expect(result.map((skill) => skill.name)).toEqual(['wf-bound']);
  });
});
