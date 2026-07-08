import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  IMcpDiscoveredTool,
  IMcpInvokeToolResult,
  IMcpReloadResult,
  IMcpReloadServerResult,
  IMcpServerTestResult,
  McpServerStatus,
} from '@nexus/core';
import type { McpServer } from './database/entities/mcp-server.entity';
import { McpServerRepository } from './database/repositories/mcp-server.repository';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import { EventLedgerService } from '../observability/event-ledger.service';
import { BasePluginRuntimeManagerService } from '../common/plugin-runtime/base-plugin-runtime-manager.service';
import type {
  PluginReloadSummary,
  PluginTestResultParams,
} from '../common/plugin-runtime/base-plugin-runtime-manager.service.types';
import { CapabilityRegistrarService } from '../tool-registry/capability-registrar.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { filterMcpTools } from './mcp-filter.utils';
import { buildMcpRegistrySchema } from './mcp-schema.utils';
import {
  buildMcpInvokePath,
  buildMcpRegistryToolName,
  buildMcpToolPrefix,
} from './mcp-tool-name.utils';
import { MCP_TOOL_BRIDGE_TYPESCRIPT_CODE } from './mcp-runtime.constants';
import type { McpRegistryPayload, McpRuntimeContext } from './mcp.types';
import type { McpRemoteTool } from '@nexus/core';
import { McpTransportFactory } from './mcp-transport.factory';
import { McpReconciliationLoop } from './mcp-reconciliation-loop';
import {
  readPositiveInteger,
  waitForMilliseconds,
} from './mcp-runtime-manager.utils';

const MCP_INVOKE_PARAMS_BODY_MAPPING = {
  params: '__tool_params__',
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class McpRuntimeManagerService
  extends BasePluginRuntimeManagerService<
    McpServer,
    McpRemoteTool,
    IMcpReloadResult,
    IMcpReloadServerResult,
    IMcpServerTestResult
  >
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(McpRuntimeManagerService.name);
  private readonly reconciliationLoop: McpReconciliationLoop;

  constructor(
    private readonly mcpServerRepository: McpServerRepository,
    private readonly toolRegistryRepository: ToolRegistryRepository,
    private readonly capabilityRegistrar: CapabilityRegistrarService,
    private readonly toolRegistryService: ToolRegistryService,
    private readonly transportFactory: McpTransportFactory,
    private readonly eventLedger: EventLedgerService,
  ) {
    super(toolRegistryRepository, toolRegistryService);
    this.reconciliationLoop = new McpReconciliationLoop({
      logger: this.logger,
      eventLedger: this.eventLedger,
      isEnabled: () => this.isReconciliationEnabled(),
      resolveDelayMs: (failureStreak) =>
        this.resolveReconciliationDelayMs(failureStreak),
      reloadAllServers: () => this.reloadAllServers(),
      getErrorMessage: (error) => this.getErrorMessage(error),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.reloadAllServers();
    this.reconciliationLoop.start();
  }

  onModuleDestroy(): void {
    this.reconciliationLoop.stop();
  }

  async invokeTool(
    serverId: string,
    remoteToolName: string,
    params: Record<string, unknown>,
    runtimeContext?: McpRuntimeContext,
  ): Promise<IMcpInvokeToolResult> {
    const server = await this.requireServer(serverId);
    if (!server.enabled) {
      throw new BadRequestException(`MCP server ${server.name} is disabled`);
    }
    const startedAt = Date.now();
    const registryToolName = buildMcpRegistryToolName(
      server.id,
      remoteToolName,
    );

    try {
      const result = await this.transportFactory.callTool(
        server,
        remoteToolName,
        params,
        runtimeContext,
      );
      await this.eventLedger.emitBestEffort({
        domain: 'mcp',
        eventName: 'mcp.invoke.succeeded',
        outcome: 'success',
        payload: {
          server_id: server.id,
          remote_tool_name: remoteToolName,
          registry_tool_name: registryToolName,
        },
      });

      return {
        server_id: server.id,
        remote_tool_name: remoteToolName,
        registry_tool_name: registryToolName,
        duration_ms: Date.now() - startedAt,
        result: result.result,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      await this.eventLedger.emitBestEffort({
        domain: 'mcp',
        eventName: 'mcp.invoke.failed',
        outcome: 'failure',
        payload: {
          server_id: server.id,
          remote_tool_name: remoteToolName,
          registry_tool_name: registryToolName,
        },
        errorMessage: message,
      });

      throw new BadRequestException(`MCP tool invocation failed: ${message}`);
    }
  }

  async removeToolsForServer(serverId: string): Promise<number> {
    return this.removeRegisteredItemsForServer(buildMcpToolPrefix(serverId));
  }

  protected async reloadSingleServer(
    server: McpServer,
  ): Promise<IMcpReloadServerResult> {
    if (!server.enabled) {
      return this.disableServerAndPruneTools(server);
    }
    try {
      const tools = await this.discoverItemsWithRetry(server);
      const syncResult = await this.syncDiscoveredTools(server, tools);
      await this.mcpServerRepository.update(server.id, {
        last_status: McpServerStatus.CONNECTED,
        last_error: null,
        last_connected_at: new Date(),
        last_discovered_at: new Date(),
        last_discovered_tool_count: syncResult.discoveredTools.length,
      });

      await this.eventLedger.emitBestEffort({
        domain: 'mcp',
        eventName: 'mcp.reload.succeeded',
        outcome: 'success',
        payload: {
          server_id: server.id,
          discovered_tool_count: syncResult.discoveredTools.length,
          removed_tool_count: syncResult.removedToolCount,
        },
      });

      return {
        server_id: server.id,
        server_name: server.name,
        ok: true,
        discovered_tool_count: syncResult.discoveredTools.length,
        removed_tool_count: syncResult.removedToolCount,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.logger.warn(
        `Failed to reload MCP server ${server.name}: ${message}`,
      );

      await this.mcpServerRepository.update(server.id, {
        last_status: McpServerStatus.FAILED,
        last_error: message,
      });

      await this.eventLedger.emitBestEffort({
        domain: 'mcp',
        eventName: 'mcp.reload.failed',
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
        discovered_tool_count: 0,
        removed_tool_count: 0,
        error: message,
      };
    }
  }

  private async disableServerAndPruneTools(
    server: McpServer,
  ): Promise<IMcpReloadServerResult> {
    const removedToolCount = await this.removeToolsForServer(server.id);
    await this.mcpServerRepository.update(server.id, {
      last_status: McpServerStatus.DISABLED,
      last_error: null,
      last_discovered_tool_count: 0,
    });

    return {
      server_id: server.id,
      server_name: server.name,
      ok: true,
      discovered_tool_count: 0,
      removed_tool_count: removedToolCount,
    };
  }

  protected async discoverItemsWithRetry(
    server: McpServer,
  ): Promise<McpRemoteTool[]> {
    const maxRetries = Math.max(0, server.max_retries);
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.discoverTools(server);
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) {
          break;
        }

        const retryDelayMs =
          Math.max(50, server.retry_backoff_ms) * (attempt + 1);
        await waitForMilliseconds(retryDelayMs);
      }
    }

    throw lastError;
  }

  private async discoverTools(server: McpServer): Promise<McpRemoteTool[]> {
    const discovery = await this.transportFactory.listTools(server);
    return filterMcpTools(
      discovery.tools,
      server.include_tools,
      server.exclude_tools,
    );
  }

  private async syncDiscoveredTools(
    server: McpServer,
    remoteTools: McpRemoteTool[],
  ): Promise<{
    discoveredTools: IMcpDiscoveredTool[];
    removedToolCount: number;
  }> {
    const expectedNames = new Set<string>();
    const discoveredTools: IMcpDiscoveredTool[] = [];

    for (const remoteTool of remoteTools) {
      const registryToolName = buildMcpRegistryToolName(
        server.id,
        remoteTool.name,
      );
      expectedNames.add(registryToolName);
      expectedNames.add(remoteTool.name);
      discoveredTools.push(this.toDiscoveredToolSummary(server, remoteTool));

      try {
        await this.capabilityRegistrar.registerToolProjection({
          source: 'external_mcp',
          sourceMetadata: {
            server_id: server.id,
            remote_tool_name: remoteTool.name,
          },
          tool: this.buildRegistryPayload(server, remoteTool, registryToolName),
        });

        await this.capabilityRegistrar.registerToolProjection({
          source: 'external_mcp',
          sourceMetadata: {
            server_id: server.id,
            remote_tool_name: remoteTool.name,
          },
          tool: this.buildRegistryPayload(server, remoteTool, remoteTool.name),
        });
      } catch (error) {
        this.logger.warn(
          `Failed to register MCP tool ${remoteTool.name} for server ${server.name}: ${(error as Error).message}`,
        );
      }
    }

    const existingTools = await this.toolRegistryRepository.findByMcpServerId(
      server.id,
    );

    let removedToolCount = 0;
    for (const existingTool of existingTools) {
      if (!expectedNames.has(existingTool.name)) {
        await this.toolRegistryService.deleteTool(existingTool.id);
        removedToolCount += 1;
      }
    }
    return {
      discoveredTools,
      removedToolCount,
    };
  }

  private buildRegistryPayload(
    server: McpServer,
    remoteTool: McpRemoteTool,
    registryToolName: string,
  ): McpRegistryPayload {
    return {
      name: registryToolName,
      schema: buildMcpRegistrySchema({
        server,
        remoteTool,
        registryToolName,
      }),
      typescript_code: MCP_TOOL_BRIDGE_TYPESCRIPT_CODE,
      tier_restriction: 0,
      mcp_server_id: server.id,
      api_callback: {
        method: 'POST',
        body_mapping: MCP_INVOKE_PARAMS_BODY_MAPPING,
        path_template: buildMcpInvokePath(server.id, remoteTool.name),
      },
    };
  }

  private toDiscoveredToolSummary(
    server: McpServer,
    remoteTool: McpRemoteTool,
  ): IMcpDiscoveredTool {
    return {
      remote_tool_name: remoteTool.name,
      registry_tool_name: buildMcpRegistryToolName(server.id, remoteTool.name),
      description: remoteTool.description ?? null,
    };
  }

  protected findAllServers(): Promise<McpServer[]> {
    return this.mcpServerRepository.findAll();
  }

  protected findServerById(serverId: string): Promise<McpServer | null> {
    return UUID_PATTERN.test(serverId)
      ? this.mcpServerRepository.findById(serverId)
      : this.mcpServerRepository.findByName(serverId);
  }

  protected buildReloadResult(
    summary: PluginReloadSummary<IMcpReloadServerResult>,
  ): IMcpReloadResult {
    return summary;
  }

  protected buildTestResult(
    params: PluginTestResultParams<McpServer, McpRemoteTool>,
  ): IMcpServerTestResult {
    return {
      server_id: params.server.id,
      ok: params.ok,
      latency_ms: params.latencyMs,
      discovered_tools: params.discoveredItems.map((tool) =>
        this.toDiscoveredToolSummary(params.server, tool),
      ),
      ...(params.error ? { error: params.error } : {}),
    };
  }

  protected getServerNotFoundMessage(serverId: string): string {
    return `MCP server ${serverId} not found`;
  }

  protected getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }
    return 'Unknown MCP runtime error';
  }

  private isReconciliationEnabled(): boolean {
    const raw = process.env.MCP_RECONCILIATION_ENABLED;
    if (!raw) {
      return true;
    }
    const normalized = raw.trim().toLowerCase();
    return normalized !== 'false' && normalized !== '0' && normalized !== 'off';
  }

  private resolveReconciliationDelayMs(failureStreak: number): number {
    const baseIntervalMs = readPositiveInteger(
      process.env.MCP_RECONCILIATION_INTERVAL_MS,
      300000,
    );
    const jitterMaxMs = readPositiveInteger(
      process.env.MCP_RECONCILIATION_JITTER_MS,
      30000,
    );
    const jitterMs =
      jitterMaxMs > 0 ? Math.floor(Math.random() * (jitterMaxMs + 1)) : 0;
    const backoffMultiplier = Math.min(failureStreak, 4);
    const backoffMs = baseIntervalMs * backoffMultiplier;
    return baseIntervalMs + jitterMs + backoffMs;
  }
}
