import type {
  IJob,
  IJobStep,
  HarnessRuntimeConfig,
  HarnessId,
  SkillDiscoveryMode,
  FallbackChainEntry,
} from '@nexus/core';
import { asRecord, getNestedValue } from '@nexus/core';
import { resolveAndAttachStepContributions } from './step-agent-step-executor.contributions.helpers';
import { buildAgentSystemPrompt } from './step-agent-system-prompt.helpers';
import Docker from 'dockerode';
import { Logger } from '@nestjs/common';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import type {
  ResolvedAgentSettings,
  ResolvedRunnerProviderConfig,
} from '../../ai-config/ai-configuration.service.types';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import type { ChatSessionDomainPort } from '../domain-ports';
import { JobQueueData } from './step-execution.types';
import { StateManagerService } from '../state-manager.service';
import { StepSupportService } from './step-support.service';
import type { StrategicIntentPromptContextProvider } from './strategic-intent-prompt-context.provider';
import {
  readFirstString,
  normalizeIdentifier,
} from '../workflow-stage-skill-policy.helpers';
import { resolveRunnerHarness } from '../../harness/harness-runtime-selection';
import type {
  HarnessRegistryLike,
  HarnessCredentialResolverLike,
  ScopedDefaultsLike,
  AgentProfileContributionsLoader,
  ThinkingLevelResolverLike,
} from './step-agent-step-executor.helpers.types';
import { resolveAndApplyThinkingLevel } from './thinking-level-apply.helpers';
import { buildExecutionMountKey } from '../workflow-job-identity.helpers';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';
import type { StepRequiredToolRetryService } from './step-required-tool-retry.service';
import {
  assembleBaseRunnerConfig,
  buildInitialPrompt,
  readOptionalString,
  resolveCredentials,
  resolveRetryPrompt,
  resolveStepInputOverrides,
} from './step-agent-step-executor.config-assembly.helpers';

export { buildRunnerSessionConfig } from './step-agent-step-executor.config-assembly.helpers';

type LedgerLike = { emitBestEffort: (payload: unknown) => unknown };

/**
 * Derives the container tool-mount key and the first step's id for a job.
 * Pure — extracted from `StepAgentStepExecutorService` to keep that file
 * under the project's `max-lines` lint cap.
 */
export function resolveExecutionIdentifiersCore(
  workflowRunId: string,
  jobId: string,
  job: IJob,
  bullJobId: string | number | undefined,
): { mountKey: string; stepId: string } {
  const mountKey = buildExecutionMountKey({
    workflowRunId,
    jobId,
    bullJobId,
  });
  const stepId = Array.isArray(job.steps)
    ? (job.steps[0]?.id ?? 'default')
    : 'default';

  return { mountKey, stepId };
}

export async function resolveContainerIpAddress(
  docker: Docker,
  containerId: string,
): Promise<string> {
  const container = docker.getContainer(containerId);
  const inspected = (await container.inspect()) as unknown as {
    NetworkSettings: {
      IPAddress: string;
      Networks: Record<string, { IPAddress: string }>;
    };
  };

  const networkName =
    process.env.NEXUS_DOCKER_NETWORK?.trim() || 'nexus-network';
  const networkInfo = inspected.NetworkSettings.Networks[networkName];

  if (networkInfo?.IPAddress) {
    return networkInfo.IPAddress;
  }

  if (inspected.NetworkSettings.IPAddress) {
    return inspected.NetworkSettings.IPAddress;
  }

  throw new Error(
    `Could not determine IP address for container ${containerId} on network '${networkName}'`,
  );
}

export async function resolveStepAiSettings(
  aiConfig: AiConfigurationService,
  overrides: {
    explicitModel?: string;
    explicitProvider?: string;
    explicitSystemPrompt?: string;
    stepFallbackChain?: FallbackChainEntry[];
  },
  scoped: { harnessId?: string; modelName?: string; providerName?: string },
  step: IJobStep,
  agentProfile?: string,
): Promise<{
  resolvedSettings: ResolvedAgentSettings;
  providerConfig: ResolvedRunnerProviderConfig;
}> {
  const resolvedSettings = await aiConfig.resolveStepSettings({
    explicitModel: overrides.explicitModel ?? scoped.modelName,
    explicitSystemPrompt: overrides.explicitSystemPrompt,
    explicitProviderName: overrides.explicitProvider ?? scoped.providerName,
    agentProfileName: agentProfile,
    promptMode: step.prompt_mode,
    stepFallbackChain: overrides.stepFallbackChain,
  });
  const providerConfig = await aiConfig.resolveRunnerProviderConfig({
    modelName: resolvedSettings.model,
    providerName: resolvedSettings.providerName,
    providerId: resolvedSettings.providerId ?? undefined,
    providerSource: resolvedSettings.providerSource ?? undefined,
  });
  return { resolvedSettings, providerConfig };
}

export async function resolveStepHarness(
  registry: HarnessRegistryLike,
  resolvedJobInputs: Record<string, unknown>,
  scoped: { harnessId?: string; modelName?: string; providerName?: string },
  providerConfig: ResolvedRunnerProviderConfig,
  resolvedSettings: ResolvedAgentSettings,
  aiConfig: AiConfigurationService,
  scopeNodeId?: string,
  ledger?: LedgerLike,
): Promise<{
  harnessId: HarnessId;
  providerConfig: ResolvedRunnerProviderConfig;
}> {
  return resolveRunnerHarness({
    registry,
    stepOverride: readOptionalString(resolvedJobInputs.harness_id),
    projectDefault: scoped.harnessId,
    providerConfig,
    resolvedModel: resolvedSettings.model,
    aiConfig,
    scopeNodeId,
    ledger,
  });
}

export async function buildStepRunnerConfigPayloadCore(params: {
  data: JobQueueData;
  step: IJobStep;
  resolvedJobInputs: Record<string, unknown>;
  stateVariables: Record<string, unknown>;
  support: StepSupportService;
  stateManager: StateManagerService;
  aiConfig: AiConfigurationService;
  assignedSkills?: SkillLibraryRecord[];
  availableCategories?: string[];
  skillDiscoveryMode?: SkillDiscoveryMode;
  registry: HarnessRegistryLike;
  credentialResolver?: HarnessCredentialResolverLike;
  scopeNodeId?: string;
  scopedDefaults?: ScopedDefaultsLike;
  ledger?: LedgerLike;
  strategicIntentContext?: StrategicIntentPromptContextProvider;
  agentProfileResolution?: AgentProfileContributionsLoader;
  /** When true, omits the memory-capture-guidance layer (sweep / CEO singletons). */
  suppressMemoryCapture?: boolean;
  thinkingLevelResolver?: ThinkingLevelResolverLike;
}): Promise<HarnessRuntimeConfig> {
  const agentProfile = params.support.resolveAgentProfileFromJobInputs(
    params.resolvedJobInputs,
    params.data.job,
  );

  // Resolve scoped defaults once; used for harness/model/provider precedence.
  // Precedence: step override → agent profile → scoped default → DB default → env
  const scoped = params.scopedDefaults
    ? await params.scopedDefaults.resolve(params.scopeNodeId)
    : {};

  const overrides = resolveStepInputOverrides({
    resolvedJobInputs: params.resolvedJobInputs,
    stateVariables: params.stateVariables,
    step: params.step,
    stateManager: params.stateManager,
  });

  const { resolvedSettings, providerConfig } = await resolveStepAiSettings(
    params.aiConfig,
    overrides,
    scoped,
    params.step,
    agentProfile,
  );

  const { harnessId: finalHarnessId, providerConfig: finalProviderConfig } =
    await resolveStepHarness(
      params.registry,
      params.resolvedJobInputs,
      scoped,
      providerConfig,
      resolvedSettings,
      params.aiConfig,
      params.scopeNodeId,
      params.ledger,
    );

  const systemPrompt = await buildAgentSystemPrompt({
    support: params.support,
    data: params.data,
    step: params.step,
    stateVariables: params.stateVariables,
    resolvedSystemPrompt: resolvedSettings.systemPrompt,
    assignedSkills: params.assignedSkills,
    availableCategories: params.availableCategories,
    skillDiscoveryMode: params.skillDiscoveryMode,
    strategicIntentContext: params.strategicIntentContext,
    harnessId: finalHarnessId,
    agentProfile,
    suppressMemoryCapture: params.suppressMemoryCapture,
  });
  const retryPrompt = resolveRetryPrompt(params.data.userMessage);
  // A resume replays the prior conversation (pi via tree injection, claude_code
  // via SDK `options.resume`), so the user turn must be the continuation message
  // only. A plain post-failure retry has no replayed session and keeps the full
  // prompt.
  const isResume = params.data.resumeSessionRef != null;
  const initialPrompt = buildInitialPrompt(systemPrompt, retryPrompt, isResume);

  const { resolvedAuth, credentials } = await resolveCredentials({
    credentialResolver: params.credentialResolver,
    harnessId: finalHarnessId,
    scopeNodeId: params.scopeNodeId,
    providerAuth: finalProviderConfig.auth,
  });

  const harnessEntry = params.registry.resolve?.(finalHarnessId);
  const baseConfig = assembleBaseRunnerConfig({
    harnessId: finalHarnessId,
    capabilities: harnessEntry?.capabilities,
    resumeSessionRef: params.data.resumeSessionRef,
    providerConfig: finalProviderConfig,
    model: resolvedSettings.model,
    resolvedAuth,
    credentials,
    systemPrompt,
    initialPrompt,
  });

  await resolveAndApplyThinkingLevel({
    baseConfig,
    resolver: params.thinkingLevelResolver,
    agentProfileName: agentProfile,
    stepInputRaw: params.resolvedJobInputs.thinking_level,
    modelId: resolvedSettings.model,
    provider: finalProviderConfig.provider,
    providerConfig: finalProviderConfig.providerConfig,
    harnessSupportsThinkingLevels:
      harnessEntry?.capabilities?.supportsThinkingLevels ?? false,
    aiConfig: params.aiConfig,
    ledger: params.ledger,
  });

  // Attach author contributions only when the registry exposes capabilities to
  // validate against (custom registries without `resolve` keep the base config).
  return resolveAndAttachStepContributions({
    baseConfig,
    harnessId: finalHarnessId,
    capabilities: harnessEntry?.capabilities,
    agentProfile,
    scopeNodeId: params.scopeNodeId,
    resolvedJobInputs: params.resolvedJobInputs,
    assignedSkills: params.assignedSkills,
    agentProfileResolution: params.agentProfileResolution,
    ledger: params.ledger,
  });
}

export async function injectPreviousSessionCore(params: {
  containerId: string;
  stateVariables: Record<string, unknown>;
  logger: Logger;
  sessionHydration: Pick<ChatSessionDomainPort, 'injectSessionIntoContainer'>;
  resumeSessionTreeId?: string;
}): Promise<void> {
  let sessionTreeId: string | undefined = params.resumeSessionTreeId;

  if (!sessionTreeId && shouldInjectPreviousSession(params.stateVariables)) {
    sessionTreeId = getNestedValue(
      params.stateVariables,
      'trigger.context.metadata.lastSessionTreeId'.split('.'),
    ) as string | undefined;
  }

  if (typeof sessionTreeId !== 'string' || sessionTreeId.length === 0) {
    return;
  }

  params.logger.log(
    `Injecting previous session ${sessionTreeId} into container ${params.containerId}`,
  );
  await params.sessionHydration.injectSessionIntoContainer(
    params.containerId,
    sessionTreeId,
  );
}

function shouldInjectPreviousSession(
  stateVariables: Record<string, unknown>,
): boolean {
  const trigger = asRecord(stateVariables.trigger);
  const dispatchTargetStage = readFirstString([
    trigger?.dispatch_target_status,
    trigger?.dispatchTargetStatus,
    trigger?.lifecycle_stage,
    trigger?.lifecycleStage,
  ]);
  const fromLifecycleStage = readFirstString([
    trigger?.from_lifecycle_stage,
    trigger?.fromLifecycleStage,
  ]);

  if (
    fromLifecycleStage &&
    normalizeIdentifier(fromLifecycleStage) === 'review' &&
    dispatchTargetStage &&
    normalizeIdentifier(dispatchTargetStage) === 'implementation'
  ) {
    return true;
  }

  return hasRejectionSignal(stateVariables);
}

function hasRejectionSignal(stateVariables: Record<string, unknown>): boolean {
  const rejectionCandidateKeys = [
    'trigger.rejectionFeedback',
    'trigger.failedDeliverables',
    'trigger.failed_deliverables',
    'trigger.executionConfig.rejectionFeedback',
    'trigger.executionConfig.failedDeliverables',
    'trigger.executionConfig.failed_deliverables',
  ];

  return rejectionCandidateKeys.some((path) => {
    const value = getNestedValue(stateVariables, path.split('.'));

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    return value !== undefined && value !== null;
  });
}

export async function saveSessionAndUpdateResourceCore(params: {
  containerId: string;
  workflowRunId: string;
  stateVariables: Record<string, unknown>;
  sessionHydration: Pick<
    ChatSessionDomainPort,
    'saveSessionFromExitedContainer'
  >;
}): Promise<string | null> {
  const sessionTreeId =
    await params.sessionHydration.saveSessionFromExitedContainer(
      params.containerId,
      params.workflowRunId,
    );
  return sessionTreeId;
}

/**
 * Re-enqueues a job on fallback-chain advance, carrying forward the
 * workflow-level permissions/skill-discovery-mode/YAML skills from the
 * originating `JobQueueData` so a retried step doesn't silently diverge from
 * the first attempt's available capability. Extracted from
 * `StepAgentStepExecutorService` to keep that file under the project's
 * `max-lines` lint cap.
 */
export async function retryJobCarryingWorkflowSkillsCore(
  workflowEngine: IWorkflowEngineService,
  data: JobQueueData,
  args: { runId: string; failedJobId: string; retryPrompt: string },
): Promise<void> {
  await workflowEngine.retryJobWithMessage(
    args.runId,
    args.failedJobId,
    data.job,
    undefined,
    args.retryPrompt,
    data.workflowPermissions,
    data.workflowSkillDiscoveryMode,
    data.workflowYamlSkills,
  );
}

/**
 * Delegates required-tool-call/output-contract retry checks, threading the
 * same workflow-level fields as `retryJobCarryingWorkflowSkillsCore` above.
 */
export function checkRequiredToolRetryForJobCore(
  requiredToolRetry: StepRequiredToolRetryService,
  params: {
    workflowRunId: string;
    jobId: string;
    job: IJob;
    data: JobQueueData;
  },
  containerId: string,
): Promise<'retried' | 'proceed'> {
  return requiredToolRetry.checkRequiredToolCallsAndRetryJob(
    params.workflowRunId,
    params.jobId,
    params.job,
    containerId,
    params.data.workflowPermissions,
    params.data.workflowSkillDiscoveryMode,
    params.data.workflowYamlSkills,
  );
}
