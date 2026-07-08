import { describe, expect, it, vi } from 'vitest';
import { ImprovementTaskRequestedEventEnvelopeV1Schema } from '@nexus/core';
import { ImprovementTaskEventPublisher } from './improvement-task-event.publisher';
import type { RedisStreamService } from '../redis/redis-stream.service';

const envelope = ImprovementTaskRequestedEventEnvelopeV1Schema.parse({
  event_id: '0f0e0d0c-0000-4000-8000-000000000001',
  event_type: 'improvement.task.requested.v1',
  event_version: 'v1',
  occurred_at: '2026-07-02T12:00:00.000Z',
  correlation_id: '11111111-0000-4000-8000-000000000002',
  source_service: 'core',
  payload: {
    proposalId: '11111111-0000-4000-8000-000000000002',
    title: 'Fix NUL-byte handling in outbox insert',
    description: 'Runs fail terminally when NUL bytes reach the outbox INSERT.',
    evidence: { runIds: [], failureClasses: [], ledgerRefs: [] },
    severity: 'high',
    occurrenceCount: 1,
  },
});

function buildPublisher(appendResult: string | null) {
  const stream = { appendToStream: vi.fn().mockResolvedValue(appendResult) };
  const publisher = new ImprovementTaskEventPublisher(
    stream as unknown as RedisStreamService,
  );
  return { stream, publisher };
}

describe('ImprovementTaskEventPublisher', () => {
  it('appends the envelope to the core lifecycle stream', async () => {
    const { stream, publisher } = buildPublisher('1-1');

    await expect(publisher.publish(envelope)).resolves.toBe('1-1');

    expect(stream.appendToStream).toHaveBeenCalledWith(
      'stream:core:lifecycle',
      {
        event_id: envelope.event_id,
        event_type: 'improvement.task.requested.v1',
        occurred_at: envelope.occurred_at,
        envelope: JSON.stringify(envelope),
      },
      { maxLength: 100000 },
    );
  });

  it('throws when Redis returns no stream id', async () => {
    const { publisher } = buildPublisher(null);

    await expect(publisher.publish(envelope)).rejects.toThrow(
      'Redis did not return a stream id',
    );
  });
});
