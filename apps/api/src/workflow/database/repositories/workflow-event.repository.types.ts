export interface WorkflowEventPageFilters {
  scopeId?: string;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /**
   * Restrict the page to a finite allowlist of `event_type` strings.
   * Empty / undefined arrays disable the filter (backward compatible).
   * Used by `LastFailurePostmortemProvider` to surface only failure
   * events from `workflow_events`.
   */
  eventTypes?: readonly string[];
}

export interface WorkflowRunRequiredToolsAuditSummary {
  workflow_run_id: string;
  workflow_id: string;
  run_status: string;
  created_at: string;
  updated_at: string;
  scope_id: string | null;
  context_id: string | null;
  queued_jobs_count: number;
  queued_jobs_with_required_tools: number;
  required_tools_satisfied_count: number;
  required_tools_missing_count: number;
  required_tools_retry_enqueued_count: number;
  required_tools_exhausted_count: number;
  queued_job_audit: Array<Record<string, unknown>>;
  required_tool_events: Array<Record<string, unknown>>;
}
