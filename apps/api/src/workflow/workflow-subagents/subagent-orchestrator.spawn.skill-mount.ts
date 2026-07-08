import type { SubagentExecutionView } from './subagent-execution-view.types';
import type { WorkflowRun } from '../database/entities/workflow-run.entity';
import { CONTAINER_SKILLS_ROOT } from '../../tool-runtime/skill-mounting.constants';
import type { SubagentSpawnOperationsContext } from './subagent-orchestrator.operations.types';
import {
  buildSubagentSkillMountKey,
  resolveSubagentProfileAndAssignedSkills,
} from './subagent-orchestrator.skills.helpers';
import type { SubagentSpawnParams } from './subagent-orchestrator.types';
import {
  extractScopeIdFromRunStateVariables,
  formatSkillMountDiagnostics,
} from './subagent-orchestrator.utils';
import type { SkillMountContext } from './subagent-orchestrator.spawn.skill-mount.types';

/**
 * Resolves a spawning subagent's effective skill set (profile ∪ workflow ∪
 * step YAML/bindings, via the exact same shared helper the step-execution
 * path calls — `resolveStepProfileAndAssignedSkills` — so this path can
 * never silently diverge from it) and prepares its on-disk skill mount.
 *
 * Step-scoped bindings and step-level YAML `inputs.skills` are included when
 * the spawn params carry `parent_step_id` — the spawning step's YAML id,
 * threaded from `WorkflowRuntimeSubagentToolsService` (FU-5). When absent
 * (e.g. a subagent spawned outside a step context), only workflow-level
 * sources apply, resolved by `resolveSubagentProfileAndAssignedSkills`.
 */
export async function prepareSkillMountContext(
  context: SubagentSpawnOperationsContext,
  params: {
    execution: SubagentExecutionView;
    params: SubagentSpawnParams;
  },
  run: WorkflowRun | null,
): Promise<SkillMountContext> {
  const workflowId = run?.workflow_id;
  const scopeId = run
    ? extractScopeIdFromRunStateVariables(run.state_variables)
    : undefined;

  const assignedSkills = await resolveSubagentProfileAndAssignedSkills({
    stageSkillPolicy: context.stageSkillPolicy,
    workflowRepo: context.workflowRepo,
    workflowSkillBindings: context.workflowSkillBindings,
    skillCatalog: context.skillCatalog,
    agentProfile: params.params.agent_profile,
    lifecycleStage: params.params.lifecycle_stage,
    workflowId,
    stepId: params.params.parent_step_id,
    scopeId,
    onWorkflowNameError: (message) => {
      context.logger.warn(message);
    },
  });

  const skillMountKey = buildSubagentSkillMountKey(params.execution.id);
  const skillMountPath = context.skillMounting.prepareSkillMount(
    skillMountKey,
    assignedSkills,
  );

  context.logger.log(
    formatSkillMountDiagnostics({
      workflowRunId: params.params.workflowRunId,
      executionId: params.execution.id,
      agentProfile: params.params.agent_profile,
      assignedSkillNames: assignedSkills.map((skill) => skill.name),
      skillMountPath,
      containerSkillsRoot: CONTAINER_SKILLS_ROOT,
    }),
  );

  return {
    assignedSkills,
    skillMountKey,
    skillMountPath,
  };
}
