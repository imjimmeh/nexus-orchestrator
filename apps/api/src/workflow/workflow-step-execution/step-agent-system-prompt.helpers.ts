import type { IJobStep, HarnessId, SkillDiscoveryMode } from '@nexus/core';
import { asRecord, DEFAULT_SKILL_DISCOVERY_MODE } from '@nexus/core';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import { StepSupportService } from './step-support.service';
import { JobQueueData } from './step-execution.types';
import type { StrategicIntentPromptContextProvider } from './strategic-intent-prompt-context.provider';
import type { UniversalPromptContext } from '../agent-prompt/universal-prompt-context.types';
import { buildUniversalPromptLayers } from '../agent-prompt/universal-prompt-layers.helpers';

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function buildAgentSystemPrompt(params: {
  support: StepSupportService;
  data: JobQueueData;
  step: IJobStep;
  stateVariables: Record<string, unknown>;
  resolvedSystemPrompt: string;
  assignedSkills?: SkillLibraryRecord[];
  availableCategories?: string[];
  skillDiscoveryMode?: SkillDiscoveryMode;
  strategicIntentContext?: StrategicIntentPromptContextProvider;
  harnessId?: HarnessId;
  agentProfile?: string;
  /** When true, omits the memory-capture-guidance layer (sweep / CEO singletons). */
  suppressMemoryCapture?: boolean;
}): Promise<string> {
  const stepPrompt =
    typeof params.step.prompt === 'string' ? params.step.prompt.trim() : '';

  const trigger = asRecord(params.stateVariables.trigger);
  const triggerContext = asRecord(trigger?.context);
  const scopeId = readOptionalString(triggerContext?.scopeId);
  const contextId = readOptionalString(triggerContext?.contextId);
  const contextType = readOptionalString(triggerContext?.contextType);
  const entityType = readOptionalString(triggerContext?.entityType);
  const entityId = readOptionalString(triggerContext?.entityId);

  const universalCtx: UniversalPromptContext = {
    support: params.support,
    harnessId: params.harnessId,
    workflowRunId: params.data.workflowRunId,
    jobId: params.data.job.id,
    stepId: params.step.id,
    scopeId,
    contextId,
    contextType,
    entityType,
    entityId,
    resolvedSystemPrompt: params.resolvedSystemPrompt,
    assignedSkills: params.assignedSkills,
    availableCategories: params.availableCategories,
    skillDiscoveryMode:
      params.skillDiscoveryMode ?? DEFAULT_SKILL_DISCOVERY_MODE,
    taskPrompt: stepPrompt || undefined,
    suppressMemoryCapture: params.suppressMemoryCapture ?? false,
    agentProfile: params.agentProfile,
    runType: 'workflow',
  };

  const [
    upstreamContext,
    runningWorkflowsContext,
    strategicIntentSection,
    universalLayers,
  ] = await Promise.all([
    params.support.buildUpstreamContextForJob(
      params.data.workflowRunId,
      params.data.job,
    ),
    params.support.buildRunningWorkflowsContext({
      stateVariables: params.stateVariables,
      excludeRunId: params.data.workflowRunId,
    }),
    buildStrategicIntentSection({
      provider: params.strategicIntentContext,
      workflowRunId: params.data.workflowRunId,
      stateVariables: params.stateVariables,
    }),
    buildUniversalPromptLayers(universalCtx),
  ]);

  const stepOnlyLayers = [
    { id: 'upstream', content: upstreamContext },
    { id: 'strategic-intent', content: strategicIntentSection },
    { id: 'running-workflows', content: runningWorkflowsContext },
  ].filter((layer) => layer.content && layer.content.trim().length > 0);

  const baseLayers = [...stepOnlyLayers, ...universalLayers];

  return params.support.assembleAgentSystemPrompt({
    runType: 'workflow',
    harnessId: params.harnessId,
    workflowRunId: params.data.workflowRunId,
    jobId: params.data.job.id,
    stepId: params.step.id,
    scopeId,
    contextId,
    contextType,
    agentProfileId: params.agentProfile,
    baseLayers,
  });
}

async function buildStrategicIntentSection(params: {
  provider: StrategicIntentPromptContextProvider | undefined;
  workflowRunId: string;
  stateVariables: Record<string, unknown>;
}): Promise<string> {
  if (!params.provider) {
    return '';
  }
  try {
    return await params.provider.buildContext({
      workflowRunId: params.workflowRunId,
      stateVariables: params.stateVariables,
    });
  } catch (_error) {
    // Strategic-intent context is advisory and must never block the
    // agent's first turn — log via the provider and continue.
    return '';
  }
}
