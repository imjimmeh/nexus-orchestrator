import { ScheduledJob } from './database/entities/scheduled-job.entity';
import { ScheduledJobRun } from './database/entities/scheduled-job-run.entity';
import type {
  ScheduledJobRunSummaryView,
  ScheduledJobSummaryView,
} from './scheduled-jobs.types';

export function toScheduledJobRunSummary(
  run: ScheduledJobRun,
): ScheduledJobRunSummaryView {
  return {
    id: run.id,
    scheduled_job_id: run.scheduled_job_id,
    status: run.status,
    due_at: run.due_at,
    triggered_at: run.triggered_at,
    started_at: run.started_at ?? null,
    finished_at: run.finished_at ?? null,
    workflow_run_id: run.workflow_run_id ?? null,
    error_code: run.error_code ?? null,
    error_message: run.error_message ?? null,
    diagnostics_json: run.diagnostics_json ?? null,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

export function toScheduledJobSummary(
  job: ScheduledJob,
  run: ScheduledJobRun | null,
): ScheduledJobSummaryView {
  return {
    id: job.id,
    schedule_scope: job.schedule_scope,
    scopeId: job.scopeId ?? null,
    name: job.name,
    status: job.status,
    schedule_type: job.schedule_type,
    schedule_expression: job.schedule_expression,
    timezone: job.timezone ?? null,
    next_run_at: job.next_run_at ?? null,
    execution_target_type: job.execution_target_type,
    execution_target_ref: job.execution_target_ref,
    payload_json: job.payload_json,
    created_by: job.created_by ?? null,
    updated_by: job.updated_by ?? null,
    paused_at: job.paused_at ?? null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    last_run: run ? toScheduledJobRunSummary(run) : null,
  };
}
