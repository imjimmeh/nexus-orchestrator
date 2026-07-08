/**
 * Doctor / lifecycle-resume domain types — operator-side repair surface
 * (check results, repair history, repair actions, resume summaries).
 *
 * Moved out of `./types.ts` so the rest of the web API client can consume a
 * stable surface while the legacy `./types.ts` is incrementally depopulated
 * by child-7.
 */

export type DoctorCheckStatus = "ok" | "warn" | "fail";

export type DoctorRepairActionId =
  | "clear_stale_polling_markers"
  | "requeue_recoverable_workflow_runs"
  | "prune_orphaned_runtime_artifacts"
  | "refresh_mcp_plugin_catalogs";

export type DoctorRepairHistoryStatus =
  | "running"
  | "succeeded"
  | "partial"
  | "failed";

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

export interface LifecycleResumeSummary {
  frozenFound: number;
  resumed: number;
  failed: number;
  lastResumeAt: string | null;
}

export interface ExecuteDoctorRepairRequest {
  action_id: DoctorRepairActionId;
  dry_run?: boolean;
  confirm?: boolean;
  arguments?: Record<string, unknown>;
  requested_by?: string;
}

export interface DoctorRepairExecutionResult {
  attempt_id: string;
  action_id: DoctorRepairActionId;
  status: Exclude<DoctorRepairHistoryStatus, "running">;
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