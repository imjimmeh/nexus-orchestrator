export interface McpRemoteTool {
  name: string;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
}

export interface McpToolsListResult {
  tools: McpRemoteTool[];
}

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id?: JsonRpcId;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}
