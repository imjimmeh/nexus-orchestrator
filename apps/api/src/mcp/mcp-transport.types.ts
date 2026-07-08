import type { McpServer } from './database/entities/mcp-server.entity';
import type { McpToolsListResult } from '@nexus/core';
import type { McpRuntimeContext, McpToolCallResult } from './mcp.types';

/**
 * MCP-specific transport client interface.
 *
 * Extends the base transport client with MCP-specific result types.
 */
export interface McpTransportClient {
  /**
   * List all tools available from the MCP server.
   *
   * @param server - The MCP server entity
   * @returns List of available tools
   */
  listTools(server: McpServer): Promise<McpToolsListResult>;

  /**
   * Call a tool on the MCP server.
   *
   * @param server - The MCP server entity
   * @param toolName - Name of the tool to call
   * @param params - Tool parameters
   * @param runtimeContext - Optional runtime context for workflow tracking
   * @returns Tool call result
   */
  callTool(
    server: McpServer,
    toolName: string,
    params: Record<string, unknown>,
    runtimeContext?: McpRuntimeContext,
  ): Promise<McpToolCallResult>;

  /**
   * Close the transport (for STDIO: kill the subprocess).
   *
   * @returns Promise that resolves when the transport is closed
   */
  close(): Promise<void>;
}
