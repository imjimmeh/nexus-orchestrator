import type {
  IContainerConfig,
  IHostMountBinding,
  HarnessId,
  HarnessRuntimeConfig,
  RuntimeToolchainConfig,
} from '@nexus/core';
import {
  ContainerTier,
  CONTAINER_EXTENSIONS_PATH,
  CONTAINER_SESSION_PATH,
  DEFAULT_SKILL_DISCOVERY_MODE,
} from '@nexus/core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { signAgentToken } from '../../auth/sign-agent-token';
import { CONTAINER_SKILLS_ROOT } from '../../tool-runtime/skill-mounting.constants';
import { resolveRunnerHarness } from '../../harness/harness-runtime-selection';
import { attachResolvedContributions } from '../workflow-step-execution/step-agent-step-executor.contributions.helpers';
import { resolveAndApplyThinkingLevel } from '../workflow-step-execution/thinking-level-apply.helpers';
import { gatherContributionSources } from '../../harness/gather-contribution-sources';
import {
  filterSearchSkillForMode,
  resolveSubagentSkillDiscoveryMode,
} from './subagent-orchestrator.skills.helpers';
import {
  resolveAllowedToolNamesForExecution,
  DEFAULT_COMPANION_RULES,
} from '../workflow-execution-tools/execution-tool-policy.helpers';
import { shouldSuppressMemoryCapture } from '../workflow-step-execution/step-support-memory-capture.helpers';
import { applyRuntimeToolchains } from '../workflow-step-execution/step-agent-container-support.runtime-toolchains';
import { buildUniversalPromptLayers } from '../agent-prompt/universal-prompt-layers.helpers';
import type { UniversalPromptContext } from '../agent-prompt/universal-prompt-context.types';
import { resolveWorkflowNameById } from '../workflow-run-id-resolver.helpers';
import type {
  SubagentContainerConfigContext,
  SubagentContainerConfigResult,
  SubagentRuntimeSelection,
} from './subagent-orchestrator.operations.types';
import type { SubagentSpawnParams } from './subagent-orchestrator.types';

const DEFAULT_WEBSOCKET_URL = 'http://host.docker.internal:3001';
const DEFAULT_API_BASE_URL = 'http://nexus-api:3000';

interface SubagentConfigParams {
  executionId: string;
  parentContainerId: string;
  spawnParams: SubagentSpawnParams;
  hostMountBindings?: IHostMountBinding[];
  skillMountPath?: string | null;
  assignedSkills?: Array<{
    name: string;
    description: string;
    skillMarkdown: string;
  }>;
  chatSessionId?: string | null;
  scopeNodeId?: string;
  executionContext?: {
    ownerType: 'global' | 'user' | 'scope';
    ownerId?: string | null;
  };
  /**
   * Workflow definition ID (not run ID) — used for memory-capture
   * suppression and (FU-8) resolving the workflow name threaded into the
   * promoted-learning recall identity.
   */
  workflowId?: string;
  /**
   * Tier of the parent step container. Used as the second step of the tier
   * precedence chain: `spawnParams.tier` → `parentTier` → default HEAVY.
   *
   * Not yet propagated by the spawn call path — callers that know the parent
   * step tier should pass it here to enable inheritance.
   */
  parentTier?: ContainerTier;
  /**
   * Host workspace/worktree path for the subagent's container, when known.
   * Fed into the runtime-toolchain resolver's repo auto-detection layer —
   * mirrors the step path's `worktreePath` input to {@link applyRuntimeToolchains}.
   */
  workspacePath?: string;
}

/**
 * Resolves the subagent's runner config (harness + provider/model + prompt) and
 * stages it in the runner-config store. Mirrors the parent step's precedence so
 * a subagent inherits its scope's harness + provider/model rather than silently
 * defaulting to `pi` with the agent profile's provider.
 * Precedence: spawn override → scoped default → agent profile.
 */
async function resolveAndStageSubagentRunnerConfig(
  context: SubagentContainerConfigContext,
  params: SubagentConfigParams,
  skillDiscoveryMode: ReturnType<typeof resolveSubagentSkillDiscoveryMode>,
): Promise<SubagentRuntimeSelection> {
  const scoped = await context.scopedDefaults.resolve(params.scopeNodeId);

  const profileSettings = await context.aiConfig.resolveStepSettings({
    agentProfileName: params.spawnParams.agent_profile,
    explicitSystemPrompt: params.spawnParams.task_prompt,
    explicitModel: params.spawnParams.model_override ?? scoped.modelName,
    explicitProviderName:
      params.spawnParams.provider_override ?? scoped.providerName,
  });
  const providerConfig = await context.aiConfig.resolveRunnerProviderConfig({
    modelName: profileSettings.model,
    providerName: profileSettings.providerName,
    providerId: profileSettings.providerId ?? undefined,
    providerSource: profileSettings.providerSource ?? undefined,
    executionContext: params.executionContext,
  });

  const { harnessId, providerConfig: runnerProviderConfig } =
    await resolveRunnerHarness({
      registry: context.registry,
      stepOverride: params.spawnParams.harness_override,
      projectDefault: scoped.harnessId,
      providerConfig,
      resolvedModel: profileSettings.model,
      aiConfig: context.aiConfig,
      scopeNodeId: params.scopeNodeId,
      ledger: context.ledger,
    });

  const systemPrompt = await buildSubagentSystemPrompt(
    context,
    params,
    profileSettings.systemPrompt,
    skillDiscoveryMode,
    harnessId,
  );

  const baseConfig: HarnessRuntimeConfig = {
    harnessId,
    model: {
      provider: runnerProviderConfig.provider,
      model: profileSettings.model,
      auth: runnerProviderConfig.auth,
      baseUrl: runnerProviderConfig.baseUrl,
      providerConfig: runnerProviderConfig.providerConfig,
    },
    prompt: {
      systemPrompt,
      initialPrompt: params.spawnParams.task_prompt,
    },
  };

  // Subagents have no step-input override path, so precedence is
  // agent profile -> model default (mirrors the workflow-step dispatch path).
  await resolveAndApplyThinkingLevel({
    baseConfig,
    resolver: context.thinkingLevelResolver,
    agentProfileName: params.spawnParams.agent_profile,
    stepInputRaw: undefined,
    modelId: profileSettings.model,
    provider: runnerProviderConfig.provider,
    providerConfig: runnerProviderConfig.providerConfig,
    harnessSupportsThinkingLevels:
      context.registry.resolve?.(harnessId)?.capabilities
        ?.supportsThinkingLevels ?? false,
    aiConfig: context.aiConfig,
    ledger: context.ledger,
  });

  const finalConfig = await applySubagentContributions(
    context,
    params,
    harnessId,
    baseConfig,
  );

  await context.runnerConfigStore.store(
    params.spawnParams.workflowRunId,
    params.executionId,
    finalConfig,
  );

  return {
    harnessId,
    provider: runnerProviderConfig.provider,
    model: profileSettings.model,
  };
}

/**
 * Resolve the subagent's authored contributions (from its agent profile) and
 * attach them to the runner config when the resolved harness exposes
 * capabilities to validate against. Subagents have no step-input override path,
 * so the profile is the only contribution source.
 */
async function applySubagentContributions(
  context: SubagentContainerConfigContext,
  params: SubagentConfigParams,
  harnessId: HarnessId,
  baseConfig: HarnessRuntimeConfig,
): Promise<HarnessRuntimeConfig> {
  const capabilities = context.registry.resolve?.(harnessId)?.capabilities;
  if (!capabilities) return baseConfig;

  const profile = params.spawnParams.agent_profile
    ? await context.aiConfig.getAgentProfileByName(
        params.spawnParams.agent_profile,
      )
    : null;

  const sources = gatherContributionSources({
    profile: profile?.harness_contributions ?? undefined,
  });

  return attachResolvedContributions(baseConfig, {
    harnessId,
    capabilities,
    sources,
    ledger: context.ledger,
  });
}

/**
 * Builds the subagent system prompt via the shared universal-layer builder,
 * giving subagents the same memory-capture-guidance, runtime/scope context,
 * and promoted-learning injection that workflow steps receive.
 *
 * Skill injection follows the same mode semantics as the step path:
 * - `native` mode: full skill content injected inline for all harnesses.
 * - `search` mode on pi/claude-code: base prompt only (harness reads skills natively).
 * - `search` mode on other harnesses: skill-discovery catalog block appended.
 */
export async function buildSubagentSystemPrompt(
  context: SubagentContainerConfigContext,
  params: SubagentConfigParams,
  baseSystemPrompt: string,
  skillDiscoveryMode: ReturnType<typeof resolveSubagentSkillDiscoveryMode>,
  harnessId: HarnessId,
): Promise<string> {
  const hasSearchSkill = params.assignedSkills?.some(
    (s) => s.name === 'search_skills',
  );
  const availableCategories =
    skillDiscoveryMode === 'search'
      ? context.aiConfig.listSkillCategories(
          hasSearchSkill
            ? undefined
            : params.assignedSkills?.map((s) => s.name),
        )
      : undefined;

  // FU-8: resolve the workflow definition name via the already-available
  // workflowRepo + spawn-resolved workflow id — the exact same helper
  // `resolveSubagentProfileAndAssignedSkills` already uses for workflow-scoped
  // skill bindings — so workflow-scoped promoted-learning memories can reach
  // subagents (SubagentPromptContextService has no run/workflow repositories
  // of its own to resolve this internally, unlike the step path's
  // `StepSupportService.buildPromotedLearningContext`).
  const workflowName = await resolveWorkflowNameById(
    context.workflowRepo,
    params.workflowId,
    (message) => {
      context.logger.warn(message);
    },
  );

  const universalCtx: UniversalPromptContext = {
    support: context.support,
    harnessId,
    workflowRunId: params.spawnParams.workflowRunId,
    jobId: params.executionId,
    stepId: params.executionId,
    scopeId: params.scopeNodeId,
    resolvedSystemPrompt: baseSystemPrompt,
    assignedSkills: (params.assignedSkills ?? []).map((s) => ({
      id: s.name,
      name: s.name,
      description: s.description,
      skillMarkdown: s.skillMarkdown,
    })),
    availableCategories,
    skillDiscoveryMode: skillDiscoveryMode ?? DEFAULT_SKILL_DISCOVERY_MODE,
    taskPrompt: params.spawnParams.task_prompt || undefined,
    suppressMemoryCapture: shouldSuppressMemoryCapture(params.workflowId),
    agentProfile: params.spawnParams.agent_profile,
    workflowName,
    runType: 'subagent',
  };

  const universalLayers = await buildUniversalPromptLayers(universalCtx);

  return context.support.assembleAgentSystemPrompt({
    runType: 'subagent',
    harnessId,
    workflowRunId: params.spawnParams.workflowRunId,
    jobId: params.executionId,
    stepId: params.executionId,
    scopeId: params.scopeNodeId,
    agentProfileId: params.spawnParams.agent_profile,
    baseLayers: universalLayers,
  });
}

/**
 * Loads the subagent's agent profile once and derives both its skill
 * discovery mode and its `runtime_toolchains` (layer 2 of the toolchain
 * precedence chain — see `ToolchainResolverService.resolve`). Returning the
 * loaded entity lets `buildSubagentContainerConfigOperation` thread
 * `runtime_toolchains` into the `applyRuntimeToolchains` call below without
 * an additional `getAgentProfileByName` round-trip.
 */
async function resolveSubagentSkillDiscoveryModeForProfile(
  context: SubagentContainerConfigContext,
  agentProfile: string | undefined,
): Promise<{
  skillDiscoveryMode: ReturnType<typeof resolveSubagentSkillDiscoveryMode>;
  agentProfileConfig?: RuntimeToolchainConfig;
}> {
  const profileEntity = agentProfile
    ? await context.aiConfig.getAgentProfileByName(agentProfile)
    : null;
  return {
    skillDiscoveryMode: resolveSubagentSkillDiscoveryMode(
      profileEntity?.skill_discovery_mode ?? null,
    ),
    agentProfileConfig: profileEntity?.runtime_toolchains ?? undefined,
  };
}

export async function buildSubagentContainerConfigOperation(
  context: SubagentContainerConfigContext,
  params: SubagentConfigParams,
): Promise<SubagentContainerConfigResult> {
  const tier = resolveSubagentContainerTier(
    params.spawnParams.tier,
    params.parentTier,
  );

  const { skillDiscoveryMode, agentProfileConfig } =
    await resolveSubagentSkillDiscoveryModeForProfile(
      context,
      params.spawnParams.agent_profile,
    );

  // Apply profileAllowed ∩ requestedTools intersection before writing the
  // SDK allowlist or the JWT. This is a defense-in-depth layer: the primary
  // filter runs in WorkflowRuntimeSubagentToolsService before spawn is called,
  // but this ensures the JWT and allowlist are always consistent with the
  // subagent's profile even when buildSubagentContainerConfigOperation is
  // invoked directly (e.g. from tests or future callers).
  const profileAllowed = resolveSubagentProfileAllowedSet(
    params.spawnParams.tools,
    params.spawnParams.agent_profile,
    context,
  );
  const intersectedTools = resolveAllowedToolNamesForExecution({
    requestedTools: params.spawnParams.tools,
    profileAllowed,
    companionRules: DEFAULT_COMPANION_RULES,
  });
  const subagentTools = filterSearchSkillForMode(
    intersectedTools,
    skillDiscoveryMode,
  );
  const token = buildSubagentJwtToken(context, params, subagentTools);

  const runtime = await resolveAndStageSubagentRunnerConfig(
    context,
    params,
    skillDiscoveryMode,
  );

  const toolMountPath = provisionSubagentToolMount(
    context,
    params.executionId,
    params.spawnParams,
    subagentTools,
  );
  const resolvedEntry = context.registry.resolve?.(runtime.harnessId);
  const capabilities = resolvedEntry?.capabilities;
  const harnessDefaultEnv = resolvedEntry?.defaultEnv ?? {};

  const configuredVolumes = buildSubagentVolumes({
    hostMountBindings: params.hostMountBindings,
    skillMountPath: params.skillMountPath,
    toolMountPath,
    containerSkillsPath: capabilities?.skillsContainerPath,
  });

  const config: IContainerConfig = {
    image: resolveSubagentImage(tier),
    tier,
    env: {
      ...harnessDefaultEnv,
      WORKFLOW_RUN_ID: params.spawnParams.workflowRunId,
      STEP_ID: params.executionId,
      JOB_ID: params.executionId,
      AGENT_JWT: token,
      WEBSOCKET_URL: process.env.WEBSOCKET_URL || DEFAULT_WEBSOCKET_URL,
      API_BASE_URL: process.env.API_BASE_URL || DEFAULT_API_BASE_URL,
      WORKSPACE_PATH: '/workspace',
      EXTENSIONS_PATH: CONTAINER_EXTENSIONS_PATH,
      SESSION_PATH: CONTAINER_SESSION_PATH,
      HARNESS_ID: runtime.harnessId,
      PARENT_CONTAINER_ID: params.parentContainerId,
    },
    labels: {
      'nexus.managed': 'true',
      'nexus.workflow_run_id': params.spawnParams.workflowRunId,
      'nexus.job_id': params.executionId,
      'nexus.step_id': params.executionId,
      'nexus.parent_container_id': params.parentContainerId,
      'nexus.tier': tier,
      'nexus.harness_id': runtime.harnessId,
    },
    volumes: configuredVolumes.length > 0 ? configuredVolumes : undefined,
  };

  // Apply the same runtime-toolchain resolution + cache-mount wiring the
  // step path applies (StepAgentContainerSupportService via
  // buildProvisionedAgentContainerConfig) — closes the historical
  // step-vs-subagent divergence for this concern by reusing the identical
  // helper rather than re-implementing it here.
  const finalConfig = await applyRuntimeToolchains({
    config,
    harnessId: runtime.harnessId,
    baseImageRef: config.image,
    resolverInputs: {
      agentProfileConfig,
      workspacePath: params.workspacePath,
    },
    resolver: context.resolver,
    imageResolver: context.imageResolver,
    cacheService: context.cacheService,
  });

  return { config: finalConfig, runtime };
}

/**
 * Resolves the subagent container tier using a 3-step precedence chain:
 * 1. Explicit spawn override (`spawnTier`) — caller requested a specific tier.
 * 2. Parent step tier (`parentStepTier`) — inherit from the spawning step when
 *    no explicit override is given. Not yet populated by the spawn call path;
 *    callers that know the parent tier should pass it via `SubagentConfigParams.parentTier`.
 * 3. Default HEAVY — safe default when neither source is available.
 */
function resolveSubagentContainerTier(
  spawnTier: 'light' | 'heavy' | undefined,
  parentStepTier?: ContainerTier,
): ContainerTier {
  if (spawnTier === 'light') return ContainerTier.LIGHT;
  if (spawnTier === 'heavy') return ContainerTier.HEAVY;
  if (parentStepTier !== undefined) return parentStepTier;
  return ContainerTier.HEAVY;
}

function resolveSubagentImage(tier: ContainerTier): string {
  return tier === ContainerTier.HEAVY
    ? 'nexus-heavy:latest'
    : 'nexus-light:latest';
}

function buildSubagentJwtToken(
  context: SubagentContainerConfigContext,
  params: {
    executionId: string;
    spawnParams: SubagentSpawnParams;
    chatSessionId?: string | null;
  },
  allowedTools: string[] = params.spawnParams.tools,
): string {
  const workflowRunId = params.spawnParams.workflowRunId;
  const subagentExecutionId = params.executionId;
  const parentJobId = params.spawnParams.parent_job_id;

  return signAgentToken(
    {
      sub: `agent:${workflowRunId}:${subagentExecutionId}`,
      workflowRunId,
      role: 'agent',
      roles: ['Agent'],
      stepId: subagentExecutionId,
      jobId: subagentExecutionId,
      agentProfileName: params.spawnParams.agent_profile,
      isSubagent: true,
      subagentExecutionId,
      allowedTools,
      ...(parentJobId ? { parent_job_id: parentJobId } : {}),
      ...(params.chatSessionId ? { chatSessionId: params.chatSessionId } : {}),
    },
    context.jwtSecret,
  );
}

function provisionSubagentToolMount(
  context: SubagentContainerConfigContext,
  executionId: string,
  spawnParams: SubagentSpawnParams,
  tools: string[] = spawnParams.tools,
): string | null {
  if (tools.length === 0) {
    return null;
  }
  const mountDir = path.join(
    os.tmpdir(),
    `nexus-subagent-tools-${executionId}`,
  );
  if (fs.existsSync(mountDir)) {
    fs.rmSync(mountDir, { recursive: true, force: true });
  }
  fs.mkdirSync(mountDir, { recursive: true });
  context.toolMounting.writeSdkToolAllowlist(mountDir, tools, {
    workflowRunId: spawnParams.workflowRunId,
    jobId: executionId,
    stepId: executionId,
  });
  return mountDir;
}

/**
 * Computes the `profileAllowed` set for a subagent spawn by evaluating each
 * candidate tool against the subagent's agent profile policy.
 * When no profile is specified, all tools are permitted (open/unscoped spawn).
 */
function resolveSubagentProfileAllowedSet(
  tools: string[],
  agentProfile: string | undefined,
  context: SubagentContainerConfigContext,
): ReadonlySet<string> {
  if (!agentProfile) {
    return new Set(tools);
  }

  const allowed = new Set<string>();
  for (const tool of tools) {
    if (context.toolMounting.canProfileUseTool(agentProfile, tool)) {
      allowed.add(tool);
    }
  }
  return allowed;
}

function buildSubagentVolumes(params: {
  hostMountBindings?: IHostMountBinding[];
  skillMountPath?: string | null;
  toolMountPath?: string | null;
  containerSkillsPath?: string;
}): Array<{ hostPath: string; containerPath: string; readOnly: boolean }> {
  return [
    ...(params.hostMountBindings ?? []).map((binding) => ({
      hostPath: binding.hostPath,
      containerPath: binding.containerPath,
      readOnly: binding.readOnly,
    })),
    ...(params.skillMountPath
      ? [
          {
            hostPath: params.skillMountPath,
            containerPath: params.containerSkillsPath ?? CONTAINER_SKILLS_ROOT,
            readOnly: true,
          },
        ]
      : []),
    ...(params.toolMountPath
      ? [
          {
            hostPath: params.toolMountPath,
            containerPath: CONTAINER_EXTENSIONS_PATH,
            readOnly: true,
          },
        ]
      : []),
  ];
}
