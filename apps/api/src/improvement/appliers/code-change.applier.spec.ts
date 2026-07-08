import { describe, expect, it, vi } from 'vitest';
import { ImprovementTaskRequestedEventEnvelopeV1Schema } from '@nexus/core';
import type { ImprovementTaskEventPublisher } from '../improvement-task-event.publisher';
import type { EventLedgerService } from '../../observability/event-ledger.service';
import type { ImprovementProposal } from '../database/entities/improvement-proposal.entity';
import { CodeChangeApplier } from './code-change.applier';

const proposal = {
  id: '11111111-0000-4000-8000-000000000002',
  kind: 'code_change',
  status: 'approved',
  occurrence_count: 3,
  payload: {
    title: 'Fix NUL-byte handling in outbox insert',
    description: 'NUL bytes abort the outbox INSERT and wedge the run.',
    suspectedArea: ['apps/api/src/domain-events'],
    evidence: {
      runIds: ['eac4e46e-0000-4000-8000-000000000001'],
      failureClasses: ['outbox_insert_failed'],
      ledgerRefs: ['ledger:123'],
    },
    severity: 'high',
  },
} as unknown as ImprovementProposal;

function buildApplier() {
  const publisher = { publish: vi.fn().mockResolvedValue('1-1') };
  const ledger = { emitBestEffort: vi.fn().mockResolvedValue(undefined) };
  const applier = new CodeChangeApplier(
    publisher as unknown as ImprovementTaskEventPublisher,
    ledger as unknown as EventLedgerService,
  );
  return { applier, publisher, ledger };
}

describe('CodeChangeApplier', () => {
  it('declares the code_change kind', () => {
    expect(buildApplier().applier.kind).toBe('code_change');
  });

  it('publishes a schema-valid neutral envelope carrying the brief', async () => {
    const { applier, publisher } = buildApplier();

    const result = await applier.apply(proposal);

    expect(result.ok).toBe(true);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const envelope = publisher.publish.mock.calls[0][0];
    expect(() =>
      ImprovementTaskRequestedEventEnvelopeV1Schema.parse(envelope),
    ).not.toThrow();
    expect(envelope.correlation_id).toBe(proposal.id);
    expect(envelope.payload).toMatchObject({
      proposalId: proposal.id,
      title: proposal.payload.title,
      severity: 'high',
      occurrenceCount: 3,
    });
  });

  it('emits a best-effort ledger audit entry on publish', async () => {
    const { applier, ledger } = buildApplier();
    await applier.apply(proposal);
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'improvement.task.requested.v1',
        outcome: 'success',
        correlationId: proposal.id,
      }),
    );
  });

  it('returns ok:false with detail when the payload fails validation', async () => {
    const { applier, publisher } = buildApplier();
    const result = await applier.apply({
      ...proposal,
      payload: { title: '' },
    });
    expect(result.ok).toBe(false);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('returns ok:false when the publish call throws', async () => {
    const { applier, publisher, ledger } = buildApplier();
    publisher.publish.mockRejectedValueOnce(new Error('redis unavailable'));

    const result = await applier.apply(proposal);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('redis unavailable');
    expect(ledger.emitBestEffort).not.toHaveBeenCalled();
  });

  it('returns ok:false (does not throw) when the entity carries an occurrence_count the envelope schema rejects', async () => {
    const { applier, publisher, ledger } = buildApplier();

    const result = await applier.apply({
      ...proposal,
      occurrence_count: 0,
    });

    expect(result.ok).toBe(false);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(ledger.emitBestEffort).not.toHaveBeenCalled();
  });
});
