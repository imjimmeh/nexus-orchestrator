import { Injectable } from '@nestjs/common';
import { McpServerStatus } from '@nexus/core';
import { McpServerRepository } from '../../mcp/database/repositories/mcp-server.repository';
import { ToolRegistryRepository } from '../../tool/database/repositories/tool-registry.repository';
import { buildMcpToolPrefix } from '../../mcp/mcp-tool-name.utils';
import type {
  ToolPluginRegistryAnalysis,
  ToolPluginRegistryPerServerToolCount,
  ToolPluginRegistryServerSnapshot,
  ToolPluginRegistryToolSnapshot,
} from './tool-plugin-registry-integrity.check.types';
import type { DoctorCheck } from './doctor-check.types';
import {
  type DoctorCheckResult,
  type DoctorCheckStatus,
} from '../doctor.types';

@Injectable()
export class ToolPluginRegistryIntegrityCheckService implements DoctorCheck {
  readonly checkId = 'tool_and_plugin_registry_integrity_check';

  constructor(
    private readonly mcpServerRepository: McpServerRepository,
    private readonly toolRegistryRepository: ToolRegistryRepository,
  ) {}

  async run(): Promise<DoctorCheckResult> {
    const [servers, tools] = await Promise.all([
      this.mcpServerRepository.findAll(),
      this.toolRegistryRepository.findAll(),
    ]);

    const analysis = this.analyzeRegistryState(servers, tools);

    const status = this.resolveStatus({
      enabledFailedServers: analysis.enabledFailedServerIds.length,
      orphanMcpTools: analysis.orphanMcpToolNames.length,
      enabledUnknownServers: analysis.enabledUnknownServerIds.length,
      mismatchedDiscoveredCounts: analysis.mismatchedDiscoveredCounts.length,
      disabledServersWithTools: analysis.disabledServersWithTools.length,
    });

    const summary = this.buildSummary({
      enabledFailedServers: analysis.enabledFailedServerIds.length,
      orphanMcpTools: analysis.orphanMcpToolNames.length,
      enabledUnknownServers: analysis.enabledUnknownServerIds.length,
      mismatchedDiscoveredCounts: analysis.mismatchedDiscoveredCounts.length,
      disabledServersWithTools: analysis.disabledServersWithTools.length,
    });

    return {
      check_id: this.checkId,
      status,
      evidence: {
        summary,
        details: {
          server_count: servers.length,
          mcp_tool_count: analysis.mcpTools.length,
          enabled_failed_server_ids: analysis.enabledFailedServerIds,
          enabled_unknown_server_ids: analysis.enabledUnknownServerIds,
          mismatched_discovered_counts: analysis.mismatchedDiscoveredCounts,
          disabled_servers_with_tools: analysis.disabledServersWithTools,
          orphan_mcp_tool_names: analysis.orphanMcpToolNames,
          per_server_tool_counts: analysis.perServerToolCounts,
        },
      },
      repair_action_id:
        status !== 'ok' ? 'refresh_mcp_plugin_catalogs' : undefined,
    };
  }

  private analyzeRegistryState(
    servers: ToolPluginRegistryServerSnapshot[],
    tools: ToolPluginRegistryToolSnapshot[],
  ): ToolPluginRegistryAnalysis {
    const mcpTools = tools.filter((tool) => tool.name.startsWith('mcp_'));
    const serverPrefixById = new Map(
      servers.map((server) => [server.id, buildMcpToolPrefix(server.id)]),
    );
    const perServerToolCounts = this.buildPerServerToolCounts(
      servers,
      mcpTools,
      serverPrefixById,
    );

    const enabledFailedServerIds = servers
      .filter(
        (server) =>
          server.enabled && server.last_status === McpServerStatus.FAILED,
      )
      .map((server) => server.id);

    const enabledUnknownServerIds = servers
      .filter(
        (server) =>
          server.enabled &&
          (server.last_status === McpServerStatus.UNKNOWN ||
            server.last_status === McpServerStatus.DISABLED),
      )
      .map((server) => server.id);

    const mismatchedDiscoveredCounts = perServerToolCounts.filter(
      (server) =>
        typeof server.expected_count === 'number' &&
        server.expected_count !== server.actual_count,
    );

    const disabledServersWithTools = perServerToolCounts.filter(
      (server) => !server.enabled && server.actual_count > 0,
    );
    const orphanMcpToolNames = this.collectOrphanMcpToolNames(
      mcpTools,
      serverPrefixById,
    );

    return {
      mcpTools,
      enabledFailedServerIds,
      enabledUnknownServerIds,
      mismatchedDiscoveredCounts,
      disabledServersWithTools,
      orphanMcpToolNames,
      perServerToolCounts,
    };
  }

  private buildPerServerToolCounts(
    servers: ToolPluginRegistryServerSnapshot[],
    mcpTools: ToolPluginRegistryToolSnapshot[],
    serverPrefixById: Map<string, string>,
  ): ToolPluginRegistryPerServerToolCount[] {
    return servers.map((server) => {
      const prefix = serverPrefixById.get(server.id);
      const actualCount = prefix
        ? mcpTools.filter((tool) => tool.name.startsWith(prefix)).length
        : 0;

      return {
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        last_status: server.last_status,
        expected_count: server.last_discovered_tool_count ?? null,
        actual_count: actualCount,
      };
    });
  }

  private collectOrphanMcpToolNames(
    mcpTools: ToolPluginRegistryToolSnapshot[],
    serverPrefixById: Map<string, string>,
  ): string[] {
    const serverPrefixes = [...serverPrefixById.values()];

    return mcpTools
      .map((tool) => tool.name)
      .filter(
        (toolName) =>
          !serverPrefixes.some((prefix) => toolName.startsWith(prefix)),
      );
  }

  private resolveStatus(params: {
    enabledFailedServers: number;
    orphanMcpTools: number;
    enabledUnknownServers: number;
    mismatchedDiscoveredCounts: number;
    disabledServersWithTools: number;
  }): DoctorCheckStatus {
    if (params.enabledFailedServers > 0 || params.orphanMcpTools > 0) {
      return 'fail';
    }

    if (
      params.enabledUnknownServers > 0 ||
      params.mismatchedDiscoveredCounts > 0 ||
      params.disabledServersWithTools > 0
    ) {
      return 'warn';
    }

    return 'ok';
  }

  private buildSummary(params: {
    enabledFailedServers: number;
    orphanMcpTools: number;
    enabledUnknownServers: number;
    mismatchedDiscoveredCounts: number;
    disabledServersWithTools: number;
  }): string {
    if (params.enabledFailedServers > 0) {
      return `Detected ${params.enabledFailedServers.toString()} enabled MCP server(s) in failed state.`;
    }

    if (params.orphanMcpTools > 0) {
      return `Detected ${params.orphanMcpTools.toString()} MCP tool registry entrie(s) with no matching server.`;
    }

    if (
      params.enabledUnknownServers > 0 ||
      params.mismatchedDiscoveredCounts > 0 ||
      params.disabledServersWithTools > 0
    ) {
      return 'Detected MCP/plugin registry drift that may require catalog refresh.';
    }

    return 'MCP/tool registry integrity check passed.';
  }
}
