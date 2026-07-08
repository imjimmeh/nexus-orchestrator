export const MCP_JSONRPC_VERSION = '2.0' as const;
export const MCP_PROTOCOL_VERSION = '2024-11-05';

export const MCP_TOOL_BRIDGE_TYPESCRIPT_CODE = [
  'export const tool = {',
  '  execute: async (_params: Record<string, unknown>) => ({ ok: true }),',
  '};',
].join('\n');
