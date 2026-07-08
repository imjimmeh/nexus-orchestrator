export enum ScheduledJobStatus {
  ACTIVE = "active",
  PAUSED = "paused",
}

export enum ScheduledJobType {
  ONE_TIME = "one_time",
  INTERVAL = "interval",
  CRON = "cron",
}

export enum ScheduledJobTargetType {
  WORKFLOW = "workflow",
}

export enum ScheduledJobScope {
  SCOPE = "scope",
  GLOBAL = "global",
}

export enum ScheduledJobRunStatus {
  TRIGGERED = "triggered",
  RUNNING = "running",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
  SKIPPED = "skipped",
  CANCELLED = "cancelled",
}

export interface IScheduledJob {
  id: string;
  schedule_scope: ScheduledJobScope;
  scopeId?: string | null;
  name: string;
  status: ScheduledJobStatus;
  schedule_type: ScheduledJobType;
  schedule_expression: string;
  timezone?: string | null;
  next_run_at?: Date | null;
  execution_target_type: ScheduledJobTargetType;
  execution_target_ref: string;
  payload_json: Record<string, unknown>;
  created_by?: string | null;
  updated_by?: string | null;
  paused_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface IScheduledJobRun {
  id: string;
  scheduled_job_id: string;
  status: ScheduledJobRunStatus;
  due_at: Date;
  triggered_at: Date;
  started_at?: Date | null;
  finished_at?: Date | null;
  workflow_run_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  diagnostics_json?: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}
