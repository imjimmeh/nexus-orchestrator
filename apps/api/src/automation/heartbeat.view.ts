import { HeartbeatProfile } from './database/entities/heartbeat-profile.entity';
import { HeartbeatRun } from './database/entities/heartbeat-run.entity';
import {
  HeartbeatProfileSummaryView,
  HeartbeatRunSummaryView,
} from './heartbeat.types';

export function toHeartbeatRunSummary(
  run: HeartbeatRun,
): HeartbeatRunSummaryView {
  return {
    id: run.id,
    heartbeat_profile_id: run.heartbeat_profile_id,
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

export function toHeartbeatProfileSummary(
  profile: HeartbeatProfile,
  lastRun: HeartbeatRun | null,
): HeartbeatProfileSummaryView {
  return {
    id: profile.id,
    scopeId: profile.scopeId,
    name: profile.name,
    enabled: profile.enabled,
    interval_seconds: profile.interval_seconds,
    workflow_id: profile.workflow_id,
    payload_json: profile.payload_json,
    next_run_at: profile.next_run_at ?? null,
    last_run_at: profile.last_run_at ?? null,
    created_by: profile.created_by ?? null,
    updated_by: profile.updated_by ?? null,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    last_run: lastRun ? toHeartbeatRunSummary(lastRun) : null,
  };
}
