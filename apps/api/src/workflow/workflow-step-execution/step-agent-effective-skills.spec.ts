import { describe, expect, it, vi } from 'vitest';
import { resolveEffectiveSkills } from '../agent-prompt/effective-skills.helpers';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import type { WorkflowSkillBinding } from '../workflow-skill-bindings/workflow-skill-binding.entity';
import {
  provisionContainerForJobCore,
  resolveStepEffectiveAssignedSkills,
  resolveStepProfileAndAssignedSkills,
} from './step-agent-effective-skills.helpers';

// Characterization: the step executor MUST derive its injected skills via
// resolveEffectiveSkills. This test pins the contract the executor consumes;
// when wiring the executor, assert it produces this exact order for these inputs.
describe('step executor effective-skill contract', () => {
  it('produces step-first ordering from mixed sources', () => {
    const result = resolveEffectiveSkills({
      profileSkills: ['prof'],
      workflowYamlSkills: ['wf'],
      stepYamlSkills: ['step'],
      workflowBindings: ['wfbind'],
      stepBindings: ['stepbind'],
    }).map((s) => s.name);
    expect(result.slice(0, 2).sort()).toEqual(['step', 'stepbind']);
    expect(result[result.length - 1]).toBe('prof');
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

// Real skill-resolution function the step executor calls. Proves the
// executor is routed through the shared helper (not a local re-merge) by
// injecting a fake WorkflowSkillBindingService + profile skills and
// asserting on the resulting order/hydration.
describe('resolveStepEffectiveAssignedSkills (executor call site)', () => {
  it('resolves step bindings ahead of workflow bindings ahead of profile skills', async () => {
    const listForWorkflow = vi
      .fn()
      .mockResolvedValue([
        buildBinding(null, 'wf-bound'),
        buildBinding('implement', 'step-bound'),
      ]);
    const listSkills = vi
      .fn()
      .mockReturnValue([buildSkill('wf-bound'), buildSkill('step-bound')]);

    const result = await resolveStepEffectiveAssignedSkills({
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills },
      profileSkills: [buildSkill('profile-skill')],
      workflowName: 'implement-workflow',
      stepId: 'implement',
    });

    expect(result.map((skill) => skill.name)).toEqual([
      'step-bound',
      'wf-bound',
      'profile-skill',
    ]);
  });
});

// The actual function StepAgentStepExecutorService calls: proves the
// service's own profile-skill lookup (StepSupportService) is combined with
// bindings through the same shared helper, end to end.
describe('resolveStepProfileAndAssignedSkills (full executor call site)', () => {
  it('combines StepSupportService profile skills with workflow bindings', async () => {
    const resolveAssignedSkillsForProfile = vi.fn().mockResolvedValue({
      skills: [buildSkill('profile-skill')],
      workflowId: 'workflow-def-1',
      workflowName: 'implement-workflow',
    });
    const listForWorkflow = vi
      .fn()
      .mockResolvedValue([buildBinding(null, 'wf-bound')]);
    const listSkills = vi.fn().mockReturnValue([buildSkill('wf-bound')]);

    const { assignedSkills, workflowId } =
      await resolveStepProfileAndAssignedSkills({
        support: { resolveAssignedSkillsForProfile },
        workflowSkillBindings: { listForWorkflow },
        skillCatalog: { listSkills },
        agentProfile: 'software-architect',
        stateVariables: {},
        workflowRunId: 'run-1',
        stepId: 'implement',
      });

    expect(resolveAssignedSkillsForProfile).toHaveBeenCalledWith(
      'software-architect',
      { stateVariables: {}, workflowRunId: 'run-1' },
    );
    expect(workflowId).toBe('workflow-def-1');
    expect(assignedSkills.map((skill) => skill.name)).toEqual([
      'wf-bound',
      'profile-skill',
    ]);
  });

  // Task 5 GATE: proves a YAML-declared workflow-level AND step-level skill
  // (parsed off `IWorkflowDefinition.skills` / a job's `inputs.skills`) is
  // not dropped by this wrapper — it must reach `resolveEffectiveSkills` as
  // `workflowYamlSkills`/`stepYamlSkills`, not a hardcoded `[]` placeholder.
  it('threads workflowYamlSkills and stepYamlSkills through to the resolved effective skills', async () => {
    const resolveAssignedSkillsForProfile = vi.fn().mockResolvedValue({
      skills: [buildSkill('profile-skill')],
      workflowId: 'workflow-def-1',
      workflowName: 'implement-workflow',
    });
    const listForWorkflow = vi.fn().mockResolvedValue([]);
    const listSkills = vi
      .fn()
      .mockReturnValue([
        buildSkill('workflow-yaml-skill'),
        buildSkill('step-yaml-skill'),
      ]);

    const { assignedSkills } = await resolveStepProfileAndAssignedSkills({
      support: { resolveAssignedSkillsForProfile },
      workflowSkillBindings: { listForWorkflow },
      skillCatalog: { listSkills },
      agentProfile: 'software-architect',
      stateVariables: {},
      workflowRunId: 'run-1',
      stepId: 'implement',
      workflowYamlSkills: ['workflow-yaml-skill'],
      stepYamlSkills: ['step-yaml-skill'],
    });

    // step > workflow > profile specificity ordering (resolveEffectiveSkills).
    expect(assignedSkills.map((skill) => skill.name)).toEqual([
      'step-yaml-skill',
      'workflow-yaml-skill',
      'profile-skill',
    ]);
  });
});

// FU-7: the container-provisioning call site must thread the same effective
// skill set the runner-config build resolves (profile ∪ workflow ∪ step)
// straight to the mount, without a second resolution.
describe('provisionContainerForJobCore (container-provisioning call site)', () => {
  it('threads the effective skill set resolved by buildRunnerConfig through to provisionJobContainer', async () => {
    const boundSkill = buildSkill('step-bound-skill');
    const profileSkill = buildSkill('profile-skill');
    const buildRunnerConfig = vi
      .fn()
      .mockImplementation(
        async (
          onAssignedSkillsResolved: (skills: SkillLibraryRecord[]) => void,
        ) => {
          onAssignedSkillsResolved([profileSkill, boundSkill]);
          return { harnessId: 'claude-code' } as never;
        },
      );
    const storeRunnerConfig = vi.fn().mockResolvedValue(undefined);
    const provisionJobContainer = vi.fn().mockResolvedValue('container-1');

    const containerId = await provisionContainerForJobCore({
      fallbackHarnessId: 'pi',
      buildRunnerConfig,
      storeRunnerConfig,
      provisionJobContainer,
    });

    expect(containerId).toBe('container-1');
    expect(storeRunnerConfig).toHaveBeenCalledWith({
      harnessId: 'claude-code',
    });
    expect(provisionJobContainer).toHaveBeenCalledWith('claude-code', [
      profileSkill,
      boundSkill,
    ]);
  });

  it('falls back to the default harness and skips storing config when there is no runner config', async () => {
    const buildRunnerConfig = vi.fn().mockResolvedValue(null);
    const storeRunnerConfig = vi.fn().mockResolvedValue(undefined);
    const provisionJobContainer = vi.fn().mockResolvedValue('container-2');

    const containerId = await provisionContainerForJobCore({
      fallbackHarnessId: 'pi',
      buildRunnerConfig,
      storeRunnerConfig,
      provisionJobContainer,
    });

    expect(containerId).toBe('container-2');
    expect(storeRunnerConfig).not.toHaveBeenCalled();
    expect(provisionJobContainer).toHaveBeenCalledWith('pi', undefined);
  });
});
