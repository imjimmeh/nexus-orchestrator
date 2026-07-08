import { HeartbeatRunStatus } from '@nexus/core';

export interface HeartbeatProfileSummaryView {
  id: string;
  scopeId: string;
  name: string;
  enabled: boolean;
  interval_seconds: number;
  workflow_id: string;
  payload_json: Record<string, unknown>;
  next_run_at: Date | null;
  last_run_at: Date | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  last_run: HeartbeatRunSummaryView | null;
}

export interface HeartbeatRunSummaryView {
  id: string;
  heartbeat_profile_id: string;
  status: HeartbeatRunStatus;
  due_at: Date;
  triggered_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  workflow_run_id: string | null;
  error_code: string | null;
  error_message: string | null;
  diagnostics_json: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateHeartbeatProfileParams {
  scopeId: string;
  name: string;
  enabled?: boolean;
  interval_seconds: number;
  workflow_id: string;
  payload_json?: Record<string, unknown>;
  created_by?: string;
}

export interface UpdateHeartbeatProfileParams {
  name?: string;
  enabled?: boolean;
  interval_seconds?: number;
  workflow_id?: string;
  payload_json?: Record<string, unknown>;
  updated_by?: string;
}

export interface HeartbeatPagination {
  limit: number;
  offset: number;
}

export interface ListHeartbeatProfilesResult {
  items: HeartbeatProfileSummaryView[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListHeartbeatRunsResult {
  items: HeartbeatRunSummaryView[];
  total: number;
  limit: number;
  offset: number;
}

export interface PollDueHeartbeatsResult {
  scanned: number;
  started: number;
  skipped: number;
}
