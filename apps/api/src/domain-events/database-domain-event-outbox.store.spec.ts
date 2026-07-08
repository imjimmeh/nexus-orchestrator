import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  DomainEventEnvelope,
  DomainEventOutboxRecord,
} from './domain-event-bus.types';
import { DatabaseDomainEventOutboxStore } from './database-domain-event-outbox.store';
import { DomainEventOutboxEntity } from './database/entities/domain-event-outbox.entity';

const makeEntity = (
  overrides: Partial<DomainEventOutboxEntity> = {},
): DomainEventOutboxEntity => {
  const entity = new DomainEventOutboxEntity();
  entity.eventId = 'evt-1';
  entity.eventType = 'UserCreated';
  entity.aggregateId = 'user-1';
  entity.aggregateType = 'user';
  entity.payload = { userId: 'u1' };
  entity.correlationId = null;
  entity.causationId = null;
  entity.occurredAt = new Date('2026-06-08T00:00:00.000Z');
  entity.deliveryStatus = 'pending';
  entity.attemptCount = 0;
  entity.lastError = null;
  entity.persistedAt = new Date('2026-06-08T00:00:00.000Z');
  return Object.assign(entity, overrides);
};

const mockRepo = {
  save: vi.fn(),
  findPending: vi.fn(),
  updateStatus: vi.fn(),
  incrementAttemptCount: vi.fn(),
};

const baseEnvelope: DomainEventEnvelope = {
  eventId: 'evt-1',
  eventType: 'UserCreated',
  aggregateId: 'user-1',
  aggregateType: 'user',
  payload: { userId: 'u1' },
  occurredAt: new Date('2026-06-08T00:00:00.000Z'),
};

describe('DatabaseDomainEventOutboxStore', () => {
  let store: DatabaseDomainEventOutboxStore;

  beforeEach(() => {
    vi.resetAllMocks();
    store = new DatabaseDomainEventOutboxStore(mockRepo as any);
  });

  describe('append', () => {
    it('saves a new entity with all envelope fields and status pending', async () => {
      const savedEntity = makeEntity();
      mockRepo.save.mockResolvedValue(savedEntity);

      const result = await store.append(baseEnvelope);

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt-1',
          eventType: 'UserCreated',
          aggregateId: 'user-1',
          aggregateType: 'user',
          payload: { userId: 'u1' },
          deliveryStatus: 'pending',
          attemptCount: 0,
        }),
      );
      expect(result.eventId).toBe('evt-1');
      expect(result.deliveryStatus).toBe('pending');
      expect(result.persistedAt).toBeInstanceOf(Date);
    });

    it('maps optional correlationId and causationId from envelope', async () => {
      const envelopeWithIds: DomainEventEnvelope = {
        ...baseEnvelope,
        correlationId: 'corr-1',
        causationId: 'cause-1',
      };
      const savedEntity = makeEntity({
        correlationId: 'corr-1',
        causationId: 'cause-1',
      });
      mockRepo.save.mockResolvedValue(savedEntity);

      await store.append(envelopeWithIds);

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'corr-1',
          causationId: 'cause-1',
        }),
      );
    });

    it('strips NUL bytes from payload strings so the JSONB insert cannot abort', async () => {
      // PostgreSQL text/jsonb cannot store U+0000. A failed execution whose
      // error_message embeds raw Docker log bytes would otherwise abort the
      // outbox INSERT ("unsupported Unicode escape sequence") and wedge the run.
      const NUL = String.fromCharCode(0);
      mockRepo.save.mockResolvedValue(makeEntity());

      await store.append({
        ...baseEnvelope,
        payload: {
          error_message: `health check timed out${NUL}${NUL}npm warn`,
          nested: { detail: `frame${NUL}header` },
          list: [`a${NUL}b`],
          count: 3,
        },
      });

      // The persisted payload must be NUL-free in every nested string while
      // preserving non-string values verbatim.
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: {
            error_message: 'health check timed outnpm warn',
            nested: { detail: 'frameheader' },
            list: ['ab'],
            count: 3,
          },
        }),
      );
    });

    it('returns an immutable copy of payload', async () => {
      const savedEntity = makeEntity();
      mockRepo.save.mockResolvedValue(savedEntity);

      const result = await store.append(baseEnvelope);

      // Mutating result.payload should not affect the original
      result.payload['extra'] = 'tampered';
      const result2 = await store.append(baseEnvelope);
      expect(result2.payload).not.toHaveProperty('extra');
    });
  });

  describe('listPending', () => {
    it('returns mapped DomainEventOutboxRecord array from repository', async () => {
      const rows = [makeEntity()];
      mockRepo.findPending.mockResolvedValue(rows);

      const result = await store.listPending();

      expect(mockRepo.findPending).toHaveBeenCalledWith(100);
      expect(result).toHaveLength(1);
      const record = result[0];
      expect(record.eventId).toBe('evt-1');
      expect(record.eventType).toBe('UserCreated');
      expect(record.deliveryStatus).toBe('pending');
      expect(record.attemptCount).toBe(0);
    });

    it('passes custom limit to repository', async () => {
      mockRepo.findPending.mockResolvedValue([]);

      await store.listPending(50);

      expect(mockRepo.findPending).toHaveBeenCalledWith(50);
    });
  });

  describe('markDelivered', () => {
    it('calls updateStatus with delivered', async () => {
      mockRepo.updateStatus.mockResolvedValue(undefined);

      await store.markDelivered('evt-1');

      expect(mockRepo.updateStatus).toHaveBeenCalledWith('evt-1', 'delivered');
    });
  });

  describe('markFailed', () => {
    it('increments attempt count then updates status with error message', async () => {
      mockRepo.incrementAttemptCount.mockResolvedValue(undefined);
      mockRepo.updateStatus.mockResolvedValue(undefined);

      await store.markFailed('evt-1', new Error('boom'));

      expect(mockRepo.incrementAttemptCount).toHaveBeenCalledWith('evt-1');
      expect(mockRepo.updateStatus).toHaveBeenCalledWith('evt-1', 'failed', {
        lastError: 'boom',
      });
    });
  });
});
