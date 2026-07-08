/**
 * MCP (Model Context Protocol) server domain types.
 *
 * Moved out of `./types.ts` so the rest of the web API client can consume a
 * stable surface while the legacy `./types.ts` is incrementally depopulated
 * by child-7.
 *
 * The core `IMcpServer` contract remains owned by `@nexus/core`; this
 * module only defines the web-app wrapper that materializes nullable date
 * fields as required ISO strings plus the request/response shapes used by
 * the web API client.
 */

import type {
  IMcpDiscoveredTool,
  IMcpInvokeToolResult,
  IMcpReloadResult,
  IMcpReloadServerResult,
  IMcpServer,
  IMcpServerTestResult,
} from "@nexus/core";
import type { Timestamps } from "./common.types";

type McpServerDateFields =
  | "created_at"
  | "updated_at"
  | "last_connected_at"
  | "last_discovered_at";

type McpReloadDateFields = "started_at" | "completed_at";

export interface McpServer extends Omit<IMcpServer, McpServerDateFields> {
  created_at: string;
  updated_at: string;
  last_connected_at?: string | null;
  last_discovered_at?: string | null;
}

export type McpDiscoveredTool = IMcpDiscoveredTool;
export type McpServerTestResult = IMcpServerTestResult;
export type McpReloadServerResult = IMcpReloadServerResult;
export type McpInvokeToolResult = IMcpInvokeToolResult;

export interface McpServerRegistryTool {
  id: string;
  name: string;
  mcp_server_id: string | null;
  updated_at: string;
}

export interface McpReloadResult extends Omit<
  IMcpReloadResult,
  McpReloadDateFields
> {
  started_at: string;
  completed_at: string;
}

export interface CreateMcpServerRequest {
  name: string;
  transport_type: IMcpServer["transport_type"];
  enabled?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  include_tools?: string[];
  exclude_tools?: string[];
  timeout_ms?: number;
  connect_timeout_ms?: number;
  max_retries?: number;
  retry_backoff_ms?: number;
}

export type UpdateMcpServerRequest = Partial<CreateMcpServerRequest>;

// Re-export Timestamps so consumers that import the wrapper through this
// module don't need a second import just to reference the base type.
export type { Timestamps };