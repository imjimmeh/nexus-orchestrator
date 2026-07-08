export enum McpTransportType {
  STDIO = "stdio",
  HTTP = "http",
}

export enum McpServerStatus {
  UNKNOWN = "unknown",
  CONNECTED = "connected",
  FAILED = "failed",
  DISABLED = "disabled",
}

export interface IMcpServer {
  id: string;
  name: string;
  enabled: boolean;
  transport_type: McpTransportType;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  /**
   * Direct UUID FK to `secret_store.id` that resolves to a JSON object
   * whose entries are merged into the `headers` map at request time.
   * Takes precedence over the plaintext `headers` column; falls back to
   * `headers` if `null`. See `SecretReferenceResolver` for the runtime
   * resolution contract.
   */
  headers_secret_id?: string | null;
  /**
   * Plaintext environment variables merged onto `process.env` when the
   * stdio child process is spawned. Only valid for `transport_type ===
   * 'stdio'`. See `superRefine` on the create/update schemas.
   */
  env?: Record<string, string> | null;
  /**
   * Direct UUID FK to `secret_store.id` whose decrypted JSON payload
   * supplies additional environment variables when the stdio child
   * process is spawned. Takes precedence over the plaintext `env`
   * column; entries are merged onto `process.env` at spawn time.
   * Only valid for `transport_type === 'stdio'`.
   */
  env_secret_id?: string | null;
  include_tools?: string[] | null;
  exclude_tools?: string[] | null;
  timeout_ms: number;
  connect_timeout_ms: number;
  max_retries: number;
  retry_backoff_ms: number;
  last_status: McpServerStatus;
  last_error?: string | null;
  last_connected_at?: Date | null;
  last_discovered_at?: Date | null;
  last_discovered_tool_count?: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface IMcpDiscoveredTool {
  remote_tool_name: string;
  registry_tool_name: string;
  description?: string | null;
}

export interface IMcpServerTestResult {
  server_id: string;
  ok: boolean;
  latency_ms: number;
  discovered_tools: IMcpDiscoveredTool[];
  error?: string | null;
}

export interface IMcpReloadServerResult {
  server_id: string;
  server_name: string;
  ok: boolean;
  discovered_tool_count: number;
  removed_tool_count: number;
  error?: string | null;
}

export interface IMcpReloadResult {
  started_at: Date;
  completed_at: Date;
  total_servers: number;
  succeeded_servers: number;
  failed_servers: number;
  results: IMcpReloadServerResult[];
}

export interface IMcpInvokeToolResult {
  server_id: string;
  remote_tool_name: string;
  registry_tool_name: string;
  duration_ms: number;
  result: Record<string, unknown> | unknown[];
}
