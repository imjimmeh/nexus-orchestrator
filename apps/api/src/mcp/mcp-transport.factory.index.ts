/**
 * MCP Transport Factory Module.
 *
 * This module exports the MCP-specific transport factory implementation.
 *
 * For information about the shared transport interface and why ACP only
 * uses HTTP while MCP has both HTTP and STDIO, see:
 * `apps/api/src/common/plugin-runtime/plugin-transport.interface.ts`
 *
 * @module
 */

export { McpTransportFactory } from './mcp-transport.factory';
export type { McpTransportClient } from './mcp-transport.types';
