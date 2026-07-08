/**
 * MCP JSON-RPC utilities - re-exports from shared common utilities.
 *
 * This module delegates to the shared JSON-RPC utilities in
 * apps/api/src/common/json-rpc/ with MCP-specific defaults.
 */

import {
  createCallToolRequest as createGenericCallToolRequest,
  createInitializeRequest as createGenericInitializeRequest,
  createInitializedNotification as createGenericInitializedNotification,
  createListToolsRequest as createGenericListToolsRequest,
  parseJsonRpcResponse as parseGenericJsonRpcResponse,
  parseToolCallResult as parseGenericToolCallResult,
  parseToolsListResult as parseGenericToolsListResult,
} from '../common/json-rpc/json-rpc.utils';
import {
  MCP_JSONRPC_VERSION,
  MCP_PROTOCOL_VERSION,
} from './mcp-runtime.constants';

// MCP-specific client info
const MCP_CLIENT_INFO = {
  name: 'nexus-orchestrator',
  version: '0.0.1',
};

/**
 * Creates an MCP initialize request with standard client info.
 *
 * @param id - Numeric request identifier
 */
export function createInitializeRequest(id: number) {
  return createGenericInitializeRequest(
    id,
    MCP_PROTOCOL_VERSION,
    MCP_CLIENT_INFO,
  );
}

/**
 * Creates an initialized notification (no id, just method).
 */
export function createInitializedNotification() {
  return createGenericInitializedNotification();
}

/**
 * Creates a request to list tools.
 *
 * @param id - Numeric request identifier
 */
export function createListToolsRequest(id: number) {
  return createGenericListToolsRequest(id);
}

/**
 * Creates a request to call a tool.
 *
 * @param id - Numeric request identifier
 * @param toolName - Name of the tool to call
 * @param params - Tool parameters
 */
export function createCallToolRequest(
  id: number,
  toolName: string,
  params: Record<string, unknown>,
) {
  return createGenericCallToolRequest(id, toolName, params);
}

/**
 * Parses a JSON-RPC response payload.
 *
 * @param payload - Raw response payload
 */
export function parseJsonRpcResponse(payload: unknown) {
  return parseGenericJsonRpcResponse(payload, MCP_JSONRPC_VERSION);
}

/**
 * Extracts the tools list from a JSON-RPC result payload.
 *
 * @param result - The result field from a JSON-RPC response
 */
export function parseToolsListResult(result: unknown) {
  return parseGenericToolsListResult(result);
}

/**
 * Extracts the result from a tool call response.
 *
 * @param result - The result field from a JSON-RPC response
 */
export function parseToolCallResult(result: unknown) {
  return parseGenericToolCallResult(result);
}
