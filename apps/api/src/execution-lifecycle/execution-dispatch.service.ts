import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { parseThinkingLevel } from '@nexus/core';
import type { RunnerThinkingLevel } from '@nexus/core';
import {
  ContainerHttpClientService,
  resolveHealthCheckTimeoutMs,
} from '../docker/container-http-client.service';
import { ContainerOrchestratorService } from '../docker/container-orchestrator.service';
import { ExecutionEventPublisher } from './execution-event.publisher';
import { ExecutionRepository } from './database/repositories/execution.repository';
import type {
  DispatchParams,
  DispatchResult,
  IOrchestratorIpResolver,
} from './execution-dispatch.service.types';
import { ORCHESTRATOR_IP_RESOLVER } from './execution-dispatch.service.types';
import type { ContainerAgentRequest } from '../docker/container-http-client.service';
import { ThinkingLevelResolver } from '../ai-config/services/thinking-level-resolver.service';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';

/**
 * Fire-and-poll execution dispatcher.
 *
 * Responsibilities:
 * 1. Persist an Execution record and emit `execution.created`.
 * 2. Provision a container and emit `execution.provisioning` / `execution.provisioned`.
 * 3. POST `/execute/agent` with `background: true` and emit `execution.running`.
 * 4. Return the `executionId` immediately — does NOT await agent completion.
 *
 * Completion, failure, and heartbeat events are handled downstream by the
 * execution supervisor and the container telemetry gateway.
 */
@Injectable()
export class ExecutionDispatchService {
  private readonly logger = new Logger(ExecutionDispatchService.name);

  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly eventPublisher: ExecutionEventPublisher,
    private readonly containerOrchestrator: ContainerOrchestratorService,
    private readonly containerHttpClient: ContainerHttpClientService,
    @Inject(ORCHESTRATOR_IP_RESOLVER)
    private readonly ipResolver: IOrchestratorIpResolver,
    private readonly thinkingLevelResolver: ThinkingLevelResolver,
    private readonly aiConfigurationService: AiConfigurationService,
  ) {}

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const executionId = randomUUID();

    this.logger.log(
      `Dispatching execution ${executionId} (kind=${params.kind})`,
    );

    await this.executionRepository.create({
      id: executionId,
      kind: params.kind,
      state: 'pending',
      chat_session_id: params.chatSessionId ?? null,
      workflow_run_id: params.workflowRunId ?? null,
      parent_execution_id: params.parentExecutionId ?? null,
      context_id: params.contextId ?? null,
      container_tier: params.containerTier,
      provider: params.agentConfig.provider,
      model: params.agentConfig.model,
    });

    await this.eventPublisher.created(executionId, {
      kind: params.kind,
      chat_session_id: params.chatSessionId ?? null,
      workflow_run_id: params.workflowRunId ?? null,
      parent_execution_id: params.parentExecutionId ?? null,
      container_tier: params.containerTier,
    });

    // Fire-and-forget: provision and kick off in the background.
    void this.runDispatch(executionId, params).catch((error: unknown) => {
      this.logger.error(
        `Unhandled error in execution dispatch ${executionId}: ${(error as Error).message}`,
        { error, executionId },
      );
    });

    return { executionId };
  }

  private async runDispatch(
    executionId: string,
    params: DispatchParams,
  ): Promise<void> {
    let containerId: string | undefined;

    try {
      // ExecutionProjector owns row state; lifecycle events drive transitions.
      await this.eventPublisher.provisioning(executionId);

      containerId = await this.containerOrchestrator.provisionContainer(
        params.containerConfig,
        true,
        true,
        params.workspacePath,
      );

      await this.eventPublisher.provisioned(executionId, containerId);

      const containerIp = await this.resolveContainerIp(containerId);

      const baseUrl = this.containerHttpClient.buildBaseUrl(containerIp);

      // Captured in a const so the lambda closes over a narrowed string, not
      // the `string | undefined` outer variable.
      const resolvedContainerId = containerId;
      await this.containerHttpClient.waitForHealth(
        baseUrl,
        resolveHealthCheckTimeoutMs(
          process.env.CONTAINER_HEALTH_CHECK_TIMEOUT_MS,
        ),
        {
          containerId,
          fetchLogs: () =>
            this.containerOrchestrator.fetchContainerLogSnapshot(
              resolvedContainerId,
            ),
          isContainerRunning: async () =>
            (await this.containerOrchestrator.getContainerRuntimeState(
              resolvedContainerId,
            )) === 'running',
        },
      );

      const thinkingLevel = await this.resolveThinkingLevel(params);

      const agentRequest: ContainerAgentRequest = {
        provider: params.agentConfig.provider,
        model: params.agentConfig.model,
        auth: params.agentConfig.auth,
        apiKey: params.agentConfig.apiKey,
        baseUrl: params.agentConfig.baseUrl,
        providerConfig: params.agentConfig.providerConfig,
        systemPrompt: params.agentConfig.systemPrompt,
        initialPrompt: params.agentConfig.initialPrompt,
        temperature: params.agentConfig.temperature,
        thinkingLevel,
        stepId: executionId,
        background: true,
      };

      const response = await this.containerHttpClient.executeAgent(
        baseUrl,
        agentRequest,
      );

      if (!response.ok) {
        throw new Error(
          response.error ??
            `Agent kickoff for execution ${executionId} returned a non-ok response`,
        );
      }

      await this.eventPublisher.running(executionId);

      this.logger.log(`Execution ${executionId} kicked off successfully`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Dispatch failed for execution ${executionId}: ${message}`,
        { error, executionId },
      );

      await this.handleDispatchFailure(executionId, containerId, message);
    }
  }

  /**
   * Resolve the effective thinking level for this dispatch by consulting
   * two policy layers: agent profile default and model default (no step
   * input — this is the chat/session path, not a workflow step).
   *
   * Falls back to `params.agentConfig.thinkingLevel` when the resolver
   * does not produce a concrete level (e.g. the harness does not support
   * thinking levels, or no layer specifies a level).
   */
  private async resolveThinkingLevel(
    params: DispatchParams,
  ): Promise<RunnerThinkingLevel | undefined> {
    const [agentProfileLevel, modelDefaultLevel] = await Promise.all([
      params.agentProfileName
        ? this.aiConfigurationService
            .getAgentProfileByName(params.agentProfileName)
            .then((p) => parseThinkingLevel(p?.thinking_level ?? null))
        : Promise.resolve<RunnerThinkingLevel | undefined>(undefined),
      this.aiConfigurationService
        .getModelDefaultThinkingLevel(params.agentConfig.model)
        .then(parseThinkingLevel),
    ]);

    const thinkingLevelMap = params.agentConfig.providerConfig?.models?.find(
      (m) => m.id === params.agentConfig.model,
    )?.thinkingLevelMap;

    const decision = await this.thinkingLevelResolver.resolve({
      agentProfile: agentProfileLevel,
      modelDefault: modelDefaultLevel,
      provider: params.agentConfig.provider,
      modelId: params.agentConfig.model,
      thinkingLevelMap,
      harnessSupportsThinkingLevels:
        params.capabilities?.supportsThinkingLevels ?? false,
    });

    return 'level' in decision
      ? decision.level
      : params.agentConfig.thinkingLevel;
  }

  private async resolveContainerIp(containerId: string): Promise<string> {
    // Inspect the container up to 10 times waiting for an IP address to be
    // assigned by the Docker network.
    const MAX_ATTEMPTS = 10;
    const POLL_INTERVAL_MS = 500;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const status =
        await this.containerOrchestrator.getContainerStatus(containerId);

      // getContainerStatus does not expose the IP — use Docker inspect directly
      // via the orchestrator's underlying Docker client.  We fall back to
      // parsing the raw inspect result ourselves because ContainerOrchestratorService
      // does not expose IP resolution.
      // We reach into the orchestrator only for provisionContainer / logs;
      // for IP resolution we rely on a separate inspect call via the service.
      void status; // unused — see below

      const ip = await this.inspectContainerIp(containerId);
      if (ip) {
        return ip;
      }

      if (attempt < MAX_ATTEMPTS - 1) {
        await this.sleep(POLL_INTERVAL_MS);
      }
    }

    throw new Error(
      `Could not resolve IP address for container ${containerId} after ${MAX_ATTEMPTS} attempts`,
    );
  }

  /**
   * Inspects the Docker container directly to find its IP address.
   *
   * ContainerOrchestratorService does not expose a dedicated IP-resolution
   * method, so we ask it for the container status (which performs an inspect)
   * and supplement with a raw workspace-path inspect.  In practice, for
   * executors that run on the same Docker network the IP is always present
   * after the container reaches "running" state.
   */
  private async inspectContainerIp(
    containerId: string,
  ): Promise<string | undefined> {
    try {
      // ContainerOrchestratorService.getContainerWorkspacePath does a raw
      // inspect, but there is no public IP method.  We expose IP resolution
      // via a dedicated overridable method to keep the service testable.
      return await this.resolveIpFromOrchestrator(containerId);
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve the orchestrator's IP address by delegating to the injected
   * {@link IOrchestratorIpResolver} (bound to `ORCHESTRATOR_IP_RESOLVER`).
   *
   * The default resolver parses the orchestrator URL via the WHATWG URL
   * parser and returns its hostname. Production operators can swap in
   * alternative strategies (DNS round-robin, service-mesh header lookup,
   * custom HTTP endpoint) by registering a different implementation
   * against `ORCHESTRATOR_IP_RESOLVER` in `ExecutionLifecycleModule` —
   * see WI-2026-064 for the override plan.
   *
   * Reconciliation note (Milestone 2): the legacy `_containerId`
   * parameter is preserved for backwards compatibility with the
   * `inspectContainerIp` call site, which does not have an orchestrator
   * URL in scope. The orchestrator URL is sourced from the
   * `ORCHESTRATOR_URL` environment variable. When unset, this method
   * returns `undefined` so the polling loop in `resolveContainerIp`
   * retries — preserving the pre-Milestone-2 retry semantics.
   *
   * The argument is intentionally prefixed with `_` to signal that the
   * container ID is not consumed by the resolver; the resolver contract
   * is keyed on orchestrator URLs, not container IDs.
   */
  protected async resolveIpFromOrchestrator(
    _containerId: string,
  ): Promise<string | undefined> {
    const orchestratorUrl = this.readOrchestratorUrl();
    if (!orchestratorUrl) {
      return undefined;
    }
    try {
      return await this.ipResolver.resolve(orchestratorUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Orchestrator IP resolution failed for ${orchestratorUrl}: ${message}`,
      );
      return undefined;
    }
  }

  /**
   * Read the orchestrator URL from the `ORCHESTRATOR_URL` environment
   * variable. Returns `undefined` when unset or blank so callers can
   * treat the resolver as "not yet available" and continue retrying.
   *
   * The env var is read directly (rather than via `ConfigService`)
   * because `ExecutionDispatchService` does not otherwise depend on
   * the NestJS config module — adding the dependency just for one
   * optional setting would expand the constructor surface area without
   * a commensurate benefit. The validation schema in
   * `apps/api/src/config/validation.schema.ts` is also untouched, so
   * the variable remains optional.
   */
  private readOrchestratorUrl(): string | undefined {
    return process.env.ORCHESTRATOR_URL?.trim() || undefined;
  }

  private async handleDispatchFailure(
    executionId: string,
    containerId: string | undefined,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.eventPublisher.failed(executionId, {
        failure_reason: 'provision_failed',
        error_message: errorMessage,
      });
    } catch (publishError) {
      this.logger.error(
        `Failed to publish execution.failed event for ${executionId}: ${(publishError as Error).message}`,
      );
    }

    if (containerId) {
      try {
        await this.containerOrchestrator.killContainer(containerId);
        await this.containerOrchestrator.removeContainer(containerId);
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to clean up container ${containerId} after dispatch failure: ${(cleanupError as Error).message}`,
        );
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
