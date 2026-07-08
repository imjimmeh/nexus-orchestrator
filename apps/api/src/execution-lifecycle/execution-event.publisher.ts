import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxDomainEventBus } from '../domain-events/outbox-domain-event.bus';
import type { DomainEventEnvelope } from '../domain-events/domain-event-bus.types';
import {
  EXECUTION_AGGREGATE_TYPE,
  EXECUTION_EVENT_TYPES,
  type ExecutionEventType,
  type ExecutionFailureReason,
  type ExecutionKind,
} from './execution-lifecycle.contracts';
import type { OrchestratorIpResolverStrategy } from './execution-dispatch.service.types';

interface CreatedPayload {
  kind: ExecutionKind;
  parent_execution_id?: string | null;
  workflow_run_id?: string | null;
  chat_session_id?: string | null;
  container_tier?: number;
}

interface FailurePayload {
  failure_reason: ExecutionFailureReason;
  error_message?: string | null;
}

/**
 * Aggregate type used for the orchestrator IP resolution telemetry
 * events emitted from {@link ExecutionEventPublisher.ipResolved} and
 * {@link ExecutionEventPublisher.ipResolutionFailed}. Distinct from
 * `EXECUTION_AGGREGATE_TYPE` because IP resolution describes the
 * orchestrator (a shared, long-lived resource) rather than any single
 * execution row, and consumers filtering the outbox by `aggregateType`
 * should be able to isolate the resolution stream cleanly.
 */
const EXECUTION_DISPATCH_AGGREGATE_TYPE = 'execution_dispatch';

interface DispatchIpResolvedPayload {
  strategy: OrchestratorIpResolverStrategy;
  resolvedIp: string;
  orchestratorUrl: string;
}

interface DispatchIpResolutionFailedPayload {
  strategy: OrchestratorIpResolverStrategy;
  orchestratorUrl: string;
  errorMessage: string;
}

@Injectable()
export class ExecutionEventPublisher {
  constructor(private readonly bus: OutboxDomainEventBus) {}

  private async emit(
    eventType: ExecutionEventType,
    aggregateId: string,
    payload: Record<string, unknown>,
    options?: {
      correlationId?: string;
      aggregateType?: string;
    },
  ): Promise<void> {
    const envelope: DomainEventEnvelope = {
      eventId: randomUUID(),
      eventType,
      aggregateId,
      aggregateType: options?.aggregateType ?? EXECUTION_AGGREGATE_TYPE,
      payload,
      correlationId: options?.correlationId,
      occurredAt: new Date(),
    };
    await this.bus.publish(envelope);
  }

  async created(executionId: string, payload: CreatedPayload): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.created, executionId, { ...payload });
  }

  async provisioning(executionId: string): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.provisioning, executionId, {});
  }

  async provisioned(executionId: string, containerId: string): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.provisioned, executionId, {
      container_id: containerId,
    });
  }

  async running(executionId: string): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.running, executionId, {});
  }

  async heartbeat(
    executionId: string,
    payload: { source: string },
  ): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.heartbeat, executionId, {
      ...payload,
    });
  }

  async completed(executionId: string): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.completed, executionId, {});
  }

  async failed(executionId: string, payload: FailurePayload): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.failed, executionId, { ...payload });
  }

  async reaped(executionId: string, payload: FailurePayload): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.reaped, executionId, { ...payload });
  }

  async cancelled(executionId: string, payload: FailurePayload): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.cancelled, executionId, {
      ...payload,
    });
  }

  async paused(
    executionId: string,
    payload: { reason: string },
  ): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.paused, executionId, { ...payload });
  }

  async resumed(
    executionId: string,
    payload: { via: 'unpause' | 'rehydrate' },
  ): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.resumed, executionId, { ...payload });
  }

  /**
   * Publish an `execution.dispatch.ip_resolved` telemetry event after a
   * successful orchestrator IP resolution. Carries the strategy actually
   * used (which may differ from the configured override when the
   * delegating resolver fell back to `'default'`), the resolved IP, and
   * the sanitized orchestrator URL (no user-info, no query string).
   *
   * The `aggregateId` is the orchestrator host — the natural identifier
   * for a long-lived shared resource whose resolution state changes
   * over time — and the `aggregateType` is `'execution_dispatch'` (not
   * `'execution'`) so outbox consumers can filter the resolution stream
   * without conflating it with per-execution lifecycle events.
   */
  async ipResolved(payload: DispatchIpResolvedPayload): Promise<void> {
    await this.emit(
      EXECUTION_EVENT_TYPES.ipResolved,
      extractOrchestratorHost(payload.orchestratorUrl),
      { ...payload },
      { aggregateType: EXECUTION_DISPATCH_AGGREGATE_TYPE },
    );
  }

  /**
   * Publish an `execution.dispatch.ip_resolution_failed` telemetry event
   * when the configured strategy cannot produce a usable IP. The error
   * message is carried in the payload (so the failure trail is visible
   * without joining against the outbox-attempt log), but the raw `Error`
   * object is NOT propagated — callers attach the underlying error to
   * the `OrchestratorIpResolutionError.cause` chain and let the log
   * pipeline capture it via the domain-event envelope's correlation
   * trail.
   */
  async ipResolutionFailed(
    payload: DispatchIpResolutionFailedPayload,
  ): Promise<void> {
    await this.emit(
      EXECUTION_EVENT_TYPES.ipResolutionFailed,
      extractOrchestratorHost(payload.orchestratorUrl),
      { ...payload },
      { aggregateType: EXECUTION_DISPATCH_AGGREGATE_TYPE },
    );
  }
}

/**
 * Best-effort extraction of the orchestrator host from a (possibly
 * invalid / empty) URL string. Returns a stable identifier suitable for
 * use as a domain-event `aggregateId` even when the input fails WHATWG
 * parsing — the string `'unknown'` is used as the fallback so the
 * envelope remains well-formed rather than crashing the publish path.
 */
function extractOrchestratorHost(orchestratorUrl: string): string {
  try {
    const parsed = new URL(orchestratorUrl);
    return parsed.host || 'unknown';
  } catch {
    return 'unknown';
  }
}
