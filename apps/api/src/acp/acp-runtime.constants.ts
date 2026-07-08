export const ACP_PROTOCOL_VERSION = '0.2.0';
export const ACP_DEFAULT_TIMEOUT_MS = 30000;
export const ACP_DEFAULT_CONNECT_TIMEOUT_MS = 10000;
export const ACP_DEFAULT_MAX_RETRIES = 2;
export const ACP_DEFAULT_RETRY_BACKOFF_MS = 1000;

export const ACP_TOOL_BRIDGE_TYPESCRIPT_CODE = [
  'export const tool = {',
  '  execute: async (_params: Record<string, unknown>) => ({ ok: true }),',
  '};',
].join('\n');
