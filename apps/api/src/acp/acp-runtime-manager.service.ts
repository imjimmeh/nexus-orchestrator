import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  AcpAgentManifest,
  AcpAwaitPolicy,
  AcpRunMode,
  AcpRunStatus,
  AcpServerStatus,
  IAcpDiscoveredAgent,
  IAcpDiscoveredAgentSummary,
  IAcpInvokeAgentResult,
  IAcpReloadResult,
  IAcpReloadServerResult,
  IAcpRunResult,
  IAcpServerTestResult,
} from '@nexus/core';
import { AcpServer } from './database/entities/acp-server.entity';
import { AcpServerRepository } from './database/repositories/acp-server.repository';
import { AcpDiscoveredAgentRepository } from './database/repositories/acp-discovered-agent.repository';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import { BasePluginRuntimeManagerService } from '../common/plugin-runtime/base-plugin-runtime-manager.service';
import type {
  PluginReloadSummary,
  PluginTestResultParams,
} from '../common/plugin-runtime/base-plugin-runtime-manager.service.types';
import { CapabilityRegistrarService } from '../tool-registry/capability-registrar.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { AcpHttpClient } from './acp-http.client';
import { type AcpHttpClientConfig } from './acp-http-client.types';
import { filterAcpAgents } from './acp-filter.utils';
import { buildAcpRegistrySchema } from './acp-schema.utils';
import {
  buildAcpRegistryToolName,
  buildAcpToolPrefix,
  buildAcpInvokePath,
} from './acp-tool-name.utils';
import { ACP_TOOL_BRIDGE_TYPESCRIPT_CODE } from './acp-runtime.constants';
import { SecretReferenceResolver } from '../security/secret-reference-resolver.service';

@Injectable()
export class AcpRuntimeManagerService
  extends BasePluginRuntimeManagerService<
    AcpServer,
    AcpAgentManifest,
    IAcpReloadResult,
    IAcpReloadServerResult,
    IAcpServerTestResult
  >
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(AcpRuntimeManagerService.name);

  constructor(
    private readonly acpServerRepository: AcpServerRepository,
    private readonly acpDiscoveredAgentRepository: AcpDiscoveredAgentRepository,
    private readonly toolRegistryRepository: ToolRegistryRepository,
    private readonly capabilityRegistrar: CapabilityRegistrarService,
    private readonly toolRegistryService: ToolRegistryService,
    private readonly eventLedger: EventLedgerService,
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {
    super(toolRegistryRepository, toolRegistryService);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.reloadAllServers();
  }

  async invokeAgent(
    serverId: string,
    agentName: string,
    params: Record<string, unknown>,
    runModeOverride?: AcpRunMode,
  ): Promise<IAcpInvokeAgentResult> {
    const server = await this.requireServer(serverId);
    if (!server.enabled) {
      throw new BadRequestException(`ACP server ${server.name} is disabled`);
    }

    const startedAt = Date.now();
    const registryToolName = buildAcpRegistryToolName(serverId, agentName);

    try {
      const runMode = runModeOverride ?? server.default_run_mode;
      const result = await this.executeRun(server, agentName, params, runMode);

      await this.eventLedger.emitBestEffort({
        domain: 'acp',
        eventName: 'acp.invoke.succeeded',
        outcome: 'success',
        payload: {
          server_id: server.id,
          agent_name: agentName,
          registry_tool_name: registryToolName,
          run_mode: runMode,
        },
      });

      return {
        server_id: server.id,
        agent_name: agentName,
        registry_tool_name: registryToolName,
        duration_ms: Date.now() - startedAt,
        run_id: result.run_id,
        result,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      await this.eventLedger.emitBestEffort({
        domain: 'acp',
        eventName: 'acp.invoke.failed',
        outcome: 'failure',
        payload: {
          server_id: server.id,
          agent_name: agentName,
          registry_tool_name: registryToolName,
        },
        errorMessage: message,
      });

      throw new BadRequestException(`ACP agent invocation failed: ${message}`);
    }
  }

  async removeAgentsForServer(serverId: string): Promise<number> {
    const removedAgentCount = await this.removeRegisteredItemsForServer(
      buildAcpToolPrefix(serverId),
    );
    await this.acpDiscoveredAgentRepository.deleteByServerId(serverId);
    return removedAgentCount;
  }

  private async executeRun(
    server: AcpServer,
    agentName: string,
    params: Record<string, unknown>,
    runMode: AcpRunMode,
  ): Promise<IAcpRunResult> {
    const client = await this.createClient(server);
    const message = {
      role: 'user' as const,
      content_type: 'application/json',
      content: JSON.stringify(params),
    };

    const run = await client.createRun({
      agent_name: agentName,
      message,
      run_mode: runMode,
    });

    if (runMode === AcpRunMode.SYNC) {
      const maxPolls = 60;
      const pollIntervalMs = 1000;

      for (let i = 0; i < maxPolls; i++) {
        const currentRun = await client.getRun(run.run_id);

        if (currentRun.status === AcpRunStatus.COMPLETED) {
          return {
            run_id: currentRun.run_id,
            status: currentRun.status,
            messages: currentRun.result?.messages,
          };
        }

        if (currentRun.status === AcpRunStatus.FAILED) {
          return {
            run_id: currentRun.run_id,
            status: currentRun.status,
            messages: currentRun.result?.messages,
            error: 'Agent run failed',
          };
        }

        if (currentRun.status === AcpRunStatus.AWAITING) {
          return this.handleAwaitingState(server, client, currentRun);
        }

        await new Promise<void>((resolve) =>
          setTimeout(resolve, pollIntervalMs),
        );
      }

      return {
        run_id: run.run_id,
        status: AcpRunStatus.IN_PROGRESS,
        error: 'Polling timeout exceeded',
      };
    }

    return { run_id: run.run_id, status: run.status };
  }

  private async handleAwaitingState(
    server: AcpServer,
    client: AcpHttpClient,
    run: { run_id: string; status: AcpRunStatus },
  ): Promise<IAcpRunResult> {
    if (server.await_policy === AcpAwaitPolicy.FAIL) {
      return {
        run_id: run.run_id,
        status: run.status,
        error: 'Agent requires user input, but await_policy is set to fail',
      };
    }

    if (server.await_policy === AcpAwaitPolicy.AUTO_RESUME) {
      const resumedRun = await client.resumeRun(run.run_id, {
        message: {
          role: 'user' as const,
          content_type: 'text/plain',
          content: 'continue',
        },
      });

      if (resumedRun.status === AcpRunStatus.COMPLETED) {
        return {
          run_id: resumedRun.run_id,
          status: resumedRun.status,
          messages: resumedRun.result?.messages,
        };
      }

      if (resumedRun.status === AcpRunStatus.AWAITING) {
        return {
          run_id: resumedRun.run_id,
          status: resumedRun.status,
          error: 'Agent still awaiting after auto-resume',
        };
      }
    }

    return {
      run_id: run.run_id,
      status: run.status,
      error: 'Agent awaiting user input',
    };
  }

  protected async reloadSingleServer(
    server: AcpServer,
  ): Promise<IAcpReloadServerResult> {
    if (!server.enabled) {
      return this.disableServerAndPruneAgents(server);
    }

    try {
      const agents = await this.discoverItemsWithRetry(server);
      const syncResult = await this.syncDiscoveredAgents(server, agents);
      await this.acpServerRepository.update(server.id, {
        last_status: AcpServerStatus.CONNECTED,
        last_error: null,
        last_connected_at: new Date(),
        last_discovered_at: new Date(),
        last_discovered_agent_count: syncResult.discoveredAgents.length,
      });

      await this.eventLedger.emitBestEffort({
        domain: 'acp',
        eventName: 'acp.reload.succeeded',
        outcome: 'success',
        payload: {
          server_id: server.id,
          discovered_agent_count: syncResult.discoveredAgents.length,
          removed_agent_count: syncResult.removedAgentCount,
        },
      });

      return {
        server_id: server.id,
        server_name: server.name,
        ok: true,
        discovered_agent_count: syncResult.discoveredAgents.length,
        removed_agent_count: syncResult.removedAgentCount,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.logger.warn(
        `Failed to reload ACP server ${server.name}: ${message}`,
      );

      await this.acpServerRepository.update(server.id, {
        last_status: AcpServerStatus.FAILED,
        last_error: message,
      });

      await this.eventLedger.emitBestEffort({
        domain: 'acp',
        eventName: 'acp.reload.failed',
        outcome: 'failure',
        payload: {
          server_id: server.id,
        },
        errorMessage: message,
      });

      return {
        server_id: server.id,
        server_name: server.name,
        ok: false,
        discovered_agent_count: 0,
        removed_agent_count: 0,
        error: message,
      };
    }
  }

  private async disableServerAndPruneAgents(
    server: AcpServer,
  ): Promise<IAcpReloadServerResult> {
    const removedAgentCount = await this.removeAgentsForServer(server.id);
    await this.acpServerRepository.update(server.id, {
      last_status: AcpServerStatus.DISABLED,
      last_error: null,
      last_discovered_agent_count: 0,
    });
    return {
      server_id: server.id,
      server_name: server.name,
      ok: true,
      discovered_agent_count: 0,
      removed_agent_count: removedAgentCount,
    };
  }

  protected async discoverItemsWithRetry(
    server: AcpServer,
  ): Promise<AcpAgentManifest[]> {
    const maxRetries = Math.max(0, server.max_retries);
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const client = await this.createClient(server);
        const discovery = await client.listAgents();
        return filterAcpAgents(
          discovery.agents,
          server.include_agents,
          server.exclude_agents,
        );
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) break;
        await new Promise<void>((resolve) =>
          setTimeout(
            resolve,
            Math.max(50, server.retry_backoff_ms) * (attempt + 1),
          ),
        );
      }
    }

    throw lastError;
  }

  private async createClient(server: AcpServer): Promise<AcpHttpClient> {
    const resolvedToken = await this.secretReferenceResolver.resolveString({
      secretId: server.auth_secret_id,
      plaintext: server.auth_token,
      purpose: 'auth',
      serverName: server.name,
      allowEmptySecret: true,
    });
    const resolvedHeaders = await this.secretReferenceResolver.resolveMap({
      secretId: server.headers_secret_id,
      plaintext: server.headers,
      purpose: 'headers',
      serverName: server.name,
    });

    const config: AcpHttpClientConfig = {
      baseUrl: server.url,
      authType: server.auth_type,
      authToken: resolvedToken,
      headers: resolvedHeaders ?? undefined,
      timeoutMs: server.timeout_ms,
      connectTimeoutMs: server.connect_timeout_ms,
    };
    return new AcpHttpClient(config);
  }

  private async syncDiscoveredAgents(
    server: AcpServer,
    agents: AcpAgentManifest[],
  ): Promise<{
    discoveredAgents: IAcpDiscoveredAgent[];
    removedAgentCount: number;
  }> {
    const expectedToolNames = new Set<string>();
    const discoveredAgents: IAcpDiscoveredAgent[] = [];

    for (const agent of agents) {
      const registryToolName = buildAcpRegistryToolName(server.id, agent.name);
      expectedToolNames.add(registryToolName);
      discoveredAgents.push(this.toDiscoveredAgentSummary(server, agent));

      try {
        await this.upsertTool(server, agent, registryToolName);
      } catch (error) {
        this.logger.warn(
          `Failed to register ACP agent ${agent.name} for server ${server.name}: ${(error as Error).message}`,
        );
      }
    }

    const existingTools = await this.toolRegistryRepository.findByNamePrefix(
      buildAcpToolPrefix(server.id),
    );

    let removedAgentCount = 0;
    for (const existingTool of existingTools) {
      if (!expectedToolNames.has(existingTool.name)) {
        await this.toolRegistryService.deleteTool(existingTool.id);
        removedAgentCount += 1;
      }
    }

    return {
      discoveredAgents,
      removedAgentCount,
    };
  }

  private async upsertTool(
    server: AcpServer,
    manifest: AcpAgentManifest,
    registryToolName: string,
  ): Promise<void> {
    await this.capabilityRegistrar.registerToolProjection({
      source: 'external_acp',
      sourceMetadata: {
        server_id: server.id,
        agent_name: manifest.name,
      },
      tool: {
        name: registryToolName,
        schema: buildAcpRegistrySchema({ server, manifest, registryToolName }),
        typescript_code: ACP_TOOL_BRIDGE_TYPESCRIPT_CODE,
        tier_restriction: 0,
        api_callback: {
          method: 'POST',
          path_template: buildAcpInvokePath(server.id, manifest.name),
        },
      },
    });

    await this.acpDiscoveredAgentRepository.upsertByServerAndAgentName(
      server.id,
      manifest.name,
      {
        description: manifest.description ?? null,
        input_content_types: manifest.input_content_types ?? null,
        output_content_types: manifest.output_content_types ?? null,
        manifest_metadata: (manifest.metadata ?? null) as never,
        registry_tool_name: registryToolName,
        is_registered: true,
      },
    );
  }

  private toDiscoveredAgentSummary(
    server: AcpServer,
    agent: AcpAgentManifest,
  ): IAcpDiscoveredAgent {
    return {
      id: '',
      server_id: server.id,
      agent_name: agent.name,
      description: agent.description ?? null,
      input_content_types: null,
      output_content_types: null,
      manifest_metadata: null,
      registry_tool_name: buildAcpRegistryToolName(server.id, agent.name),
      is_registered: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  protected findAllServers(): Promise<AcpServer[]> {
    return this.acpServerRepository.findAll();
  }

  protected findServerById(serverId: string): Promise<AcpServer | null> {
    return this.acpServerRepository.findById(serverId);
  }

  protected buildReloadResult(
    summary: PluginReloadSummary<IAcpReloadServerResult>,
  ): IAcpReloadResult {
    return summary;
  }

  protected buildTestResult(
    params: PluginTestResultParams<AcpServer, AcpAgentManifest>,
  ): IAcpServerTestResult {
    return {
      server_id: params.server.id,
      ok: params.ok,
      latency_ms: params.latencyMs,
      discovered_agents: params.discoveredItems.map((agent) =>
        this.toDiscoveredAgentSummary(params.server, agent),
      ) as IAcpDiscoveredAgentSummary[],
      ...(params.error ? { error: params.error } : {}),
    };
  }

  protected getServerNotFoundMessage(serverId: string): string {
    return `ACP server ${serverId} not found`;
  }

  protected getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }

    return 'Unknown ACP runtime error';
  }
}
