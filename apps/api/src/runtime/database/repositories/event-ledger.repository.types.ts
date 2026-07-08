import type { EventLedger } from '../entities/event-ledger.entity';

export interface EventLedgerQueryParams {
  domain?: string;
  event_name?: string;
  outcome?: EventLedger['outcome'];
  severity?: EventLedger['severity'];
  source?: string;
  actor_type?: EventLedger['actor_type'];
  actor_id?: string;
  scopeId?: string;
  contextId?: string;
  workflow_id?: string;
  workflow_run_id?: string;
  job_id?: string;
  step_id?: string;
  tool_name?: string;
  request_id?: string;
  correlation_id?: string;
  occurred_after?: Date;
  occurred_before?: Date;
  limit?: number;
  offset?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}
