import {
  resolveSkillDiscoveryMode,
  type SkillDiscoveryMode,
} from '@nexus/core';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import type { WorkflowStageSkillPolicyService } from '../workflow-stage-skill-policy.service';
import {
  WORKFLOW_LIFECYCLE_STAGES,
  type WorkflowLifecycleStage,
} from '../workflow-stage-skill-policy.service.types';
import { resolveAgentAssignedSkills } from '../agent-prompt/agent-assigned-skills.helpers';
import type { ResolveAgentAssignedSkillsParams } from '../agent-prompt/agent-assigned-skills.types';
import {
  resolveStepYamlSkillsById,
  resolveWorkflowNameById,
  resolveWorkflowYamlSkillsById,
} from '../workflow-run-id-resolver.helpers';
import type { WorkflowRepository } from '../database/repositories/workflow.repository';

export function buildSubagentSkillMountKey(executionId: string): string {
  return `subagent-${executionId}`;
}

export function resolveSubagentSkillDiscoveryMode(
  profileMode: SkillDiscoveryMode | null | undefined,
): SkillDiscoveryMode {
  return resolveSkillDiscoveryMode({ agentProfile: profileMode ?? null });
}

const SKILL_SEARCH_CAPABILITY = 'search_skills';

/**
 * Remove the `search_skills` capability from a subagent's tool list when the
 * resolved discovery mode is `native`. In `native` mode assigned skills are
 * surfaced directly, so the search tool must not be callable. `search` mode is
 * left untouched, and `read_skill_manifest` is never filtered.
 */
export function filterSearchSkillForMode(
  tools: string[],
  mode: SkillDiscoveryMode,
): string[] {
  return mode === 'native'
    ? tools.filter((tool) => tool !== SKILL_SEARCH_CAPABILITY)
    : tools;
}

export async function resolveSubagentAssignedSkills(params: {
  stageSkillPolicy: Pick<
    WorkflowStageSkillPolicyService,
    'resolveAssignedSkills'
  >;
  agentProfile: string;
  lifecycleStage: unknown;
  workflowId?: string;
  scopeId?: string;
  stateVariables?: Record<string, unknown>;
}): Promise<SkillLibraryRecord[]> {
  const selection = await params.stageSkillPolicy.resolveAssignedSkills({
    agentProfile: params.agentProfile,
    workflowStage: coerceLifecycleStage(params.lifecycleStage),
    workflowId: params.workflowId,
    scopeId: params.scopeId,
    stateVariables: params.stateVariables,
  });

  return selection.skills;
}

/**
 * Subagent-provisioning-path wrapper around the shared
 * `resolveAgentAssignedSkills` helper (Task 4) — the exact same underlying
 * function `resolveStepEffectiveAssignedSkills` calls on the step path
 * (`step-agent-effective-skills.helpers.ts`). Accepts the same `stepId`/
 * `stepYamlSkills` inputs the step path does; the caller
 * (`resolveSubagentProfileAndAssignedSkills`) is responsible for supplying
 * them once the spawning step's YAML id is known (FU-5).
 */
export function resolveSubagentEffectiveAssignedSkills(
  params: ResolveAgentAssignedSkillsParams,
): Promise<SkillLibraryRecord[]> {
  return resolveAgentAssignedSkills(params);
}

/**
 * Full subagent-spawn call site: resolves the profile-level skill selection
 * (existing stage-policy flow) then layers workflow AND step bindings/YAML
 * skills on top via {@link resolveSubagentEffectiveAssignedSkills}. Mirrors
 * the step path's `resolveStepProfileAndAssignedSkills`. `stepId` is the
 * spawning step's YAML id (threaded from `SubagentSpawnParams.parent_step_id`
 * — see `subagent-orchestrator.spawn.skill-mount.ts`); when absent (e.g. a
 * subagent spawned outside a step context) only workflow-level sources apply,
 * same as before FU-5. Extracted out of `prepareSkillMountContext` so this
 * wiring is unit-testable in isolation and to keep
 * `subagent-orchestrator.spawn.operations.ts` under the project's
 * `max-lines` lint cap.
 */
export async function resolveSubagentProfileAndAssignedSkills(params: {
  stageSkillPolicy: Pick<
    WorkflowStageSkillPolicyService,
    'resolveAssignedSkills'
  >;
  workflowRepo: Pick<WorkflowRepository, 'findById'>;
  workflowSkillBindings: ResolveAgentAssignedSkillsParams['workflowSkillBindings'];
  skillCatalog: ResolveAgentAssignedSkillsParams['skillCatalog'];
  agentProfile: string;
  lifecycleStage: unknown;
  workflowId?: string;
  /** Spawning step's YAML id, used to select step-scoped bindings/YAML skills. */
  stepId?: string;
  scopeId?: string;
  stateVariables?: Record<string, unknown>;
  onWorkflowNameError: (message: string) => void;
}): Promise<SkillLibraryRecord[]> {
  const profileSkills = await resolveSubagentAssignedSkills({
    stageSkillPolicy: params.stageSkillPolicy,
    agentProfile: params.agentProfile,
    lifecycleStage: params.lifecycleStage,
    workflowId: params.workflowId,
    scopeId: params.scopeId,
    stateVariables: params.stateVariables,
  });
  const [workflowName, workflowYamlSkills, stepYamlSkills] = await Promise.all([
    resolveWorkflowNameById(
      params.workflowRepo,
      params.workflowId,
      params.onWorkflowNameError,
    ),
    resolveWorkflowYamlSkillsById(
      params.workflowRepo,
      params.workflowId,
      params.onWorkflowNameError,
    ),
    resolveStepYamlSkillsById(
      params.workflowRepo,
      params.workflowId,
      params.stepId,
      params.onWorkflowNameError,
    ),
  ]);

  return resolveSubagentEffectiveAssignedSkills({
    workflowSkillBindings: params.workflowSkillBindings,
    skillCatalog: params.skillCatalog,
    profileSkills,
    workflowName,
    stepId: params.stepId,
    workflowYamlSkills,
    stepYamlSkills,
  });
}

function coerceLifecycleStage(stage: unknown): WorkflowLifecycleStage | null {
  if (typeof stage !== 'string') {
    return null;
  }

  const normalized = stage.trim();
  if (!normalized) {
    return null;
  }

  return WORKFLOW_LIFECYCLE_STAGES.includes(
    normalized as WorkflowLifecycleStage,
  )
    ? (normalized as WorkflowLifecycleStage)
    : null;
}
