import type { DoctorRepairHistoryStatus } from '../runtime/database/entities/doctor-repair-history.entity.types';

export const doctorCheckStatuses = ['ok', 'warn', 'fail'] as const;
export type DoctorCheckStatus = (typeof doctorCheckStatuses)[number];

export const doctorRepairActionIds = [
  'clear_stale_polling_markers',
  'requeue_recoverable_workflow_runs',
  'prune_orphaned_runtime_artifacts',
  'refresh_mcp_plugin_catalogs',
  'clean_git_worktrees',
  'recover_api_fetch_failures',
  'redispatch_producer_job_with_feedback',
] as const;

export type DoctorRepairActionId = (typeof doctorRepairActionIds)[number];

export interface DoctorCheckResult {
  check_id: string;
  status: DoctorCheckStatus;
  evidence: {
    summary: string;
    details: Record<string, unknown>;
  };
  repair_action_id?: DoctorRepairActionId;
}

export interface DoctorReport {
  generated_at: string;
  overall_status: DoctorCheckStatus;
  summary: {
    ok: number;
    warn: number;
    fail: number;
    total: number;
  };
  checks: DoctorCheckResult[];
}

export interface DoctorReportEnvelope {
  report: DoctorReport;
  summary_markdown: string;
}

export interface DoctorRepairExecutionInput {
  action_id: DoctorRepairActionId;
  dry_run: boolean;
  requested_by?: string;
  arguments: Record<string, unknown>;
}

export type DoctorRepairOutcomeStatus = Exclude<
  DoctorRepairHistoryStatus,
  'running'
>;

export interface DoctorRepairExecutionResult {
  attempt_id: string;
  action_id: DoctorRepairActionId;
  status: DoctorRepairOutcomeStatus;
  dry_run: boolean;
  started_at: string;
  finished_at: string;
  message: string;
  changes: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

export interface DoctorRepairHistoryItem {
  id: string;
  action_id: string;
  status: DoctorRepairHistoryStatus;
  dry_run: boolean;
  requested_by: string | null;
  input_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  evidence_json: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

export interface DoctorRepairHistoryPage {
  items: DoctorRepairHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}
