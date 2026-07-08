import type { Logger } from '@nestjs/common';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import type { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import type { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import type { SubagentExecutionReadModel } from './subagent-execution-read-model';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import type { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import type { ContainerHttpClientService } from '../../docker/container-http-client.service';
import type { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import type { RunnerConfigStoreService } from '../../redis/runner-config-store.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { SkillMountingService } from '../../tool-runtime/skill-mounting.service';
import type { ToolMountingService } from '../../tool-runtime/tool-mounting.service';
import type { HostMountResolutionService } from '../workflow-host-mount/host-mount-resolution.service';
import type { WorkflowStageSkillPolicyService } from '../workflow-stage-skill-policy.service';
import type { GitWorktreeService } from '../../common/git/git-worktree.service';
import type { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import type { HarnessId, IContainerConfig } from '@nexus/core';
import type { ScopedAiDefaultResolver } from '../../harness/scoped-ai-default-resolver';
import type { HarnessSelectionRegistry } from '../../harness/harness-runtime-selection.types';
import type { WaitForSubagentsResult } from './subagent-orchestrator.types';
import type { SubagentContainerLivenessProbe } from '../../execution-lifecycle/subagent-container-liveness.probe';
import type { ThinkingLevelResolverLike } from '../workflow-step-execution/step-agent-step-executor.helpers.types';
import type { PromptContextSupportLike } from '../agent-prompt/universal-prompt-context.types';
import type { ToolchainResolverService } from '../workflow-runtime-toolchains/toolchain-resolver.service';
import type { HarnessImageResolver } from '../workflow-runtime-toolchains/harness-image-resolver.service';
import type { PackageCacheVolumeService } from '../workflow-runtime-toolchains/package-cache-volume.service';
import type { WorkflowRepository } from '../database/repositories/workflow.repository';
import type {
  SkillCatalogLister,
  WorkflowSkillBindingLister,
} from '../agent-prompt/agent-assigned-skills.types';
import type {
  ChatSessionDomainPort,
  IChatSessionRepositoryPort,
  ISubagentChatSessionPort,
} from '../domain-ports';

/**
 * Narrow surfaces of the runtime-toolchain services consumed by
 * {@link applyRuntimeToolchains} on the subagent provisioning path — mirrors
 * the step path's wiring in `StepAgentContainerSupportService` so both paths
 * share the exact same helper instead of re-implementing the concern.
 */
type SubagentToolchainResolver = Pick<ToolchainResolverService, 'resolve'>;
type SubagentHarnessImageResolver = Pick<
  HarnessImageResolver,
  'resolveImageRef'
>;
type SubagentPackageCacheVolumeService = Pick<
  PackageCacheVolumeService,
  'resolveCacheMounts'
>;

type SubagentContainerAiConfig = Pick<
  AiConfigurationService,
  | 'resolveStepSettings'
  | 'resolveRunnerProviderConfig'
  | 'listSkillCategories'
  | 'getAgentProfileByName'
  | 'getModelDefaultThinkingLevel'
>;

type SubagentRunnerConfigStore = Pick<RunnerConfigStoreService, 'store'>;

type SubagentScopedDefaults = Pick<ScopedAiDefaultResolver, 'resolve'>;

type SubagentSelectionLedger = {
  emitBestEffort: (payload: unknown) => unknown;
};

export interface SubagentLifecycleEventParams {
  eventName: string;
  outcome: 'success' | 'failure' | 'in_progress';
  workflowRunId?: string;
  parentContainerId?: string;
  subagentExecutionId?: string;
  payload?: Record<string, unknown>;
  error?: unknown;
}

export interface SubagentSpawnOperationsContext {
  logger: Logger;
  jwtSecret: string;
  subagentDetailsRepo: SubagentDetailsRepository;
  subagentReadModel: SubagentExecutionReadModel;
  chatSessionRepo: IChatSessionRepositoryPort;
  containerOrchestrator: ContainerOrchestratorService;
  runRepo: IWorkflowRunRepository;
  workflowRepo: Pick<WorkflowRepository, 'findById'>;
  aiConfig: AiConfigurationService;
  stageSkillPolicy: WorkflowStageSkillPolicyService;
  /** Resolves runtime workflow/step skill bindings (Task 4 anti-divergence wiring). */
  workflowSkillBindings: WorkflowSkillBindingLister;
  /** Resolves the full skill catalog for hydrating binding-only skill names. */
  skillCatalog: SkillCatalogLister;
  runnerConfigStore: RunnerConfigStoreService;
  containerHttpClient: ContainerHttpClientService;
  systemSettings: SystemSettingsService;
  skillMounting: SkillMountingService;
  toolMounting: ToolMountingService;
  hostMountResolution: HostMountResolutionService;
  agentProfileRepo: AgentProfileRepository;
  gitWorktreeService: GitWorktreeService;
  registry: HarnessSelectionRegistry;
  scopedDefaults: SubagentScopedDefaults;
  thinkingLevelResolver?: ThinkingLevelResolverLike;
  ledger?: SubagentSelectionLedger;
  /** Provides promoted-learning context and system-prompt assembly for subagent prompts. */
  support: PromptContextSupportLike;
  /** Resolves the effective runtime toolchain config (step/profile/run/detected/base precedence). */
  resolver: SubagentToolchainResolver;
  /** Resolves the harness image ref (base or composite) for the resolved toolchain config. */
  imageResolver: SubagentHarnessImageResolver;
  /** Ensures package/OS cache volumes exist and returns their mount/env wiring. */
  cacheService: SubagentPackageCacheVolumeService;
  resolveContainerIpAddress: (containerId: string) => Promise<string>;
  emitSubagentLifecycleEvent: (
    params: SubagentLifecycleEventParams,
  ) => Promise<void>;
  resolveErrorMessage: (error: unknown) => string;
  runParentContainerExclusive: <T>(
    parentContainerId: string,
    task: () => Promise<T>,
  ) => Promise<T>;
  executionEvents: ExecutionEventPublisher;
  sessionHydration: Pick<ChatSessionDomainPort, 'injectSessionIntoContainer'>;
  /** Owns the create-row path for new subagent chat sessions (parent lookup + payload assembly live in the port). */
  subagentChatSessionPort: ISubagentChatSessionPort;
}

type SubagentToolMounting = Pick<
  ToolMountingService,
  'writeSdkToolAllowlist' | 'canProfileUseTool'
>;

export interface SubagentContainerConfigContext {
  jwtSecret: string;
  aiConfig: SubagentContainerAiConfig;
  runnerConfigStore: SubagentRunnerConfigStore;
  toolMounting: SubagentToolMounting;
  registry: HarnessSelectionRegistry;
  scopedDefaults: SubagentScopedDefaults;
  thinkingLevelResolver?: ThinkingLevelResolverLike;
  ledger?: SubagentSelectionLedger;
  /** Provides promoted-learning context and system-prompt assembly for subagent prompts. */
  support: PromptContextSupportLike;
  /** Resolves the effective runtime toolchain config (step/profile/run/detected/base precedence). */
  resolver: SubagentToolchainResolver;
  /** Resolves the harness image ref (base or composite) for the resolved toolchain config. */
  imageResolver: SubagentHarnessImageResolver;
  /** Ensures package/OS cache volumes exist and returns their mount/env wiring. */
  cacheService: SubagentPackageCacheVolumeService;
  /**
   * Resolves the workflow definition name for the promoted-learning recall
   * identity (FU-8) — mirrors the read already used for workflow-scoped
   * skill bindings (`resolveSubagentProfileAndAssignedSkills`).
   */
  workflowRepo: Pick<WorkflowRepository, 'findById'>;
  /** Fail-soft logging sink for the workflowName lookup above. */
  logger: Pick<Logger, 'warn'>;
}

/**
 * Resolved harness/provider/model the subagent will run on. Surfaced to the
 * caller so it can be persisted (chat session + lifecycle events) for
 * debuggability — the historical hardcoded `pi` harness made it impossible to
 * tell from the database which runtime a failed subagent used.
 */
export interface SubagentRuntimeSelection {
  harnessId: HarnessId;
  provider: string;
  model: string;
}

export interface SubagentContainerConfigResult {
  config: IContainerConfig;
  runtime: SubagentRuntimeSelection;
}

export interface SubagentCoordinationOperationsContext {
  subagentDetailsRepo: SubagentDetailsRepository;
  subagentReadModel: SubagentExecutionReadModel;
  chatSessionRepo?: Pick<IChatSessionRepositoryPort, 'update'>;
  containerOrchestrator: ContainerOrchestratorService;
  skillMounting: SkillMountingService;
  emitSubagentLifecycleEvent: (
    params: SubagentLifecycleEventParams,
  ) => Promise<void>;
  executionEvents: ExecutionEventPublisher;
  liveness: Pick<SubagentContainerLivenessProbe, 'isContainerLost'>;
  logger: Pick<Logger, 'warn'>;
}

export interface WaitLifecycleEventOperationParams {
  parentContainerId: string;
  result: WaitForSubagentsResult;
}

export type FindLatestSubagentTurn = (params: {
  workflowRunId: string;
  stepId: string;
}) => Promise<EventLedger | null>;
