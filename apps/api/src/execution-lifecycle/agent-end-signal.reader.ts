import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { EventLedger } from '../runtime/database/entities/event-ledger.entity';
import type { AgentEndSignal } from './agent-end-signal.reader.types';

export type { AgentEndSignal } from './agent-end-signal.reader.types';

const AGENT_COMPLETED_DOMAIN = 'workflow';
const AGENT_COMPLETED_EVENT_NAME = 'workflow.agent.completed';

/**
 * Queries the event ledger for the most recent `workflow.agent.completed` row
 * for a given workflow run and step. Used by the supervisor safety-net to
 * confirm an agent loop has finished without waiting for the max-runtime ceiling.
 */
@Injectable()
export class AgentEndSignalReader {
  constructor(
    @InjectRepository(EventLedger)
    private readonly repository: Repository<EventLedger>,
  ) {}

  async findLatest(
    workflowRunId: string,
    stepId: string,
  ): Promise<AgentEndSignal | null> {
    const row = await this.repository
      .createQueryBuilder('event')
      .where('event.domain = :domain', { domain: AGENT_COMPLETED_DOMAIN })
      .andWhere('event.event_name = :eventName', {
        eventName: AGENT_COMPLETED_EVENT_NAME,
      })
      .andWhere('event.workflow_run_id = :workflowRunId', { workflowRunId })
      .andWhere('event.step_id = :stepId', { stepId })
      .orderBy('event.occurred_at', 'DESC')
      .take(1)
      .getOne();

    if (!row) {
      return null;
    }

    return {
      endedAtMs: row.occurred_at.getTime(),
      outcome: row.outcome === 'failure' ? 'failure' : 'success',
    };
  }
}
