import type { JsonRpcId, JsonRpcRequest, JsonRpcResponse } from '@nexus/core';

export { JsonRpcId, JsonRpcRequest, JsonRpcResponse };

/**
 * Result type for MCP tool call operations.
 */
export interface JsonRpcToolCallResult {
  result: Record<string, unknown> | unknown[];
}

/**
 * Result type for MCP tools list operations.
 */
export interface JsonRpcToolsListResult {
  tools: Array<{
    name: string;
    description?: string | null;
    inputSchema?: Record<string, unknown> | null;
  }>;
}
