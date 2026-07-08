import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CodeChangeProposalPayloadSchema,
  ImprovementTaskRequestedEventEnvelopeV1Schema,
} from '@nexus/core';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { ImprovementTaskEventPublisher } from '../improvement-task-event.publisher';
import type { ImprovementProposal } from '../database/entities/improvement-proposal.entity';
import {
  type IImprovementApplier,
  type ImprovementApplyResult,
} from './improvement-applier.types';
import { buildImprovementTaskRequestedEnvelope } from './code-change.applier.helpers';

/**
 * `code_change` applier — publishes the neutral `improvement.task.requested.v1`
 * envelope onto the core lifecycle stream (via `ImprovementTaskEventPublisher`,
 * Task 3) so a downstream domain can turn the brief into its own tracked
 * representation.
 *
 * Boundary note: this applier never references any downstream consumer's
 * domain. Delivery is asynchronous, so a successful `apply()` only means "the
 * brief was published" — routing outcomes (including parking when no
 * destination is configured) are recorded by the consuming service, not here.
 * `unrouted` is therefore never set by this applier. There is no `rollback`
 * (a filed brief is withdrawn downstream, not rolled back here) and no
 * `rollback_data` (the applier mutates nothing locally). A retried `apply`
 * re-publishes the same `proposalId`, which the downstream consumer treats
 * idempotently (Task 7), so the applier is idempotent end-to-end.
 */
@Injectable()
export class CodeChangeApplier implements IImprovementApplier {
  readonly kind = 'code_change' as const;
  private readonly logger = new Logger(CodeChangeApplier.name);

  constructor(
    private readonly publisher: ImprovementTaskEventPublisher,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult> {
    const parsedPayload = CodeChangeProposalPayloadSchema.safeParse(
      proposal.payload,
    );
    if (!parsedPayload.success) {
      return {
        ok: false,
        detail: `invalid code_change payload: ${parsedPayload.error.message}`,
      };
    }

    try {
      const envelope = ImprovementTaskRequestedEventEnvelopeV1Schema.parse(
        buildImprovementTaskRequestedEnvelope({
          proposalId: proposal.id,
          occurrenceCount: proposal.occurrence_count,
          payload: parsedPayload.data,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
        }),
      );

      await this.publisher.publish(envelope);
    } catch (err: unknown) {
      const message = describeError(err);
      this.logger.warn(
        `code_change proposal ${proposal.id} failed to publish improvement.task.requested.v1: ${message}`,
      );
      return {
        ok: false,
        detail: `failed to publish improvement.task.requested.v1: ${message}`,
      };
    }

    await this.eventLedger.emitBestEffort({
      domain: 'improvement',
      eventName: 'improvement.task.requested.v1',
      outcome: 'success',
      source: CodeChangeApplier.name,
      correlationId: proposal.id,
      payload: {
        proposalId: proposal.id,
        severity: parsedPayload.data.severity,
      },
    });

    return {
      ok: true,
      detail:
        'improvement.task.requested.v1 published; downstream routing is asynchronous and recorded by the consuming service',
    };
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
