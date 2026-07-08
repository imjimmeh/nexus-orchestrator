/**
 * MCP Transport Factory.
 *
 * This factory provides MCP-specific transport client instantiation,
 * routing requests to HTTP or STDIO based on server configuration.
 *
 * ## Design
 *
 * The factory uses the generic PluginTransportFactory pattern from the
 * common plugin-runtime module, extended with MCP-specific types and behavior.
 *
 * ## Transport Types
 *
 * | Type | Description | Use Case |
 * |------|-------------|----------|
 * | HTTP | JSON-RPC over HTTP POST | Remote MCP servers |
 * | STDIO | Content-Length framed JSON-RPC over stdin/stdout | Local MCP tool servers |
 *
 * ## ACP vs MCP Transport
 *
 * See `apps/api/src/common/plugin-runtime/plugin-transport.interface.ts`
 * for a detailed explanation of why MCP has multiple transport types
 * while ACP uses only HTTP.
 *
 * @see PluginTransportFactory for the generic transport factory pattern
 * @module
 */

import { Injectable } from '@nestjs/common';
import { McpTransportType } from '@nexus/core';
import type { McpServer } from './database/entities/mcp-server.entity';
import type { McpToolsListResult } from '@nexus/core';
import type { McpRuntimeContext, McpToolCallResult } from './mcp.types';
import { McpHttpTransportClient } from './mcp-transport-http.client';
import { McpStdioTransportClient } from './mcp-transport-stdio.client';
import type { McpTransportClient } from './mcp-transport.types';

/**
 * MCP Transport Factory.
 *
 * Routes MCP requests to the appropriate transport client based on
 * the server's `transport_type` configuration.
 *
 * ## Usage
 *
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(private readonly transportFactory: McpTransportFactory) {}
 *
 *   async listTools(server: McpServer) {
 *     return this.transportFactory.listTools(server);
 *   }
 *
 *   async callTool(server: McpServer, toolName: string, params: Record<string, unknown>) {
 *     return this.transportFactory.callTool(server, toolName, params);
 *   }
 * }
 * ```
 */
@Injectable()
export class McpTransportFactory {
  private readonly httpClient: McpTransportClient;
  private readonly stdioClient: McpTransportClient;

  constructor(
    private readonly mcpHttpClient: McpHttpTransportClient,
    private readonly mcpStdioClient: McpStdioTransportClient,
  ) {
    // Wrap clients with MCP-specific interface adapter
    this.httpClient = this.wrapHttpClient(mcpHttpClient);
    this.stdioClient = this.wrapStdioClient(mcpStdioClient);
  }

  /**
   * List all tools from an MCP server.
   *
   * Routes to HTTP or STDIO transport based on server configuration.
   *
   * @param server - The MCP server entity
   * @returns List of available tools
   */
  async listTools(server: McpServer): Promise<McpToolsListResult> {
    const client = this.getTransportClient(server);
    return client.listTools(server);
  }

  /**
   * Call a tool on an MCP server.
   *
   * Routes to HTTP or STDIO transport based on server configuration.
   *
   * @param server - The MCP server entity
   * @param toolName - Name of the tool to invoke
   * @param params - Parameters to pass to the tool
   * @param runtimeContext - Optional runtime context for workflow tracking
   * @returns Tool call result
   */
  async callTool(
    server: McpServer,
    toolName: string,
    params: Record<string, unknown>,
    runtimeContext?: McpRuntimeContext,
  ): Promise<McpToolCallResult> {
    const client = this.getTransportClient(server);
    return client.callTool(server, toolName, params, runtimeContext);
  }

  /**
   * Get the appropriate transport client for a server.
   *
   * @param server - The MCP server entity
   * @returns The HTTP or STDIO transport client
   */
  getTransportClient(server: McpServer): McpTransportClient {
    if (server.transport_type === McpTransportType.HTTP) {
      return this.httpClient;
    }

    return this.stdioClient;
  }

  /**
   * Get the HTTP transport client directly.
   *
   * Useful when you need to bypass transport type routing.
   */
  getHttpClient(): McpTransportClient {
    return this.httpClient;
  }

  /**
   * Get the STDIO transport client directly.
   *
   * Useful when you need to bypass transport type routing.
   */
  getStdioClient(): McpTransportClient {
    return this.stdioClient;
  }

  /**
   * Check if a transport type is supported.
   *
   * @param transportType - The transport type to check
   * @returns True if the transport type is supported
   */
  isTransportSupported(transportType: McpTransportType): boolean {
    return transportType in McpTransportType;
  }

  /**
   * Get all supported transport types.
   *
   * @returns Array of supported transport type identifiers
   */
  getSupportedTransports(): string[] {
    return Object.values(McpTransportType);
  }

  private wrapHttpClient(client: McpHttpTransportClient): McpTransportClient {
    return {
      listTools: (server) => client.listTools(server),
      callTool: (server, toolName, params, runtimeContext) =>
        client.callTool(server, toolName, params, runtimeContext),
      close: async () => {
        // HTTP client doesn't hold persistent connections
      },
    };
  }

  private wrapStdioClient(client: McpStdioTransportClient): McpTransportClient {
    return {
      listTools: (server) => client.listTools(server),
      callTool: (server, toolName, params) =>
        client.callTool(server, toolName, params),
      close: async () => {
        // STDIO client uses per-call sessions, no persistent resources
      },
    };
  }
}
