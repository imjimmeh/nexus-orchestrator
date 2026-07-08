export interface CreateExternalConnectionInput {
  project_id: string;
  provider_type: string;
  name: string;
  status?: string;
  sync_mode?: string;
  sync_transport?: string;
  config?: Record<string, unknown>;
  field_mapping?: Record<string, unknown>;
  webhook_secret_ref?: string | null;
  poll_interval_seconds?: number | null;
}

export interface UpdateExternalConnectionInput {
  name?: string;
  status?: string;
  sync_mode?: string;
  sync_transport?: string;
  config?: Record<string, unknown>;
  field_mapping?: Record<string, unknown>;
  webhook_secret_ref?: string | null;
  poll_interval_seconds?: number | null;
}
