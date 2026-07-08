/**
 * Scheduled-job domain types — scheduled-job entity, scheduled-job runs,
 * and the corresponding create / update DTOs.
 *
 * Moved out of `./types.ts` so the rest of the web API client can consume a
 * stable surface while the legacy `./types.ts` is incrementally depopulated
 * by child-7.
 */

import type { Timestamps } from "./common.types";

export type ScheduledJobStatus = "active" | "paused";

export type ScheduledJobScope = "scope" | "global";

export type ScheduledJobType = "one_time" | "interval" | "cron";

export type ScheduledJobRunStatus =
  | "triggered"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

export interface ScheduledJobRun extends Timestamps {
  id: string;
  scheduled_job_id: string;
  status: ScheduledJobRunStatus;
  due_at: string;
  triggered_at: string;
  started_at: string | null;
  finished_at: string | null;
  workflow_run_id: string | null;
  error_code: string | null;
  error_message: string | null;
  diagnostics_json: Record<string, unknown> | null;
}

export interface ScheduledJob extends Timestamps {
  id: string;
  schedule_scope: ScheduledJobScope;
  scopeId: string | null;
  name: string;
  status: ScheduledJobStatus;
  schedule_type: ScheduledJobType;
  schedule_expression: string;
  timezone: string | null;
  next_run_at: string | null;
  execution_target_type: "workflow";
  execution_target_ref: string;
  payload_json: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  paused_at: string | null;
  last_run: ScheduledJobRun | null;
}

export interface ScheduledJobListResponse {
  items: ScheduledJob[];
  total: number;
  limit: number;
  offset: number;
}

export interface ScheduledJobRunsListResponse {
  items: ScheduledJobRun[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateScheduledJobRequest {
  schedule_scope?: ScheduledJobScope;
  scopeId?: string;
  name: string;
  schedule_type: ScheduledJobType;
  schedule_expression: string;
  timezone?: string;
  workflow_id: string;
  payload_json?: Record<string, unknown>;
  created_by?: string;
}

export interface UpdateScheduledJobRequest {
  name?: string;
  schedule_type?: ScheduledJobType;
  schedule_expression?: string;
  timezone?: string;
  workflow_id?: string;
  payload_json?: Record<string, unknown>;
  updated_by?: string;
}