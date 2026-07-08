import type { EventLedger } from '../runtime/database/entities/event-ledger.entity';

export interface AppendEventParams {
  workflowRunId: string;
  eventType: string;
  stepId?: string;
  jobId?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
  /** Override the outcome derived from the event type name. */
  outcome?: EventLedger['outcome'];
  /** Override the severity inferred from the outcome. */
  severity?: EventLedger['severity'];
}
