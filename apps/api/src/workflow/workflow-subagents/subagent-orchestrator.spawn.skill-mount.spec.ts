import { describe, it, expect, vi } from 'vitest';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import type { WorkflowSkillBinding } from '../workflow-skill-bindings/workflow-skill-binding.entity';
import type { SubagentSpawnOperationsContext } from './subagent-orchestrator.operations.types';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import type { WorkflowRun } from '../database/entities/workflow-run.entity';
import type { SubagentSpawnParams } from './subagent-orchestrator.types';
import { prepareSkillMountContext } from './subagent-orchestrator.spawn.skill-mount';

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

// FU-7 (paired with FU-5): confirms the subagent mount path already threads
// the full profile ∪ workflow ∪ step effective skill set to disk — a step
// binding absent from the agent's profile must still reach the mount call.
describe('prepareSkillMountContext — subagent mount (FU-7 parity with the step path)', () => {
  it('mounts a step-bound (non-profile) skill resolved via resolveSubagentProfileAndAssignedSkills', async () => {
    const profileSkill = buildSkill('profile-skill');
    const boundSkill = buildSkill('step-bound-skill');

    const stageSkillPolicy = {
      resolveAssignedSkills: vi
        .fn()
        .mockResolvedValue({ skills: [profileSkill] }),
    };
    // yaml_definition absent => resolveWorkflowYamlSkillsById/
    // resolveStepYamlSkillsById short-circuit to [] without parsing YAML —
    // this test exercises the *binding* source, not YAML-declared skills.
    const workflowRepo = {
      findById: vi.fn().mockResolvedValue({ name: 'implement-workflow' }),
    };
    const workflowSkillBindings = {
      listForWorkflow: vi
        .fn()
        .mockResolvedValue([buildBinding('implement', 'step-bound-skill')]),
    };
    const skillCatalog = {
      listSkills: vi.fn().mockReturnValue([boundSkill]),
    };
    const prepareSkillMount = vi.fn().mockReturnValue('/mount/path');
    const skillMounting = { prepareSkillMount };
    const logger = { log: vi.fn(), warn: vi.fn() };

    const context = {
      stageSkillPolicy,
      workflowRepo,
      workflowSkillBindings,
      skillCatalog,
      skillMounting,
      logger,
    } as unknown as SubagentSpawnOperationsContext;

    const execution = { id: 'exec-1' } as SubagentExecutionView;
    const params: SubagentSpawnParams = {
      workflowRunId: 'run-1',
      agent_profile: 'software-architect',
      lifecycle_stage: 'implement',
      parent_step_id: 'implement',
    } as unknown as SubagentSpawnParams;
    const run = {
      workflow_id: 'workflow-def-1',
      state_variables: {},
    } as unknown as WorkflowRun;

    const result = await prepareSkillMountContext(
      context,
      { execution, params },
      run,
    );

    expect(workflowSkillBindings.listForWorkflow).toHaveBeenCalledWith(
      'implement-workflow',
    );
    expect(prepareSkillMount).toHaveBeenCalledWith(
      'subagent-exec-1',
      expect.arrayContaining([
        expect.objectContaining({ name: 'step-bound-skill' }),
      ]),
    );
    expect(result.assignedSkills.map((skill) => skill.name)).toContain(
      'step-bound-skill',
    );
  });
});
