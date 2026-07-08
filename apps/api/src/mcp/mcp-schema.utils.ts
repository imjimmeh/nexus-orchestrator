import type { McpServer } from './database/entities/mcp-server.entity';
import type { McpRemoteTool } from '@nexus/core';
import {
  buildRegistrySchema,
  buildMcpNexusExtension,
  normalizeMcpInputSchema,
} from '../common/plugin-runtime/plugin-schema.utils';

/**
 * Builds an MCP registry schema for a remote tool.
 *
 * @param params.server - The MCP server record
 * @param params.remoteTool - The remote tool definition
 * @param params.registryToolName - The full registry tool name
 * @returns A schema object with x-nexus-mcp extension
 */
export function buildMcpRegistrySchema(params: {
  server: McpServer;
  remoteTool: McpRemoteTool;
  registryToolName: string;
}): Record<string, unknown> {
  const schema = normalizeMcpInputSchema(params.remoteTool.inputSchema);

  const nexusExtension = buildMcpNexusExtension({
    serverId: params.server.id,
    serverName: params.server.name,
    transportType: params.server.transport_type,
    remoteToolName: params.remoteTool.name,
    registryToolName: params.registryToolName,
  });

  return buildRegistrySchema({
    schema,
    description: params.remoteTool.description ?? null,
    nexusExtension,
  });
}
