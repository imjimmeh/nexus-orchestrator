import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Docker from 'dockerode';
import { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import { ContainerHttpClientService } from '../../docker/container-http-client.service';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import { SubagentExecutionReadModel } from './subagent-execution-read-model';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import { RunnerConfigStoreService } from '../../redis/runner-config-store.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { SkillMountingService } from '../../tool-runtime/skill-mounting.service';
import { ToolMountingService } from '../../tool-runtime/tool-mounting.service';
import { HostMountResolutionService } from '../workflow-host-mount/host-mount-resolution.service';
import { GitWorktreeService } from '../../common/git/git-worktree.service';
import { SubagentLifecycleEventService } from './subagent-lifecycle-event.service';
import { SubagentParentLockService } from './subagent-parent-lock.service';
import { BudgetDecisionService } from '../../cost-governance/budget-decision.service';
import { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import { spawnSubagentAsyncOperation } from './subagent-orchestrator.spawn.operations';
import type { SubagentSpawnOperationsContext } from './subagent-orchestrator.operations.types';
import type { SubagentAsyncSpawnParams } from './subagent-orchestrator.types';
import { WorkflowStageSkillPolicyService } from '../workflow-stage-skill-policy.service';
import { resolveContainerIpAddress } from '../workflow-step-execution/step-agent-step-executor.helpers';
import { requireJwtSecret } from '../../config/jwt-runtime-config';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import { ScopedAiDefaultResolver } from '../../harness/scoped-ai-default-resolver';
import { ThinkingLevelResolver } from '../../ai-config/services/thinking-level-resolver.service';
import { SubagentPromptContextService } from './subagent-prompt-context.service';
import { ToolchainResolverService } from '../workflow-runtime-toolchains/toolchain-resolver.service';
import { HarnessImageResolver } from '../workflow-runtime-toolchains/harness-image-resolver.service';
import { PackageCacheVolumeService } from '../workflow-runtime-toolchains/package-cache-volume.service';
import { WorkflowRepository } from '../database/repositories/workflow.repository';
import { WorkflowSkillBindingService } from '../workflow-skill-bindings/workflow-skill-binding.service';
import { AgentSkillsService } from '../../ai-config/services/agent-skills.service';
import {
  CHAT_SESSION_DOMAIN_PORT,
  CHAT_SESSION_REPOSITORY_PORT,
  SUBAGENT_CHAT_SESSION_PORT,
  type ChatSessionDomainPort,
  type IChatSessionRepositoryPort,
  type ISubagentChatSessionPort,
} from '../domain-ports';

/**
 * Owns the subagent spawn flow: depth/profile validation, skill mount
 * resolution, runner-config staging, and container provisioning.
 *
 * Consumed by `SubagentOrchestratorService` (the restored facade at
 * `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`),
 * which delegates the public spawn surface here, giving the provisioning
 * pipeline a focused home with only the dependencies it needs (SRP).
 */
@Injectable()
export class SubagentProvisioningService {
  private readonly logger = new Logger(SubagentProvisioningService.name);
  private readonly jwtSecret = requireJwtSecret();

  constructor(
    private readonly subagentDetailsRepo: SubagentDetailsRepository,
    private readonly subagentReadModel: SubagentExecutionReadModel,
    @Inject(CHAT_SESSION_REPOSITORY_PORT)
    private readonly chatSessionRepo: IChatSessionRepositoryPort,
    private readonly containerOrchestrator: ContainerOrchestratorService,
    private readonly containerHttpClient: ContainerHttpClientService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly aiConfig: AiConfigurationService,
    private readonly stageSkillPolicy: WorkflowStageSkillPolicyService,
    private readonly runnerConfigStore: RunnerConfigStoreService,
    private readonly systemSettings: SystemSettingsService,
    private readonly hostMountResolution: HostMountResolutionService,
    private readonly skillMounting: SkillMountingService,
    private readonly toolMounting: ToolMountingService,
    private readonly agentProfileRepo: AgentProfileRepository,
    private readonly lifecycleEvents: SubagentLifecycleEventService,
    private readonly parentLock: SubagentParentLockService,
    private readonly gitWorktreeService: GitWorktreeService,
    private readonly harnessRegistry: HarnessProviderRegistryService,
    private readonly scopedDefaults: ScopedAiDefaultResolver,
    private readonly thinkingLevelResolver: ThinkingLevelResolver,
    private readonly subagentPromptContext: SubagentPromptContextService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly executionEventPublisher: ExecutionEventPublisher,
    @Inject(CHAT_SESSION_DOMAIN_PORT)
    private readonly sessionHydration: ChatSessionDomainPort,
    @Inject(SUBAGENT_CHAT_SESSION_PORT)
    private readonly subagentChatSessionPort: ISubagentChatSessionPort,
    private readonly toolchainResolver: ToolchainResolverService,
    private readonly harnessImageResolver: HarnessImageResolver,
    private readonly packageCacheVolumeService: PackageCacheVolumeService,
    private readonly workflowRepo: WorkflowRepository,
    private readonly workflowSkillBindings: WorkflowSkillBindingService,
    private readonly agentSkills: AgentSkillsService,
    @Optional() private readonly budgetDecisionService?: BudgetDecisionService,
  ) {}

  async spawn(
    parentContainerId: string,
    params: SubagentAsyncSpawnParams,
  ): Promise<string> {
    await this.checkSubagentBudget(
      params.workflowRunId,
      parentContainerId,
      null,
      null,
    );

    return spawnSubagentAsyncOperation(
      this.createSpawnOperationsContext(),
      parentContainerId,
      params,
    );
  }

  private async checkSubagentBudget(
    parentRunId: string,
    subagentId: string,
    providerName: string | null,
    modelName: string | null,
  ): Promise<void> {
    try {
      const result = await this.budgetDecisionService?.evaluateAction({
        scopeId: null,
        contextType: 'workflow_run',
        contextId: parentRunId,
        actionType: 'subagent_spawn',
        actorType: 'subagent',
        actorId: subagentId,
        providerName,
        modelName,
        expectedTokens: null,
        correlationId: parentRunId,
      });
      if (result?.decision === 'deny') {
        throw new Error(
          `Subagent spawn blocked by budget policy: ${result.reasonCode}`,
        );
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('blocked by budget policy')
      ) {
        throw err;
      }
    }
  }

  private createSpawnOperationsContext(): SubagentSpawnOperationsContext {
    return {
      logger: this.logger,
      jwtSecret: this.jwtSecret,
      subagentDetailsRepo: this.subagentDetailsRepo,
      subagentReadModel: this.subagentReadModel,
      chatSessionRepo: this.chatSessionRepo,
      containerOrchestrator: this.containerOrchestrator,
      runRepo: this.runRepo,
      workflowRepo: this.workflowRepo,
      aiConfig: this.aiConfig,
      stageSkillPolicy: this.stageSkillPolicy,
      workflowSkillBindings: this.workflowSkillBindings,
      skillCatalog: this.agentSkills,
      runnerConfigStore: this.runnerConfigStore,
      containerHttpClient: this.containerHttpClient,
      systemSettings: this.systemSettings,
      skillMounting: this.skillMounting,
      toolMounting: this.toolMounting,
      hostMountResolution: this.hostMountResolution,
      agentProfileRepo: this.agentProfileRepo,
      gitWorktreeService: this.gitWorktreeService,
      registry: this.harnessRegistry,
      scopedDefaults: this.scopedDefaults,
      thinkingLevelResolver: this.thinkingLevelResolver,
      support: this.subagentPromptContext,
      resolver: this.toolchainResolver,
      imageResolver: this.harnessImageResolver,
      cacheService: this.packageCacheVolumeService,
      resolveContainerIpAddress: (containerId) =>
        resolveContainerIpAddress(this.docker, containerId),
      emitSubagentLifecycleEvent: (eventParams) =>
        this.lifecycleEvents.emit(eventParams),
      resolveErrorMessage: (error) =>
        this.lifecycleEvents.resolveErrorMessage(error),
      runParentContainerExclusive: (parentId, task) =>
        this.parentLock.runExclusive(parentId, task),
      executionEvents: this.executionEventPublisher,
      sessionHydration: this.sessionHydration,
      subagentChatSessionPort: this.subagentChatSessionPort,
    };
  }
}
