export type SyncMode = "inbound" | "outbound" | "bidirectional";

export type SyncTransport = "manual" | "webhook" | "polling" | "both";

export type ConnectionStatus = "active" | "paused" | "error";

export interface ExternalConnectionRecord {
  id: string;
  project_id: string;
  provider_type: string;
  name: string;
  status: ConnectionStatus;
  sync_mode: SyncMode;
  sync_transport: SyncTransport;
  config: Record<string, unknown>;
  field_mapping: Record<string, unknown>;
  webhook_secret_ref: string | null;
  poll_interval_seconds: number | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalConnectionCreateInput {
  provider_type: string;
  name: string;
  sync_mode?: SyncMode;
  sync_transport?: SyncTransport;
  config?: Record<string, unknown>;
  field_mapping?: Record<string, unknown>;
  webhook_secret_ref?: string | null;
  poll_interval_seconds?: number | null;
}

export interface ExternalConnectionUpdateInput {
  name?: string;
  status?: ConnectionStatus;
  sync_mode?: SyncMode;
  sync_transport?: SyncTransport;
  config?: Record<string, unknown>;
  field_mapping?: Record<string, unknown>;
  webhook_secret_ref?: string | null;
  poll_interval_seconds?: number | null;
}

export interface TestConnectionResult {
  provider_type: string;
  valid: boolean;
}

export interface SyncOperationRecord {
  id: string;
  connection_id: string;
  project_id: string;
  work_item_id: string | null;
  external_id: string | null;
  direction: string;
  operation: string;
  status: string;
  message: string | null;
  details: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type InboundSyncAction =
  | "created"
  | "updated"
  | "deleted"
  | "skipped"
  | "noop"
  | "failed";

export type InboundSyncStatus = "success" | "skipped" | "noop" | "failed";

export interface InboundTicketSyncResult {
  action: InboundSyncAction;
  status: InboundSyncStatus;
}

export interface SyncRunResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}
