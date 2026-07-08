import type { EventLedgerService } from '../observability/event-ledger.service';
import type { ImprovementAuditEvent } from './improvement-proposal.audit.types';

/**
 * Emits a best-effort event-ledger entry for an improvement-proposal
 * lifecycle transition. Never throws — ledger failures must not block the
 * governing decision they describe.
 */
export async function emitImprovementAudit(
  ledger: Pick<EventLedgerService, 'emitBestEffort'>,
  event: ImprovementAuditEvent,
): Promise<void> {
  await ledger.emitBestEffort({
    domain: 'improvement',
    eventName: event.eventName,
    outcome: event.outcome,
    payload: {
      proposalId: event.proposalId,
      ...event.payload,
    },
  });
}
