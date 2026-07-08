export interface WorkflowRecoveryDiagnostics {
  running_count: number;
  pending_count: number;
  live_queue_run_count: number;
  stale_running_run_ids: string[];
  recoverable_pending_run_ids: string[];
  expired_owner_lease_execution_ids: string[];
}
