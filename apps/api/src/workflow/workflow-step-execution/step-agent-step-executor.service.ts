import { Injectable, Inject, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  WorkflowStatus,
  type IJob,
  type IJobStep,
  type HarnessRuntimeConfig,
} from '@nexus/core';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';
import { ContainerHttpClientService } from '../../docker/container-http-client.service';
import {
  CHAT_SESSION_DOMAIN_PORT,
  type ChatSessionDomainPort,
} from '../domain-ports';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { JobQueueData } from './step-execution.types';
import { StepEventPublisherService } from './step-event-publisher.service';
import { StepSupportService } from './step-support.service';
import { StrategicIntentPromptContextProvider } from './strategic-intent-prompt-context.provider';
import { StateManagerService } from '../state-manager.service';
import { StepContainerRuntimeService } from './step-container-runtime.service';
import { RunnerConfigStoreService } from '../../redis/runner-config-store.service';
import { StepExecutionService } from './step-execution.service';
import {
  executeJobCore,
  type JobExecutionDependencies,
} from './step-agent-step-executor.multistep';
import {
  publishTurnEndAndCompleteCore,
  publishTurnEndCore,
} from './step-agent-step-executor.completion';
import { StepRequiredToolRetryService } from './step-required-tool-retry.service';
import {
  buildStepRunnerConfigPayloadCore,
  checkRequiredToolRetryForJobCore,
  injectPreviousSessionCore,
  resolveExecutionIdentifiersCore,
  retryJobCarryingWorkflowSkillsCore,
  saveSessionAndUpdateResourceCore,
} from './step-agent-step-executor.helpers';
import {
  cleanupJobContainerCore,
  startContainerAndStreamLogsForJobCore,
} from './step-agent-step-executor.container-lifecycle.helpers';
import { StepAgentContainerSupportService } from './step-agent-container-support.service';
import { WORKFLOW_ENGINE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowRunHeartbeatService } from '../workflow-run-operations/workflow-run-heartbeat.service';
import { ExecutionHeartbeatService } from '../../execution-lifecycle/execution-heartbeat.service';
import { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import { AgentProfileResolutionService } from '../../ai-config/services/agent-profile-resolution.service';
import { ThinkingLevelResolver } from '../../ai-config/services/thinking-level-resolver.service';
import { ScopedAiDefaultResolver } from '../../harness/scoped-ai-default-resolver';
import { FALLBACK_HARNESS_ID } from '../../harness/harness-selection';
import { extractScopeNodeIdFromTriggerState } from './step-support.helpers';
import { loadInSessionTransientRetryConfig } from './step-agent-retry-config.service.helpers';
import { shouldSuppressMemoryCapture } from './step-support-memory-capture.helpers';
import { AgentAwaitRepository } from '../workflow-await/agent-await.repository';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { registerAsyncDispatch } from './async-dispatch-registry';
import { ProviderFallbackService } from '../../ai-config/fallback/provider-fallback.service';
import {
  buildFallbackAdvanceDeps,
  parseFallbackChain,
  FALLBACK_CHAINS_ENABLED_KEY,
} from './step-agent-fallback-advance';
import { AgentSkillsService } from '../../ai-config/services/agent-skills.service';
import { WorkflowSkillBindingService } from '../workflow-skill-bindings/workflow-skill-binding.service';
import {
  buildFirstStepRunnerConfigResolver,
  provisionContainerForJobCore,
  resolveStepSkillsAndDiscoveryContext,
} from './step-agent-effective-skills.helpers';
import type { BuildStepRunnerConfigCallbacks } from './step-agent-step-executor.helpers.types';

type CreateJobExecParams = {
  data: JobQueueData;
  workflowRunId: string;
  jobId: string;
  job: IJob;
  stateVariables: Record<string, unknown>;
  mountKey: string;
  stepId: string;
  executionId?: string;
};

@Injectable()
export class StepAgentStepExecutorService {
  private readonly logger = new Logger(StepAgentStepExecutorService.name);
  private resolvedWorkflowEngine: IWorkflowEngineService | null = null;

  constructor(
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    private readonly containerHttpClient: ContainerHttpClientService,
    private readonly aiConfig: AiConfigurationService,
    private readonly eventPublisher: StepEventPublisherService,
    private readonly support: StepSupportService,
    private readonly containerRuntime: StepContainerRuntimeService,
    private readonly stateManager: StateManagerService,
    private readonly stepExecutionService: StepExecutionService,
    private readonly requiredToolRetry: StepRequiredToolRetryService,
    @Inject(CHAT_SESSION_DOMAIN_PORT)
    private readonly sessionHydration: ChatSessionDomainPort,
    private readonly containerSupport: StepAgentContainerSupportService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly strategicIntentContext: StrategicIntentPromptContextProvider,
    private readonly runHeartbeat: WorkflowRunHeartbeatService,
    private readonly executionHeartbeat: ExecutionHeartbeatService,
    private readonly executionEventPublisher: ExecutionEventPublisher,
    private readonly settings: SystemSettingsService,
    private readonly harnessRegistry: HarnessProviderRegistryService,
    private readonly scopedDefaults: ScopedAiDefaultResolver,
    private readonly moduleRef: ModuleRef,
    private readonly runnerConfigStore: RunnerConfigStoreService,
    private readonly agentAwaitRepository: AgentAwaitRepository,
    private readonly executionRepo: ExecutionRepository,
    private readonly agentProfileResolution: AgentProfileResolutionService,
    private readonly thinkingLevelResolver: ThinkingLevelResolver,
    private readonly providerFallback: ProviderFallbackService,
    private readonly agentSkills: AgentSkillsService,
    private readonly workflowSkillBindings: WorkflowSkillBindingService,
  ) {}

  private async shouldContinueInSessionRetry(
    workflowRunId: string,
  ): Promise<boolean> {
    const run = await this.runRepo.findById(workflowRunId);
    return run?.status === WorkflowStatus.RUNNING;
  }

  private getWorkflowEngine(): IWorkflowEngineService {
    if (this.resolvedWorkflowEngine) {
      return this.resolvedWorkflowEngine;
    }

    if (
      this.workflowEngine &&
      typeof this.workflowEngine.handleJobComplete === 'function'
    ) {
      this.resolvedWorkflowEngine = this.workflowEngine;
      return this.workflowEngine;
    }

    const engineService = this.moduleRef.get<IWorkflowEngineService>(
      WORKFLOW_ENGINE_SERVICE,
      { strict: false },
    );
    if (
      engineService &&
      typeof engineService.handleJobComplete === 'function'
    ) {
      this.resolvedWorkflowEngine = engineService;
      return engineService;
    }

    throw new Error(
      'Workflow engine service is not available in step executor',
    );
  }

  private async publishTurnEndAndComplete(
    workflowRunId: string,
    jobId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    await publishTurnEndAndCompleteCore({
      workflowEngine: this.getWorkflowEngine(),
      eventPublisher: this.eventPublisher,
      workflowRunId,
      jobId,
      output,
    });
  }

  private async publishTurnEnd(
    workflowRunId: string,
    jobId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    await publishTurnEndCore({
      eventPublisher: this.eventPublisher,
      workflowRunId,
      jobId,
      output,
    });
  }

  async executeJob(
    data: JobQueueData,
    bullJobId: string | number | undefined,
    stateVariables: Record<string, unknown>,
    resolvedJobInputs: Record<string, unknown>,
    executionId?: string,
  ): Promise<unknown> {
    const { workflowRunId, jobId, job } = data;
    const { mountKey, stepId } = resolveExecutionIdentifiersCore(
      workflowRunId,
      jobId,
      job,
      bullJobId,
    );

    await this.stateManager.setVariable(
      workflowRunId,
      '_internal.current_job_id',
      jobId,
    );

    const deps = this.createJobExecutionDependencies({
      data,
      workflowRunId,
      jobId,
      job,
      stateVariables,
      mountKey,
      stepId,
      executionId,
    });

    return executeJobCore({
      data,
      bullJobId,
      stateVariables,
      resolvedJobInputs,
      deps,
    });
  }

  private createJobExecutionDependencies(
    params: CreateJobExecParams,
  ): JobExecutionDependencies {
    const { executionId } = params;
    const fb = buildFallbackAdvanceDeps(
      this.providerFallback,
      (args) =>
        retryJobCarryingWorkflowSkillsCore(
          this.getWorkflowEngine(),
          params.data,
          args,
        ),
      () => this.settings.get<boolean>(FALLBACK_CHAINS_ENABLED_KEY, true),
    );
    // Captured by buildStepRunnerConfig once the runner config build resolves
    // an agent profile, then read by persistResolvedConfigBestEffort so the
    // executions row records the profile that actually ran the step (the
    // retrospective analyst's fallback acting-profile source for runs that
    // never spawn a subagent / chat session — see
    // RetrospectiveAnalysisService.resolveActingAgentProfiles).
    let resolvedAgentProfile: {
      id: string | null;
      name: string | null;
    } | null = null;
    return {
      provisionContainer: (d, vars) =>
        this.provisionContainerForJob(d, vars, params.stepId, params.mountKey),
      notifyContainerProvisioned: executionId
        ? (containerId) =>
            this.executionEventPublisher.provisioned(executionId, containerId)
        : undefined,
      injectSession: (containerId, resumeSessionTreeId) =>
        this.injectPreviousSession(
          containerId,
          params.stateVariables,
          resumeSessionTreeId,
        ),
      startContainerAndStreamLogs: (c, r, j) =>
        this.startContainerAndStreamLogsForJob(c, r, j, params),
      fetchContainerLogSnapshot: (containerId) =>
        this.containerSupport.fetchContainerLogSnapshot(containerId),
      isContainerRunning: (containerId) =>
        this.containerSupport.isContainerRunning(containerId),
      getContainerIp: (containerId) =>
        this.containerSupport.getContainerIpAddress(containerId),
      buildStepRunnerConfig: async (d, step, inputs, vars) => {
        const c = await this.buildStepRunnerConfigPayload(
          d,
          step,
          inputs,
          vars,
          {
            onProfileChainResolved: (chain) => {
              fb.captureProfileChain(chain);
            },
            onProfileResolved: (profile) => {
              resolvedAgentProfile = profile;
            },
          },
        );
        fb.captureProvider(
          c.model.provider,
          c.model.model,
          parseFallbackChain(inputs.fallback_chain),
        );
        return c;
      },
      persistResolvedConfig: executionId
        ? (patch) => this.executionRepo.updateResolvedConfig(executionId, patch)
        : undefined,
      getResolvedAgentProfile: () => resolvedAgentProfile,
      stepExecutionService: this.stepExecutionService,
      containerHttpClient: this.containerHttpClient,
      workflowEngine: this.getWorkflowEngine(),
      publishTurnEndAndComplete: (runId, jId, output) =>
        this.publishTurnEndAndComplete(runId, jId, output),
      publishTurnEnd: (runId, jId, output) =>
        this.publishTurnEnd(runId, jId, output),
      publishProcessEvent: (runId, eventType, payload) =>
        this.eventPublisher.publishProcessEvent(runId, eventType, payload),
      checkRequiredToolRetry: (containerId) =>
        checkRequiredToolRetryForJobCore(
          this.requiredToolRetry,
          params,
          containerId,
        ),
      recordHeartbeat: () => {
        this.runHeartbeat.recordActivity(params.workflowRunId);
        if (params.executionId) {
          this.executionHeartbeat.recordActivity(
            params.executionId,
            'command_inflight',
          );
        }
      },
      saveSession: (containerId) =>
        this.saveSessionAndUpdateResource(
          containerId,
          params.workflowRunId,
          params.stateVariables,
        ),
      persistProducedSessionRef: (workflowRunId, ref) =>
        this.agentAwaitRepository.updateParentSessionRef(workflowRunId, ref),
      killStaleContainers: (runId: string, jId: string) =>
        this.containerSupport.killStaleContainersForJob(runId, jId),
      getInSessionTransientRetryConfig: () =>
        loadInSessionTransientRetryConfig(this.settings),
      shouldContinueInSessionRetry: (runId) =>
        this.shouldContinueInSessionRetry(runId),
      tryFallbackAdvance: fb.advance,
      cleanup: (c, s) => this.cleanupJobContainer(c, s, params),
      awaitAsyncDispatch: (runId, sId) => registerAsyncDispatch(runId, sId),
      warn: (message) => {
        this.logger.warn(message);
      },
      log: (message) => {
        this.logger.log(message);
      },
    };
  }

  private async startContainerAndStreamLogsForJob(
    containerId: string,
    runId: string,
    jobId: string,
    params: CreateJobExecParams,
  ): Promise<() => void> {
    return startContainerAndStreamLogsForJobCore({
      containerId,
      runId,
      jobId,
      executionId: params.executionId,
      containerSupport: this.containerSupport,
      containerRuntime: this.containerRuntime,
      runHeartbeat: this.runHeartbeat,
      executionHeartbeat: this.executionHeartbeat,
    });
  }

  private async cleanupJobContainer(
    containerId: string,
    stopLogStreaming: (() => void) | null,
    params: CreateJobExecParams,
  ): Promise<void> {
    await cleanupJobContainerCore({
      containerId,
      stopLogStreaming,
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      stepId: params.stepId,
      mountKey: params.mountKey,
      stateVariables: params.stateVariables,
      support: this.support,
      containerSupport: this.containerSupport,
    });
  }

  private async provisionContainerForJob(
    data: JobQueueData,
    vars: Record<string, unknown>,
    stepId: string,
    mountKey: string,
  ): Promise<string> {
    const resolvedJobInputs = this.support.resolveJobInputs(
      data.job.inputs,
      vars,
    );
    const firstStep = Array.isArray(data.job.steps)
      ? data.job.steps[0]
      : undefined;

    // Publish the runner config to Redis before the container starts (the
    // harness kernel's `configure` handshake needs it on connect) and thread
    // the same effective skill set that build resolves straight to the
    // container mount, instead of letting the mount re-resolve a
    // profile-only list on its own (FU-7).
    return provisionContainerForJobCore({
      fallbackHarnessId: FALLBACK_HARNESS_ID,
      buildRunnerConfig: buildFirstStepRunnerConfigResolver({
        firstStep,
        buildStepRunnerConfigPayload: (step, onAssignedSkillsResolved) =>
          this.buildStepRunnerConfigPayload(
            data,
            step,
            resolvedJobInputs,
            vars,
            { onAssignedSkillsResolved },
          ),
      }),
      storeRunnerConfig: (config) =>
        this.runnerConfigStore.store(data.workflowRunId, stepId, config),
      provisionJobContainer: (harnessId, preResolvedAssignedSkills) =>
        this.containerSupport.provisionJobContainer(
          data,
          vars,
          mountKey,
          harnessId,
          preResolvedAssignedSkills,
        ),
    });
  }

  private async buildStepRunnerConfigPayload(
    data: JobQueueData,
    step: IJobStep,
    resolvedJobInputs: Record<string, unknown>,
    stateVariables: Record<string, unknown>,
    callbacks?: BuildStepRunnerConfigCallbacks,
  ): Promise<HarnessRuntimeConfig> {
    let agentProfile = this.support.resolveAgentProfileFromJobInputs(
      resolvedJobInputs,
      data.job,
      stateVariables,
    );
    let profileEntity: AgentProfile | null = null;
    if (agentProfile) {
      profileEntity = await this.aiConfig.getAgentProfileByName(agentProfile);
      agentProfile = profileEntity?.name ?? agentProfile;
    }
    callbacks?.onProfileChainResolved?.(profileEntity?.fallback_chain ?? null);
    if (profileEntity) {
      callbacks?.onProfileResolved?.({
        id: profileEntity.id,
        name: profileEntity.name,
      });
    }
    // Effective skills = profile ∪ workflow YAML/bindings ∪ step YAML/bindings
    // (shared helper — never re-merge inline, see resolveAgentAssignedSkills doc).
    const {
      assignedSkills,
      workflowId,
      skillDiscoveryMode,
      availableCategories,
    } = await resolveStepSkillsAndDiscoveryContext({
      support: this.support,
      workflowSkillBindings: this.workflowSkillBindings,
      skillCatalog: this.agentSkills,
      agentProfile,
      stateVariables,
      workflowRunId: data.workflowRunId,
      stepId: step.id,
      workflowYamlSkills: data.workflowYamlSkills,
      resolvedJobInputs,
      stepSkillDiscoveryMode: step.skill_discovery_mode,
      workflowSkillDiscoveryMode: data.workflowSkillDiscoveryMode,
      agentProfileSkillDiscoveryMode: profileEntity?.skill_discovery_mode,
      listSkillCategories: (ids) => this.aiConfig.listSkillCategories(ids),
    });
    callbacks?.onAssignedSkillsResolved?.(assignedSkills);

    return buildStepRunnerConfigPayloadCore({
      data,
      step,
      resolvedJobInputs,
      stateVariables,
      support: this.support,
      stateManager: this.stateManager,
      aiConfig: this.aiConfig,
      assignedSkills,
      availableCategories,
      skillDiscoveryMode,
      registry: this.harnessRegistry,
      scopedDefaults: this.scopedDefaults,
      scopeNodeId: extractScopeNodeIdFromTriggerState(stateVariables),
      strategicIntentContext: this.strategicIntentContext,
      agentProfileResolution: this.agentProfileResolution,
      suppressMemoryCapture: shouldSuppressMemoryCapture(workflowId),
      thinkingLevelResolver: this.thinkingLevelResolver,
    });
  }

  /**
   * If the trigger data contains a previous session tree ID (from a prior
   * run that was rejected by review), inject that session into the container
   * so the agent resumes with full conversation history.
   */
  private async injectPreviousSession(
    containerId: string,
    stateVariables: Record<string, unknown>,
    resumeSessionTreeId?: string,
  ): Promise<void> {
    await injectPreviousSessionCore({
      containerId,
      stateVariables,
      logger: this.logger,
      sessionHydration: this.sessionHydration,
      resumeSessionTreeId,
    });
  }

  /**
   * Save the container's session tree to the database and store the
   * session tree ID on the work item metadata so it persists across
   * workflow runs (e.g. review rejection → re-implementation).
   */
  private async saveSessionAndUpdateResource(
    containerId: string,
    workflowRunId: string,
    stateVariables: Record<string, unknown>,
  ): Promise<string | null> {
    return saveSessionAndUpdateResourceCore({
      containerId,
      workflowRunId,
      stateVariables,
      sessionHydration: this.sessionHydration,
    });
  }
}
