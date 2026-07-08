/**
 * Event-ledger payload types — moved out of `./types.ts` so the rest of
 * the web API client can consume a stable surface while the legacy
 * `./types.ts` is incrementally depopulated by child-7.
 *
 * `EventLedgerPaginatedResponse` is owned by child-1 and lives in
 * `./common.types.ts`; this file only owns the ledger payload envelope
 * (record + query + page).
 */

export type EventLedgerOutcome =
  | "success"
  | "failure"
  | "denied"
  | "in_progress";

export type EventLedgerSeverity = "info" | "warn" | "error" | "critical";

export interface EventLedgerRecord {
  id: string;
  domain: string;
  event_name: string;
  outcome: EventLedgerOutcome;
  severity: EventLedgerSeverity;
  source: string;
  actor_type?: "user" | "agent" | "system" | null;
  actor_id?: string | null;
  project_id?: string | null;
  work_item_id?: string | null;
  workflow_id?: string | null;
  workflow_run_id?: string | null;
  job_id?: string | null;
  step_id?: string | null;
  tool_id?: string | null;
  tool_name?: string | null;
  subagent_execution_id?: string | null;
  session_tree_id?: string | null;
  request_id?: string | null;
  correlation_id?: string | null;
  parent_event_id?: string | null;
  payload?: Record<string, unknown> | null;
  error_code?: string | null;
  error_message?: string | null;
  occurred_at: string;
}

export interface EventLedgerQuery {
  domain?: string;
  eventName?: string;
  outcome?: EventLedgerOutcome;
  severity?: EventLedgerSeverity;
  source?: string;
  actorType?: "user" | "agent" | "system";
  actorId?: string;
  projectId?: string;
  workItemId?: string;
  workflowId?: string;
  workflowRunId?: string;
  jobId?: string;
  stepId?: string;
  toolName?: string;
  requestId?: string;
  correlationId?: string;
  occurredAfter?: string;
  occurredBefore?: string;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface EventLedgerPage {
  data: EventLedgerRecord[];
  total: number;
  limit: number;
  offset: number;
}
