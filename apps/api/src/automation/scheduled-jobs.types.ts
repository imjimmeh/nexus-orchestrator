import {
  ScheduledJobScope,
  ScheduledJobRunStatus,
  ScheduledJobStatus,
  ScheduledJobTargetType,
  ScheduledJobType,
} from '@nexus/core';

export interface ScheduledJobListFilters {
  scopeId?: string;
  scope?: ScheduledJobScope;
  status?: ScheduledJobStatus;
}

export interface ScheduledJobPagination {
  limit: number;
  offset: number;
}

export interface ScheduledJobSummaryView {
  id: string;
  schedule_scope: ScheduledJobScope;
  scopeId: string | null;
  name: string;
  status: ScheduledJobStatus;
  schedule_type: ScheduledJobType;
  schedule_expression: string;
  timezone: string | null;
  next_run_at: Date | null;
  execution_target_type: ScheduledJobTargetType;
  execution_target_ref: string;
  payload_json: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  paused_at: Date | null;
  created_at: Date;
  updated_at: Date;
  last_run: ScheduledJobRunSummaryView | null;
}

export interface ScheduledJobRunSummaryView {
  id: string;
  scheduled_job_id: string;
  status: ScheduledJobRunStatus;
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

export interface CreateScheduledJobParams {
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

export interface UpdateScheduledJobParams {
  name?: string;
  schedule_type?: ScheduledJobType;
  schedule_expression?: string;
  timezone?: string;
  workflow_id?: string;
  payload_json?: Record<string, unknown>;
  updated_by?: string;
}

export interface ListScheduledJobsResult {
  items: ScheduledJobSummaryView[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListScheduledJobRunsResult {
  items: ScheduledJobRunSummaryView[];
  total: number;
  limit: number;
  offset: number;
}

export interface PollDueSchedulesResult {
  scanned: number;
  started: number;
  skipped: number;
}
