export enum AcpTransportType {
  HTTP = "http",
}

export enum AcpServerStatus {
  UNKNOWN = "unknown",
  CONNECTED = "connected",
  FAILED = "failed",
  DISABLED = "disabled",
}

export enum AcpRunStatus {
  CREATED = "created",
  IN_PROGRESS = "in-progress",
  AWAITING = "awaiting",
  CANCELLING = "cancelling",
  CANCELLED = "cancelled",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum AcpRunMode {
  SYNC = "sync",
  ASYNC = "async",
  STREAM = "stream",
}

export enum AcpAuthType {
  NONE = "none",
  BEARER = "bearer",
  API_KEY = "api_key",
}

export enum AcpAwaitPolicy {
  SURFACE_TO_USER = "surface-to-user",
  AUTO_RESUME = "auto-resume",
  FAIL = "fail",
}

export interface IAcpServer {
  id: string;
  name: string;
  enabled: boolean;
  url: string;
  auth_type: AcpAuthType;
  auth_token?: string | null;
  /**
   * Direct UUID FK to `secret_store.id` whose decrypted JSON payload
   * supplies the `auth_token` value at request time. Takes precedence
   * over the plaintext `auth_token` column; falls back to `auth_token`
   * if `null`. See `SecretReferenceResolver` for the runtime contract.
   */
  auth_secret_id?: string | null;
  headers?: Record<string, string> | null;
  /**
   * Direct UUID FK to `secret_store.id` that resolves to a JSON object
   * whose entries are merged into the `headers` map at request time.
   * Takes precedence over the plaintext `headers` column; falls back to
   * `headers` if `null`. See `SecretReferenceResolver` for the runtime
   * resolution contract.
   */
  headers_secret_id?: string | null;
  timeout_ms: number;
  connect_timeout_ms: number;
  max_retries: number;
  retry_backoff_ms: number;
  default_run_mode: AcpRunMode;
  await_policy: AcpAwaitPolicy;
  include_agents?: string[] | null;
  exclude_agents?: string[] | null;
  last_status: AcpServerStatus;
  last_error?: string | null;
  last_connected_at?: Date | null;
  last_discovered_at?: Date | null;
  last_discovered_agent_count?: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface IAcpDiscoveredAgent {
  id: string;
  server_id: string;
  agent_name: string;
  description?: string | null;
  input_content_types?: string[] | null;
  output_content_types?: string[] | null;
  manifest_metadata?: Record<string, unknown> | null;
  registry_tool_name?: string | null;
  is_registered: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface IAcpServerTestResult {
  server_id: string;
  ok: boolean;
  latency_ms: number;
  discovered_agents: IAcpDiscoveredAgentSummary[];
  error?: string | null;
}

export interface IAcpDiscoveredAgentSummary {
  agent_name: string;
  registry_tool_name: string;
  description?: string | null;
}

export interface IAcpReloadServerResult {
  server_id: string;
  server_name: string;
  ok: boolean;
  discovered_agent_count: number;
  removed_agent_count: number;
  error?: string | null;
}

export interface IAcpReloadResult {
  started_at: Date;
  completed_at: Date;
  total_servers: number;
  succeeded_servers: number;
  failed_servers: number;
  results: IAcpReloadServerResult[];
}

export interface IAcpInvokeAgentResult {
  server_id: string;
  agent_name: string;
  registry_tool_name: string;
  duration_ms: number;
  run_id?: string;
  result: IAcpRunResult | null;
  error?: string | null;
}

export interface IAcpRunResult {
  run_id: string;
  status: AcpRunStatus;
  messages?: AcpMessage[];
  error?: string | null;
}

export interface AcpMessage {
  role: "user" | "agent" | `agent/${string}`;
  content_type: string;
  content?: string | null;
  content_url?: string | null;
  metadata?: AcpCitationMetadata | AcpTrajectoryMetadata | null;
}

export interface AcpCitationMetadata {
  citations?: Array<{
    source: string;
    quote: string;
  }>;
}

export interface AcpTrajectoryMetadata {
  trajectory?: string[];
}

export interface AcpAgentManifest {
  name: string;
  description?: string;
  input_content_types?: string[];
  output_content_types?: string[];
  metadata?: Record<string, unknown>;
  status?: string;
}

export interface AcpRun {
  run_id: string;
  status: AcpRunStatus;
  created_at?: string;
  updated_at?: string;
  final?: boolean;
  result?: {
    messages?: AcpMessage[];
  };
}

export interface AcpRunCreateRequest {
  agent_name: string;
  message: {
    role: "user" | "agent" | `agent/${string}`;
    content_type: string;
    content?: string;
    content_url?: string;
  };
  run_mode?: AcpRunMode;
  session_id?: string;
}

export interface AcpRunResumeRequest {
  message: {
    role: "user" | "agent" | `agent/${string}`;
    content_type: string;
    content?: string;
    content_url?: string;
  };
}

export interface AcpEvent {
  type: "message" | "RunState";
  data: Record<string, unknown>;
}

export interface AcpSession {
  session_id: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

export interface AcpError {
  code: number;
  message: string;
  details?: Record<string, unknown>;
}
