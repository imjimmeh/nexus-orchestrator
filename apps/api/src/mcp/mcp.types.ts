import type { IToolApiCallback, McpToolsListResult } from '@nexus/core';

export interface McpToolCallResult {
  result: Record<string, unknown> | unknown[];
}

export interface McpRuntimeContext {
  workflowRunId?: string;
  jobId?: string;
  stepId?: string;
  scopeId?: string;
}

export interface McpTransportClient {
  listTools(): Promise<McpToolsListResult>;
  callTool(
    toolName: string,
    params: Record<string, unknown>,
    runtimeContext?: McpRuntimeContext,
  ): Promise<McpToolCallResult>;
  close(): Promise<void>;
}

export interface McpRegistryPayload {
  name: string;
  schema: Record<string, unknown>;
  typescript_code: string;
  tier_restriction: number;
  api_callback: IToolApiCallback;
  mcp_server_id?: string;
}
