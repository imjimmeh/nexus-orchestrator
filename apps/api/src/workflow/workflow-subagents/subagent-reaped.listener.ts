import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Docker from 'dockerode';
import type { DomainEventEnvelope } from '../../domain-events/domain-event-bus.types';
import { InProcessDomainEventBus } from '../../domain-events/in-process-domain-event.bus';
import { LOCAL_DOMAIN_EVENT_FANOUT } from '../../domain-events/outbox-domain-event.bus';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import type { ExecutionEntity } from '../../execution-lifecycle/database/entities/execution.entity';
import {
  EXECUTION_EVENT_TYPES,
  type ExecutionState,
} from '../../execution-lifecycle/execution-lifecycle.contracts';
import { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import { collectContainerDiagnostics } from './subagent-container-diagnostics.helpers';
import { mirrorSubagentDetails } from './subagent-details-mirror.helpers';
import { MeshDelegationService } from './mesh-delegation.service';

const SUBAGENT_EXECUTION_KIND = 'subagent';
const DEFAULT_REAP_FAILURE_REASON = 'reaped';

/**
 * Terminal execution states that a subagent could have reached on its own,
 * independently of this reap. The `ExecutionProjector` rejects the
 * `reaped` transition out of these states (they have no legal outgoing edges),
 * so the row staying in one of them means the subagent was already finalized
 * and this reap is a no-op — mirroring the legacy `subagent_executions.status`
 * (`Completed`/`Failed`) idempotency guard. A row that did transition to
 * `reaped` is the one this listener owns and must process.
 */
const PRE_REAP_TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/**
 * Reacts to {@link EXECUTION_EVENT_TYPES.reaped} domain events for subagent
 * executions, reproducing the legacy reaper's side effects on the parallel
 * `subagent_executions` projection: it marks the row Failed with captured
 * container diagnostics and cancels any in-flight mesh delegation.
 *
 * The supervisor is a pure emitter, so these writes live in this listener. The
 * linked chat session is intentionally NOT touched here — that cascade is owned
 * by `ChatSessionTerminalRouter`, which marks the chat session Failed off the
 * subagent `executions` row's `chat_session_id` (populated at spawn time).
 */
@Injectable()
export class SubagentReapedListener implements OnModuleInit {
  private readonly logger = new Logger(SubagentReapedListener.name);

  constructor(
    @Inject(LOCAL_DOMAIN_EVENT_FANOUT)
    private readonly bus: InProcessDomainEventBus,
    private readonly executionRepo: ExecutionRepository,
    private readonly subagentDetailsRepo: SubagentDetailsRepository,
    private readonly meshDelegation: MeshDelegationService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly containerOrchestrator: ContainerOrchestratorService,
  ) {}

  onModuleInit(): void {
    this.bus.on(EXECUTION_EVENT_TYPES.reaped, (event) =>
      this.onExecutionReaped(event),
    );
  }

  async onExecutionReaped(event: DomainEventEnvelope): Promise<void> {
    try {
      const execution = await this.executionRepo.findById(event.aggregateId);
      if (!execution || execution.kind !== SUBAGENT_EXECUTION_KIND) {
        return;
      }

      if (PRE_REAP_TERMINAL_STATES.has(execution.state)) {
        return;
      }

      await this.applyReap(execution, event);
    } catch (error) {
      this.logger.error(
        `Failed to handle execution.reaped for subagent ${event.aggregateId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async applyReap(
    execution: ExecutionEntity,
    event: DomainEventEnvelope,
  ): Promise<void> {
    const completedAt = new Date();
    const childContainerId = execution.container_id ?? null;
    const diagnostics = await collectContainerDiagnostics(
      this.docker,
      childContainerId,
    );

    if (diagnostics?.logs_tail.startsWith('Failed to collect logs')) {
      this.logger.warn(
        `Could not collect container logs for reaped subagent execution ${execution.id} (container: ${childContainerId ?? 'none'}): ${diagnostics.logs_tail}`,
      );
    }

    const failureReason = this.resolveFailureReason(event);

    const result = {
      status: 'Failed',
      failure_reason: failureReason,
      error: this.resolveErrorMessage(event),
      reaped_at: completedAt.toISOString(),
      container_diagnostics: diagnostics,
    };

    await mirrorSubagentDetails(this.subagentDetailsRepo, this.logger, {
      execution_id: execution.id,
      result,
      is_active: false,
    });

    await this.meshDelegation.handleSubagentCancellation({
      subagentExecutionId: execution.id,
      reason: failureReason,
    });

    await this.removeReapedContainer(execution.id, childContainerId);
  }

  /**
   * Force-removes the reaped subagent's container after diagnostics have been
   * captured. A subagent can be reaped (e.g. a `container_lost` false positive
   * from a stale heartbeat) while its container is still alive; without this the
   * container lingers indefinitely, counting against the managed-container cap
   * and starving live runs of provisioning slots. Never throws — the reap is
   * already durable and a missing/already-gone container is the success case.
   */
  private async removeReapedContainer(
    executionId: string,
    childContainerId: string | null,
  ): Promise<void> {
    if (!childContainerId) {
      return;
    }
    try {
      await this.containerOrchestrator.removeContainer(childContainerId);
    } catch (error) {
      this.logger.warn(
        `Could not remove container ${childContainerId} for reaped subagent execution ${executionId}: ${(error as Error).message}`,
      );
    }
  }

  private resolveFailureReason(event: DomainEventEnvelope): string {
    const value = event.payload.failure_reason;
    return typeof value === 'string' && value.length > 0
      ? value
      : DEFAULT_REAP_FAILURE_REASON;
  }

  private resolveErrorMessage(event: DomainEventEnvelope): string {
    const value = event.payload.error_message;
    return typeof value === 'string' && value.length > 0
      ? value
      : `Subagent execution reaped by supervisor (${this.resolveFailureReason(event)})`;
  }
}
