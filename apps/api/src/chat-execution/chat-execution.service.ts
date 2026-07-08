import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
/* eslint-disable max-lines */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ChatSessionStatus,
  ContainerTier,
  IContainerConfig,
  ChatSessionJobData,
  SDK_NATIVE_TOOL_NAMES,
  PI_CAPABILITIES,
  CLAUDE_CODE_CAPABILITIES,
} from '@nexus/core';
import { Queue } from 'bullmq';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { ContainerOrchestratorService } from '../docker/container-orchestrator.service';
import { ChatSessionContextService } from '../session/chat-session-context.service';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import type {
  ResolvedAgentSettings,
  ResolvedRunnerProviderConfig,
} from '../ai-config/ai-configuration.service';
import { ToolMountingService } from '../tool-runtime/tool-mounting.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { BudgetDecisionService } from '../cost-governance/budget-decision.service';
import { classifyProviderTransientFailure } from '../llm/provider-transient-failure.helpers';
import type { ProviderUsageLimit } from '../llm/provider-transient-failure.types';
import {
  getChatSessionAutoRetryConfig,
  resolveChatSessionAutoRetryDecision,
} from './chat-session-auto-retry.helpers';
import { AgentTokenService } from './agent-token.service';
import { ContainerConfigBuilderService } from './container-config-builder.service';
import { ExecutionDispatchService } from '../execution-lifecycle/execution-dispatch.service';
import { ChatSession } from '../chat/database/entities/chat-session.entity';
import {
  CHAT_SESSION_FAILED_EVENT,
  CHAT_SESSION_STARTED_EVENT,
} from './chat-session-events.constants';

@Injectable()
export class ChatExecutionService {
  private readonly logger = new Logger(ChatExecutionService.name);

  constructor(
    private readonly chatSessionRepo: ChatSessionRepository,
    private readonly containerOrchestrator: ContainerOrchestratorService,
    private readonly chatSessionContext: ChatSessionContextService,
    private readonly aiConfig: AiConfigurationService,
    private readonly toolMounting: ToolMountingService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly systemSettings: SystemSettingsService,
    private readonly agentTokenService: AgentTokenService,
    private readonly containerConfigBuilder: ContainerConfigBuilderService,
    @InjectQueue('chat-sessions')
    private readonly chatQueue: Queue<ChatSessionJobData>,
    private readonly eventEmitter: EventEmitter2,
    private readonly executionDispatchService: ExecutionDispatchService,
    @Optional()
    private readonly budgetDecisionService?: BudgetDecisionService,
  ) {}

  async executeChatSession(jobData: ChatSessionJobData): Promise<void> {
    const { chatSessionId, initialMessage } = jobData;

    this.logger.log(`Starting chat session execution: ${chatSessionId}`);

    try {
      const session = await this.assertChatSessionExists(chatSessionId);

      const setup = await this.prepareExecutionSetup(jobData);

      await this.checkBudget(
        jobData.chatSessionId,
        setup.providerConfig.provider,
        setup.aiSettings.model,
      );

      await this.chatSessionRepo.update(chatSessionId, {
        status: ChatSessionStatus.RUNNING,
        execution_state: 'running',
        provider: setup.providerConfig.provider,
        model: setup.aiSettings.model,
        system_prompt: setup.aiSettings.systemPrompt,
      });
      this.logger.log(
        `Chat session ${chatSessionId} status transitioned to ${ChatSessionStatus.RUNNING}`,
      );
      this.eventEmitter.emit(CHAT_SESSION_STARTED_EVENT, {
        sessionId: chatSessionId,
        status: ChatSessionStatus.RUNNING,
      });

      // Inject context as first system message before agent execution
      try {
        await this.chatSessionContext.injectContextMessage(chatSessionId);
      } catch (contextError) {
        this.logger.warn(
          `Failed to inject context for session ${chatSessionId}: ${(contextError as Error).message}`,
        );
        // Continue execution even if context injection fails
      }

      const workflowRunId = session.workflow_run_id ?? null;
      const capabilities = this.resolveHarnessThinkingCapabilities(
        session.harness_id,
      );
      const { executionId } = await this.executionDispatchService.dispatch({
        kind: workflowRunId ? 'workflow_chat' : 'adhoc_chat',
        agentProfileName: jobData.agentProfileName,
        capabilities,
        agentConfig: {
          provider: setup.providerConfig.provider ?? '',
          model: setup.aiSettings.model ?? '',
          apiKey: setup.providerConfig.apiKey ?? '',
          auth: setup.providerConfig.auth,
          baseUrl: setup.providerConfig.baseUrl ?? undefined,
          providerConfig: setup.providerConfig.providerConfig ?? undefined,
          systemPrompt: setup.aiSettings.systemPrompt ?? '',
          initialPrompt: initialMessage,
        },
        containerConfig: setup.containerConfig,
        containerTier: jobData.containerTier,
        chatSessionId,
        workflowRunId,
        workspacePath: setup.workspacePath,
      });

      await this.chatSessionRepo.update(chatSessionId, {
        execution_id: executionId,
      });

      this.logger.log(
        `Chat session ${chatSessionId} dispatched with execution ${executionId} (fire-and-poll)`,
      );
    } catch (error) {
      const executionError = error as Error;
      const retryScheduled = await this.tryScheduleRetry({
        jobData,
        error: executionError,
        containerId: undefined,
      });

      if (retryScheduled) {
        return;
      }

      await this.handleExecutionFailure(chatSessionId, executionError);
      throw executionError;
    }
  }

  private async assertChatSessionExists(
    chatSessionId: string,
  ): Promise<ChatSession> {
    const session = await this.chatSessionRepo.findById(chatSessionId);
    if (!session) {
      throw new NotFoundException(`Chat session ${chatSessionId} not found`);
    }

    return session;
  }

  private async checkBudget(
    correlationId: string,
    provider: string | null,
    model: string | null,
  ): Promise<void> {
    if (!this.budgetDecisionService) {
      return;
    }

    try {
      const result = await this.budgetDecisionService.evaluateAction({
        scopeId: null,
        contextType: 'chat_session',
        contextId: correlationId,
        actionType: 'chat_turn',
        actorType: 'agent',
        actorId: null,
        providerName: provider,
        modelName: model,
        expectedTokens: null,
        correlationId,
      });

      if (result.decision === 'deny') {
        throw new Error(
          `Chat turn blocked by budget policy: ${result.reasonCode}`,
        );
      }

      if (result.decision === 'warn') {
        this.logger.warn(
          `Chat turn approaching budget limits: ${result.reasonCode}`,
        );
      }
    } catch (err) {
      if ((err as Error).message?.includes('blocked by budget policy')) {
        throw err;
      }
    }
  }

  private async tryScheduleRetry(params: {
    jobData: ChatSessionJobData;
    error: Error;
    containerId?: string;
  }): Promise<boolean> {
    const { jobData, error, containerId } = params;
    const session = await this.chatSessionRepo.findById(jobData.chatSessionId);
    const config = await getChatSessionAutoRetryConfig(this.systemSettings);
    const currentAttempts = this.getCurrentRetryAttempts(
      session?.retry_metadata,
    );
    const firstFailureAt = session?.retry_metadata?.firstFailureAt ?? null;

    const decision = resolveChatSessionAutoRetryDecision({
      errorMessage: error.message,
      currentAttempts,
      firstFailureAt,
      config,
    });

    this.logger.warn(
      `Retry decision for session ${jobData.chatSessionId}: retry=${decision.retry}, reason=${decision.reasonCode}, delay=${decision.retryDelayMs}, error="${error.message}"`,
    );

    if (!decision.retry || decision.retryDelayMs === undefined) {
      return false;
    }

    if (await this.isRetryCapacityFull(config.maxInFlight)) {
      this.logger.warn(
        `Chat session retry capacity reached; failing ${jobData.chatSessionId}`,
      );
      return false;
    }

    const nextAttempt = currentAttempts + 1;
    const now = new Date();
    const nextRetryAt = new Date(now.getTime() + decision.retryDelayMs);
    const retryJobId = this.buildRetryJobId(jobData, nextAttempt);
    const retryDetails = {
      rateLimitResetAt: decision.rateLimitResetAt,
      providerTier: decision.providerTier,
      usageLimit: decision.usageLimit,
      reasonCode: decision.reasonCode,
      firstFailureAt: firstFailureAt ?? now.toISOString(),
    };

    let retryJob: { remove?: () => Promise<void> } | undefined;
    try {
      retryJob = await this.chatQueue.add('execute-chat-session', jobData, {
        delay: decision.retryDelayMs,
        jobId: retryJobId,
        removeOnComplete: 100,
        removeOnFail: 50,
      });
    } catch (enqueueError) {
      this.logger.warn(
        `Failed to enqueue retry for chat session ${jobData.chatSessionId}: ${(enqueueError as Error).message}`,
      );
      return false;
    }

    try {
      await this.chatSessionRepo.update(jobData.chatSessionId, {
        status: ChatSessionStatus.RUNNING,
        execution_state: 'retry_scheduled',
        retry_metadata: {
          attempt: nextAttempt,
          maxAttempts: config.maxAttempts,
          nextRetryAt: nextRetryAt.toISOString(),
          reasonMessage: error.message,
          retryJobId,
          ...this.compactRetryDetails(retryDetails),
        },
        failure_info: {
          message: error.message,
          occurredAt: now.toISOString(),
          retryable: true,
          ...this.compactRetryDetails(retryDetails),
        },
        container_id: null,
        completed_at: null,
        error_message: null,
      });
    } catch (updateError) {
      await this.removeScheduledRetryJob(retryJobId, retryJob);
      this.logger.warn(
        `Failed to persist retry state for chat session ${jobData.chatSessionId}: ${(updateError as Error).message}`,
      );
      return false;
    }

    await this.cleanupExecutionResources(jobData.chatSessionId, containerId);
    this.logger.warn(
      `Scheduled retry ${retryJobId} for chat session ${jobData.chatSessionId}`,
    );
    return true;
  }

  private buildRetryJobId(
    jobData: ChatSessionJobData,
    nextAttempt: number,
  ): string {
    const base = `chat-session-retry:${jobData.chatSessionId}`;
    if (typeof jobData.retryGeneration === 'number') {
      return `${base}:${jobData.retryGeneration.toString()}:${nextAttempt.toString()}`;
    }

    return `${base}:${nextAttempt.toString()}`;
  }

  private async removeScheduledRetryJob(
    retryJobId: string,
    retryJob: { remove?: () => Promise<void> } | undefined,
  ): Promise<void> {
    try {
      const job = retryJob ?? (await this.chatQueue.getJob(retryJobId));
      await job?.remove?.();
    } catch (error) {
      this.logger.warn(
        `Failed to remove stale scheduled retry job ${retryJobId}: ${(error as Error).message}`,
      );
    }
  }

  private getCurrentRetryAttempts(retryMetadata: unknown): number {
    if (
      retryMetadata &&
      typeof retryMetadata === 'object' &&
      'attempt' in retryMetadata
    ) {
      const attempt = Number((retryMetadata as { attempt?: unknown }).attempt);
      return Number.isFinite(attempt) && attempt > 0 ? Math.trunc(attempt) : 0;
    }

    return 0;
  }

  private async isRetryCapacityFull(maxInFlight: number): Promise<boolean> {
    try {
      const jobs = await this.chatQueue.getJobs(
        ['delayed', 'waiting', 'active'],
        0,
        -1,
      );
      const inFlight = jobs.filter((job) => {
        const jobId = job.id ?? '';
        return jobId.startsWith('chat-session-retry:');
      }).length;
      return inFlight >= maxInFlight;
    } catch (error) {
      this.logger.warn(
        `Unable to read chat retry queue counts: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private compactRetryDetails(details: {
    rateLimitResetAt?: string;
    providerTier?: string;
    usageLimit?: unknown;
    reasonCode?: string;
    firstFailureAt?: string;
  }): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(details).filter(([, value]) => value !== undefined),
    );
  }

  private async prepareExecutionSetup(jobData: ChatSessionJobData): Promise<{
    aiSettings: ResolvedAgentSettings;
    providerConfig: ResolvedRunnerProviderConfig;
    containerConfig: IContainerConfig;
    workspacePath: string | undefined;
  }> {
    const aiSettings = await this.aiConfig.resolveStepSettings({
      agentProfileName: jobData.agentProfileName,
    });
    const providerConfig = await this.aiConfig.resolveRunnerProviderConfig({
      modelName: aiSettings.model,
      providerName: aiSettings.providerName,
      providerId: aiSettings.providerId ?? undefined,
      providerSource: aiSettings.providerSource ?? undefined,
    });

    const { toolMountPath, sdkAllowlist } = await this.prepareToolMounts(
      jobData.chatSessionId,
      jobData.containerTier,
      jobData.agentProfileName,
    );
    this.toolMounting.writeSdkToolAllowlist(toolMountPath, sdkAllowlist);

    const agentToken = this.agentTokenService.mintAgentToken({
      chatSessionId: jobData.chatSessionId,
      agentProfileName: jobData.agentProfileName,
      contextId: jobData.contextId,
    });
    const containerConfig = this.containerConfigBuilder.build({
      chatSessionId: jobData.chatSessionId,
      agentProfileName: jobData.agentProfileName,
      initialMessage: jobData.initialMessage,
      containerTier: jobData.containerTier,
      agentToken,
      toolMountPath,
      aiSettings,
      providerConfig,
      contextId: jobData.contextId,
    });
    const workspacePath = this.resolveProjectWorkspacePath(jobData.contextId);

    return {
      aiSettings,
      providerConfig,
      containerConfig,
      workspacePath,
    };
  }

  private async handleExecutionFailure(
    chatSessionId: string,
    error: Error,
    containerId?: string,
  ): Promise<void> {
    if (error.message.toLowerCase().includes('socket hang up')) {
      this.logger.warn(
        `Socket lifecycle error while executing chat session ${chatSessionId}${containerId ? ` (container ${containerId})` : ''}: ${error.message}`,
      );
    }

    this.logger.error(
      `Chat session ${chatSessionId} failed: ${error.message}`,
      error.stack,
    );

    await this.chatSessionRepo.update(chatSessionId, {
      status: ChatSessionStatus.FAILED,
      execution_state: 'failed',
      error_message: error.message,
      failure_info: this.buildTerminalFailureInfo(error),
      completed_at: new Date(),
    });

    this.logger.log(
      `Chat session ${chatSessionId} status transitioned to ${ChatSessionStatus.FAILED}`,
    );
    this.eventEmitter.emit(CHAT_SESSION_FAILED_EVENT, {
      sessionId: chatSessionId,
      status: ChatSessionStatus.FAILED,
    });

    await this.cleanupExecutionResources(chatSessionId, containerId);
  }

  private async cleanupExecutionResources(
    chatSessionId: string,
    containerId?: string,
  ): Promise<void> {
    if (containerId) {
      try {
        await this.containerOrchestrator.killContainer(containerId);
        await this.containerOrchestrator.removeContainer(containerId);
        this.logger.log(`Cleaned up container ${containerId} after failure`);
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to cleanup container ${containerId}: ${(cleanupError as Error).message}`,
        );
      }
    }

    try {
      this.toolMounting.cleanupToolMount(chatSessionId);
    } catch (cleanupError) {
      this.logger.warn(
        `Failed to cleanup tool mount for chat session ${chatSessionId}: ${(cleanupError as Error).message}`,
      );
    }
  }

  private buildTerminalFailureInfo(error: Error): {
    reasonCode: string;
    message: string;
    occurredAt: string;
    retryable: boolean;
    rateLimitResetAt?: string;
    providerTier?: string;
    usageLimit?: ProviderUsageLimit;
  } {
    const classification = classifyProviderTransientFailure({
      message: error.message,
      resetBufferMs: 0,
    });

    const failureInfo: {
      reasonCode: string;
      message: string;
      occurredAt: string;
      retryable: boolean;
      rateLimitResetAt?: string;
      providerTier?: string;
      usageLimit?: ProviderUsageLimit;
    } = {
      reasonCode: classification.reasonCode,
      message: error.message,
      occurredAt: new Date().toISOString(),
      retryable: false,
    };

    if (classification.resetAt) {
      failureInfo.rateLimitResetAt = classification.resetAt;
    }

    if (classification.providerTier) {
      failureInfo.providerTier = classification.providerTier;
    }

    if (classification.usageLimit) {
      failureInfo.usageLimit = classification.usageLimit;
    }

    return failureInfo;
  }

  private async prepareToolMounts(
    mountKey: string,
    containerTier: number,
    agentProfileName: string,
  ): Promise<{ toolMountPath: string; sdkAllowlist: string[] }> {
    const tier = this.resolveContainerTier(containerTier);
    const tools = await this.toolRegistry.getToolsForTier(tier);
    const allowedTools = tools.filter((tool) =>
      this.toolMounting.canProfileUseTool(agentProfileName, tool.name),
    );
    const sdkAllowlist = SDK_NATIVE_TOOL_NAMES.filter((toolName) =>
      this.toolMounting.canProfileUseTool(agentProfileName, toolName),
    );

    const toolMountPath = this.toolMounting.prepareToolMount(
      mountKey,
      allowedTools,
      agentProfileName,
    );

    return {
      toolMountPath,
      sdkAllowlist: [...sdkAllowlist],
    };
  }

  private resolveProjectWorkspacePath(
    scopeId: string | null | undefined,
  ): string | undefined {
    const normalizedScopeId = scopeId?.trim();
    if (!normalizedScopeId) {
      return undefined;
    }

    return normalizedScopeId;
  }

  private resolveContainerTier(containerTier: number | string): ContainerTier {
    return String(containerTier).trim() === '2'
      ? ContainerTier.HEAVY
      : ContainerTier.LIGHT;
  }

  /**
   * Maps a session's harness ID to its thinking-level capability flag.
   *
   * Built-in harnesses use the constants from `@nexus/core`. Unknown
   * harnesses (custom DB-only definitions) conservatively return `false`
   * so thinking-level resolution is a no-op rather than an error.
   *
   * `null`/`undefined` harness IDs indicate an older session that pre-dates
   * the `harness_id` column; these sessions defaulted to the pi harness
   * at creation time, so we apply pi's capabilities.
   */
  private resolveHarnessThinkingCapabilities(
    harnessId: string | null | undefined,
  ): { supportsThinkingLevels: boolean } {
    const effectiveHarnessId = harnessId ?? 'pi';
    if (effectiveHarnessId === 'pi') {
      return { supportsThinkingLevels: PI_CAPABILITIES.supportsThinkingLevels };
    }
    if (effectiveHarnessId === 'claude-code') {
      return {
        supportsThinkingLevels: CLAUDE_CODE_CAPABILITIES.supportsThinkingLevels,
      };
    }
    // Unknown custom harness — conservative default: don't apply thinking levels.
    return { supportsThinkingLevels: false };
  }
}
