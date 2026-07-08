import {
  resolveSkillDiscoveryMode,
  type HarnessId,
  type HarnessRuntimeConfig,
  type IJobStep,
  type SkillDiscoveryMode,
} from '@nexus/core';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import { resolveAgentAssignedSkills } from '../agent-prompt/agent-assigned-skills.helpers';
import type { ResolveAgentAssignedSkillsParams } from '../agent-prompt/agent-assigned-skills.types';
import { extractYamlSkillNames } from '../workflow-yaml-skills.helpers';
import type { StepSupportService } from './step-support.service';

/**
 * Step-execution-path wrapper around the shared `resolveAgentAssignedSkills`
 * helper (Task 4). Requires `stepId` (a step always has a YAML id) so the
 * caller can't accidentally omit step-scoped binding resolution.
 *
 * Exists as its own small, directly-testable function (mirroring
 * `resolveSubagentEffectiveAssignedSkills` on the subagent path) so a
 * characterization test can assert both paths resolve identically without
 * standing up either path's full DI graph — this is the anti-divergence
 * contract Task 4 exists to enforce.
 */
export function resolveStepEffectiveAssignedSkills(
  params: ResolveAgentAssignedSkillsParams & { stepId: string },
): Promise<SkillLibraryRecord[]> {
  return resolveAgentAssignedSkills(params);
}

/**
 * Full step-executor call site: resolves the profile-level skill selection
 * (existing stage-policy flow) then layers workflow/step bindings on top via
 * {@link resolveStepEffectiveAssignedSkills}. Extracted out of
 * `StepAgentStepExecutorService` so this wiring is unit-testable without the
 * service's full DI graph, and to keep the service file under the project's
 * `max-lines` lint cap.
 */
export async function resolveStepProfileAndAssignedSkills(params: {
  support: Pick<StepSupportService, 'resolveAssignedSkillsForProfile'>;
  workflowSkillBindings: ResolveAgentAssignedSkillsParams['workflowSkillBindings'];
  skillCatalog: ResolveAgentAssignedSkillsParams['skillCatalog'];
  agentProfile?: string;
  stateVariables: Record<string, unknown>;
  workflowRunId: string;
  stepId: string;
  /** Workflow-level YAML-declared skills (`IWorkflowDefinition.skills`). */
  workflowYamlSkills?: string[];
  /** Step-level YAML-declared skills (job's `inputs.skills`). */
  stepYamlSkills?: string[];
}): Promise<{ assignedSkills: SkillLibraryRecord[]; workflowId?: string }> {
  const {
    skills: profileSkills,
    workflowId,
    workflowName,
  } = await params.support.resolveAssignedSkillsForProfile(
    params.agentProfile,
    {
      stateVariables: params.stateVariables,
      workflowRunId: params.workflowRunId,
    },
  );

  const assignedSkills = await resolveStepEffectiveAssignedSkills({
    workflowSkillBindings: params.workflowSkillBindings,
    skillCatalog: params.skillCatalog,
    profileSkills,
    workflowName,
    stepId: params.stepId,
    workflowYamlSkills: params.workflowYamlSkills,
    stepYamlSkills: params.stepYamlSkills,
  });

  return { assignedSkills, workflowId };
}

/**
 * Derives the skill-discovery mode + `search`-mode category list from the
 * already-resolved effective skill set. Pure, no IO — extracted alongside
 * the assigned-skills resolution above to keep `StepAgentStepExecutorService`
 * under the project's `max-lines` lint cap.
 */
export function resolveStepSkillDiscoveryContext(params: {
  stepSkillDiscoveryMode?: SkillDiscoveryMode | null;
  workflowSkillDiscoveryMode?: SkillDiscoveryMode | null;
  agentProfileSkillDiscoveryMode?: SkillDiscoveryMode | null;
  assignedSkills: SkillLibraryRecord[];
  listSkillCategories: (skillIds?: string[]) => string[];
}): { skillDiscoveryMode: SkillDiscoveryMode; availableCategories?: string[] } {
  const skillDiscoveryMode = resolveSkillDiscoveryMode({
    step: params.stepSkillDiscoveryMode ?? null,
    workflow: params.workflowSkillDiscoveryMode ?? null,
    agentProfile: params.agentProfileSkillDiscoveryMode ?? null,
  });

  const hasSearchSkill = params.assignedSkills.some(
    (skill) => skill.id === 'search_skills' || skill.name === 'search_skills',
  );
  const availableCategories =
    skillDiscoveryMode === 'search'
      ? params.listSkillCategories(
          hasSearchSkill
            ? undefined
            : params.assignedSkills.map((skill) => skill.id),
        )
      : undefined;

  return { skillDiscoveryMode, availableCategories };
}

/**
 * Full step-executor call site for BOTH the effective skill set and the
 * skill-discovery context it feeds into, combined into one call so
 * `StepAgentStepExecutorService.buildStepRunnerConfigPayload` only has to
 * make a single call instead of wiring both helpers inline (keeps the
 * service under the project's `max-lines` lint cap). `stepYamlSkills` is
 * derived from the job's own `inputs.skills` here (Epic B Task 5) so callers
 * only need to pass the already-resolved `resolvedJobInputs` bag through.
 */
export async function resolveStepSkillsAndDiscoveryContext(params: {
  support: Pick<StepSupportService, 'resolveAssignedSkillsForProfile'>;
  workflowSkillBindings: ResolveAgentAssignedSkillsParams['workflowSkillBindings'];
  skillCatalog: ResolveAgentAssignedSkillsParams['skillCatalog'];
  agentProfile?: string;
  stateVariables: Record<string, unknown>;
  workflowRunId: string;
  stepId: string;
  workflowYamlSkills?: string[];
  resolvedJobInputs: Record<string, unknown>;
  stepSkillDiscoveryMode?: SkillDiscoveryMode | null;
  workflowSkillDiscoveryMode?: SkillDiscoveryMode | null;
  agentProfileSkillDiscoveryMode?: SkillDiscoveryMode | null;
  listSkillCategories: (skillIds?: string[]) => string[];
}): Promise<{
  assignedSkills: SkillLibraryRecord[];
  workflowId?: string;
  skillDiscoveryMode: SkillDiscoveryMode;
  availableCategories?: string[];
}> {
  const { assignedSkills, workflowId } =
    await resolveStepProfileAndAssignedSkills({
      support: params.support,
      workflowSkillBindings: params.workflowSkillBindings,
      skillCatalog: params.skillCatalog,
      agentProfile: params.agentProfile,
      stateVariables: params.stateVariables,
      workflowRunId: params.workflowRunId,
      stepId: params.stepId,
      workflowYamlSkills: params.workflowYamlSkills,
      stepYamlSkills: extractYamlSkillNames(params.resolvedJobInputs),
    });

  const { skillDiscoveryMode, availableCategories } =
    resolveStepSkillDiscoveryContext({
      stepSkillDiscoveryMode: params.stepSkillDiscoveryMode,
      workflowSkillDiscoveryMode: params.workflowSkillDiscoveryMode,
      agentProfileSkillDiscoveryMode: params.agentProfileSkillDiscoveryMode,
      assignedSkills,
      listSkillCategories: params.listSkillCategories,
    });

  return {
    assignedSkills,
    workflowId,
    skillDiscoveryMode,
    availableCategories,
  };
}

/**
 * Provisions a job's container, threading the effective skill set the
 * runner-config build already resolved (via `resolveStepSkillsAndDiscoveryContext`
 * above) straight to the container mount instead of letting the mount
 * re-resolve a profile-only set on its own (FU-7 — the mount must carry
 * whatever the prompt path injects, including workflow/step-bound skills).
 * `buildRunnerConfig` reports the resolved set through the
 * `onAssignedSkillsResolved` callback it's invoked with — this is the SAME
 * resolution already performed to build the runner config, so no second
 * skill-library scan happens here. Extracted out of
 * `StepAgentStepExecutorService.provisionContainerForJob` so this wiring is
 * unit-testable without the service's full DI graph.
 */
export async function provisionContainerForJobCore(params: {
  fallbackHarnessId: HarnessId;
  buildRunnerConfig: (
    onAssignedSkillsResolved: (skills: SkillLibraryRecord[]) => void,
  ) => Promise<HarnessRuntimeConfig | null>;
  storeRunnerConfig: (config: HarnessRuntimeConfig) => Promise<void>;
  provisionJobContainer: (
    harnessId: HarnessId,
    preResolvedAssignedSkills: SkillLibraryRecord[] | undefined,
  ) => Promise<string>;
}): Promise<string> {
  let resolvedAssignedSkills: SkillLibraryRecord[] | undefined;
  const runtimeConfig = await params.buildRunnerConfig((skills) => {
    resolvedAssignedSkills = skills;
  });
  const harnessId = runtimeConfig?.harnessId ?? params.fallbackHarnessId;

  if (runtimeConfig) {
    await params.storeRunnerConfig(runtimeConfig);
  }

  return params.provisionJobContainer(harnessId, resolvedAssignedSkills);
}

/**
 * Builds the `buildRunnerConfig` callback {@link provisionContainerForJobCore}
 * expects, gated on whether the job actually has a first step to build a
 * runner config for. Extracted purely to keep
 * `StepAgentStepExecutorService.provisionContainerForJob` under the
 * project's `max-lines` lint cap.
 */
export function buildFirstStepRunnerConfigResolver(params: {
  firstStep: IJobStep | undefined;
  buildStepRunnerConfigPayload: (
    step: IJobStep,
    onAssignedSkillsResolved: (skills: SkillLibraryRecord[]) => void,
  ) => Promise<HarnessRuntimeConfig>;
}): (
  onAssignedSkillsResolved: (skills: SkillLibraryRecord[]) => void,
) => Promise<HarnessRuntimeConfig | null> {
  return (onAssignedSkillsResolved) =>
    params.firstStep
      ? params.buildStepRunnerConfigPayload(
          params.firstStep,
          onAssignedSkillsResolved,
        )
      : Promise.resolve(null);
}
