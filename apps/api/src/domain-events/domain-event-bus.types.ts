export type DomainEventDeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface DomainEventEnvelope {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  occurredAt: Date;
}

export interface DomainEventOutboxRecord extends DomainEventEnvelope {
  deliveryStatus: DomainEventDeliveryStatus;
  attemptCount: number;
  lastError?: string;
  persistedAt: Date;
}

export interface DomainEventBus {
  publish(event: DomainEventEnvelope): Promise<void>;
  publishAll(events: DomainEventEnvelope[]): Promise<void>;
}

export interface DomainEventOutboxStore {
  append(event: DomainEventEnvelope): Promise<DomainEventOutboxRecord>;
  markDelivered(eventId: string): Promise<void>;
  markFailed(eventId: string, error: Error): Promise<void>;
  listPending(limit?: number): Promise<DomainEventOutboxRecord[]>;
}

export type DomainEventHandler =
  | ((event: DomainEventEnvelope) => Promise<void>)
  | ((event: DomainEventEnvelope) => void);
