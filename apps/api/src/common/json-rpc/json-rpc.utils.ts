import type { JsonRpcRequest, JsonRpcResponse } from '@nexus/core';
import type {
  JsonRpcToolCallResult,
  JsonRpcToolsListResult,
} from './json-rpc.types';

export const JSON_RPC_VERSION = '2.0';

/**
 * Validates that a value is a plain object (Record<string, unknown>).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a string field from a record, returning undefined if not present or invalid.
 */
function readStringField(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

/**
 * Converts a raw object to a tool representation, or null if invalid.
 */
function toToolRepresentation(value: unknown): {
  name: string;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readStringField(value, 'name');
  if (!name) {
    return null;
  }

  const description = readStringField(value, 'description') ?? null;
  const inputSchema = isRecord(value.inputSchema) ? value.inputSchema : null;

  return {
    name,
    description,
    inputSchema,
  };
}

// ---------------------------------------------------------------------------
// Request factory functions
// ---------------------------------------------------------------------------

/**
 * Creates a JSON-RPC request for the MCP initialize handshake.
 *
 * @param id - Numeric request identifier
 * @param protocolVersion - MCP protocol version string
 * @param clientInfo - Client identification information
 */
export function createInitializeRequest(
  id: number,
  protocolVersion: string,
  clientInfo: { name: string; version: string },
): JsonRpcRequest {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo,
    },
  };
}

/**
 * Creates a JSON-RPC notification for the initialized handshake completion.
 */
export function createInitializedNotification(): JsonRpcRequest {
  return {
    jsonrpc: JSON_RPC_VERSION,
    method: 'notifications/initialized',
    params: {},
  };
}

/**
 * Creates a JSON-RPC request for listing MCP tools.
 *
 * @param id - Numeric request identifier
 */
export function createListToolsRequest(id: number): JsonRpcRequest {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method: 'tools/list',
    params: {},
  };
}

/**
 * Creates a JSON-RPC request for calling an MCP tool.
 *
 * @param id - Numeric request identifier
 * @param toolName - Name of the tool to invoke
 * @param params - Tool invocation parameters
 */
export function createCallToolRequest(
  id: number,
  toolName: string,
  params: Record<string, unknown>,
): JsonRpcRequest {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: params,
    },
  };
}

// ---------------------------------------------------------------------------
// Response parsing functions
// ---------------------------------------------------------------------------

/**
 * Parses a raw payload into a JsonRpcResponse, validating the version field.
 *
 * @param payload - Raw response payload
 * @param expectedVersion - Expected JSON-RPC version (defaults to '2.0')
 * @throws Error if payload is not an object or has mismatched version
 */
export function parseJsonRpcResponse(
  payload: unknown,
  expectedVersion: string = JSON_RPC_VERSION,
): JsonRpcResponse {
  if (!isRecord(payload)) {
    throw new Error('Invalid JSON-RPC payload: expected object');
  }

  const jsonrpc = payload.jsonrpc;
  if (jsonrpc !== expectedVersion) {
    throw new Error(
      `Invalid JSON-RPC payload: unexpected version (expected "${expectedVersion}", got "${String(jsonrpc)}")`,
    );
  }

  const response: JsonRpcResponse = {
    jsonrpc: JSON_RPC_VERSION,
  };

  if (
    typeof payload.id === 'number' ||
    typeof payload.id === 'string' ||
    payload.id === null
  ) {
    response.id = payload.id;
  }

  if (isRecord(payload.error)) {
    const errorCode = payload.error.code;
    const errorMessage = payload.error.message;

    if (typeof errorCode === 'number' && typeof errorMessage === 'string') {
      response.error = {
        code: errorCode,
        message: errorMessage,
        data: payload.error.data,
      };
    }
  }

  if (payload.result !== undefined) {
    response.result = payload.result;
  }

  return response;
}

/**
 * Extracts the tools list from a JSON-RPC result payload.
 *
 * @param result - The result field from a JSON-RPC response
 * @throws Error if the result is malformed or missing tools array
 */
export function parseToolsListResult(result: unknown): JsonRpcToolsListResult {
  if (!isRecord(result) || !Array.isArray(result.tools)) {
    throw new Error('MCP tools/list response is missing tools array');
  }

  const tools = result.tools
    .map((candidate) => toToolRepresentation(candidate))
    .filter((tool): tool is NonNullable<typeof tool> => tool !== null);

  return { tools };
}

/**
 * Extracts the result from a tool call response.
 *
 * @param result - The result field from a JSON-RPC response
 */
export function parseToolCallResult(result: unknown): JsonRpcToolCallResult {
  if (!isRecord(result)) {
    if (Array.isArray(result)) {
      return { result };
    }
    return { result: {} };
  }

  return {
    result,
  };
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Extracts the numeric id from a request, or throws if invalid.
 *
 * @param request - JSON-RPC request
 * @throws Error if the request id is not a number
 */
export function requireRequestId(request: JsonRpcRequest): number {
  if (typeof request.id !== 'number') {
    throw new Error(
      `JSON-RPC request id must be a number, got: ${typeof request.id}`,
    );
  }
  return request.id;
}

/**
 * Creates a new request id, tracking the current sequence.
 *
 * @param counter - Mutable reference to the next id value
 * @returns The next request id and increments the counter
 */
export function nextRequestId(counter: { value: number }): number {
  const id = counter.value;
  counter.value += 1;
  return id;
}
