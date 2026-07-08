import type { EventLedger } from '../runtime/database/entities/event-ledger.entity';

export interface ImprovementAuditEvent {
  eventName: string;
  proposalId: string | null;
  outcome: EventLedger['outcome'];
  payload: Record<string, unknown>;
}
