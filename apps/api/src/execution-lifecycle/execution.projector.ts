import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { DomainEventEnvelope } from '../domain-events/domain-event-bus.types';
import { InProcessDomainEventBus } from '../domain-events/in-process-domain-event.bus';
import { LOCAL_DOMAIN_EVENT_FANOUT } from '../domain-events/outbox-domain-event.bus';
import { ExecutionRepository } from './database/repositories/execution.repository';
import {
  EXECUTION_EVENT_TYPES,
  type ExecutionFailureReason,
  type ExecutionKind,
  type ExecutionState,
} from './execution-lifecycle.contracts';

@Injectable()
export class ExecutionProjector implements OnModuleInit {
  private readonly logger = new Logger(ExecutionProjector.name);

  constructor(
    @Inject(LOCAL_DOMAIN_EVENT_FANOUT)
    private readonly bus: InProcessDomainEventBus,
    private readonly repo: ExecutionRepository,
  ) {}

  onModuleInit(): void {
    const E = EXECUTION_EVENT_TYPES;
    this.bus.on(E.created, (e) => this.onCreated(e));
    this.bus.on(E.provisioning, (e) =>
      this.applyStateTransition(e, 'provisioning'),
    );
    this.bus.on(E.provisioned, (e) => this.onProvisioned(e));
    this.bus.on(E.running, (e) => this.applyStateTransition(e, 'running'));
    this.bus.on(E.heartbeat, (e) => this.onHeartbeat(e));
    this.bus.on(E.completed, (e) => this.onCompleted(e));
    this.bus.on(E.failed, (e) => this.onTerminalFailure(e, 'failed'));
    this.bus.on(E.reaped, (e) => this.onTerminalFailure(e, 'reaped'));
    this.bus.on(E.cancelled, (e) => this.onTerminalFailure(e, 'cancelled'));
  }

  private async onCreated(event: DomainEventEnvelope): Promise<void> {
    const payload = event.payload as {
      kind: ExecutionKind;
      parent_execution_id?: string | null;
      workflow_run_id?: string | null;
      chat_session_id?: string | null;
      container_tier?: number;
    };
    await this.repo.create({
      id: event.aggregateId,
      kind: payload.kind,
      parent_execution_id: payload.parent_execution_id ?? null,
      workflow_run_id: payload.workflow_run_id ?? null,
      chat_session_id: payload.chat_session_id ?? null,
      container_tier: payload.container_tier ?? 2,
      state: 'pending',
    });
  }

  private async onProvisioned(event: DomainEventEnvelope): Promise<void> {
    // The row is expected to be in "provisioning" state when this event arrives.
    // Map provisioned -> running and extract container_id from the payload.
    const payload = event.payload as { container_id?: string | null };
    await this.repo.applyTransition(event.aggregateId, 'running', {
      container_id: payload.container_id ?? null,
    });
  }

  private async onHeartbeat(event: DomainEventEnvelope): Promise<void> {
    await this.repo.applyTransition(event.aggregateId, 'running', {
      last_heartbeat_at: new Date(),
    });
  }

  private async onTerminalFailure(
    event: DomainEventEnvelope,
    to: 'failed' | 'reaped' | 'cancelled',
  ): Promise<void> {
    const payload = event.payload as {
      failure_reason: ExecutionFailureReason;
      error_message?: string | null;
    };
    await this.repo.applyTransition(event.aggregateId, to, {
      failure_reason: payload.failure_reason,
      error_message: payload.error_message ?? null,
    });
  }

  /**
   * The state machine requires running -> completing -> completed, so a single
   * completed event projects as a two-step walk.
   */
  private async onCompleted(event: DomainEventEnvelope): Promise<void> {
    await this.repo.applyTransition(event.aggregateId, 'completing');
    await this.repo.applyTransition(event.aggregateId, 'completed');
  }

  private async applyStateTransition(
    event: DomainEventEnvelope,
    to: ExecutionState,
  ): Promise<void> {
    await this.repo.applyTransition(event.aggregateId, to);
  }
}
