import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { EventLedger } from '../entities/event-ledger.entity';

export type { EventLedgerQueryParams } from './event-ledger.repository.types';
import type { EventLedgerQueryParams } from './event-ledger.repository.types';

type LedgerFilterDefinition = {
  param: keyof EventLedgerQueryParams;
  clause: string;
  bindingKey: string;
};

const LEDGER_FILTER_DEFINITIONS: LedgerFilterDefinition[] = [
  { param: 'domain', clause: 'event.domain = :domain', bindingKey: 'domain' },
  {
    param: 'event_name',
    clause: 'event.event_name = :eventName',
    bindingKey: 'eventName',
  },
  {
    param: 'outcome',
    clause: 'event.outcome = :outcome',
    bindingKey: 'outcome',
  },
  {
    param: 'severity',
    clause: 'event.severity = :severity',
    bindingKey: 'severity',
  },
  { param: 'source', clause: 'event.source = :source', bindingKey: 'source' },
  {
    param: 'actor_id',
    clause: 'event.actor_id = :actorId',
    bindingKey: 'actorId',
  },
  {
    param: 'actor_type',
    clause: 'event.actor_type = :actorType',
    bindingKey: 'actorType',
  },
  {
    param: 'scopeId',
    clause: 'event.scope_id = :scopeId',
    bindingKey: 'scopeId',
  },
  {
    param: 'contextId',
    clause: 'event.context_id = :contextId',
    bindingKey: 'contextId',
  },
  {
    param: 'workflow_run_id',
    clause: 'event.workflow_run_id = :workflowRunId',
    bindingKey: 'workflowRunId',
  },
  {
    param: 'workflow_id',
    clause: 'event.workflow_id = :workflowId',
    bindingKey: 'workflowId',
  },
  { param: 'job_id', clause: 'event.job_id = :jobId', bindingKey: 'jobId' },
  {
    param: 'step_id',
    clause: 'event.step_id = :stepId',
    bindingKey: 'stepId',
  },
  {
    param: 'tool_name',
    clause: 'event.tool_name = :toolName',
    bindingKey: 'toolName',
  },
  {
    param: 'request_id',
    clause: 'event.request_id = :requestId',
    bindingKey: 'requestId',
  },
  {
    param: 'correlation_id',
    clause: 'event.correlation_id = :correlationId',
    bindingKey: 'correlationId',
  },
  {
    param: 'occurred_after',
    clause: 'event.occurred_at >= :occurredAfter',
    bindingKey: 'occurredAfter',
  },
  {
    param: 'occurred_before',
    clause: 'event.occurred_at <= :occurredBefore',
    bindingKey: 'occurredBefore',
  },
];

@Injectable()
export class EventLedgerRepository {
  constructor(
    @InjectRepository(EventLedger)
    private readonly repository: Repository<EventLedger>,
  ) {}

  async append(data: Partial<EventLedger>): Promise<EventLedger> {
    const entry = this.repository.create(data);
    return this.repository.save(entry);
  }

  async findById(id: string): Promise<EventLedger | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByCorrelationId(
    correlationId: string,
    limit = 100,
    offset = 0,
  ): Promise<[EventLedger[], number]> {
    return this.repository.findAndCount({
      where: { correlation_id: correlationId },
      order: { occurred_at: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async query(
    params: EventLedgerQueryParams,
  ): Promise<[EventLedger[], number]> {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
    const offset = Math.max(params.offset ?? 0, 0);

    const qb = this.repository.createQueryBuilder('event');
    this.applyFilters(qb, this.buildFilters(params));

    if (params.search) {
      const term = `%${params.search}%`;
      qb.andWhere(
        '(event.domain ILIKE :searchTerm OR event.event_name ILIKE :searchTerm OR event.tool_name ILIKE :searchTerm)',
        { searchTerm: term },
      );
    }

    const allowedSorts = ['occurred_at', 'domain', 'severity', 'outcome'];
    const sortBy =
      params.sort_by && allowedSorts.includes(params.sort_by)
        ? params.sort_by
        : 'occurred_at';
    const sortDir = params.sort_dir ?? 'desc';
    qb.orderBy(`event.${sortBy}`, sortDir.toUpperCase() as 'ASC' | 'DESC');

    qb.take(limit).skip(offset);

    return qb.getManyAndCount();
  }

  async findLatestTurnForStep(params: {
    workflowRunId: string;
    stepId: string;
  }): Promise<EventLedger | null> {
    return this.repository
      .createQueryBuilder('event')
      .where('event.workflow_run_id = :workflowRunId', {
        workflowRunId: params.workflowRunId,
      })
      .andWhere('event.step_id = :stepId', { stepId: params.stepId })
      .andWhere('event.event_name = :eventName', {
        eventName: 'workflow.turn.completed',
      })
      .orderBy('event.occurred_at', 'DESC')
      .take(1)
      .getOne();
  }

  /**
   * Find the most recent `memory.setting.changed.v1` event whose
   * JSONB `payload->>'source'` matches the supplied identifier.
   *
   * Used by {@link DistillationThresholdService} to rehydrate the
   * `(value, source)` baseline on replica startup so change
   * detection does not diverge across processes or after restarts.
   *
   * Mirrors the shape of {@link findLatestTurnForStep}: one row,
   * ordered by `occurred_at DESC`, with `payload` already parsed
   * to a typed object by the TypeORM `jsonb` mapping.
   */
  async findLatestMemorySettingChangedByPayloadSource(params: {
    source: string;
  }): Promise<EventLedger | null> {
    return this.repository
      .createQueryBuilder('event')
      .where('event.event_name = :eventName', {
        eventName: 'memory.setting.changed.v1',
      })
      .andWhere("event.payload->>'source' = :source", {
        source: params.source,
      })
      .orderBy('event.occurred_at', 'DESC')
      .take(1)
      .getOne();
  }

  private buildFilters(params: EventLedgerQueryParams): Array<{
    value: unknown;
    clause: string;
    bindings: Record<string, unknown>;
  }> {
    return LEDGER_FILTER_DEFINITIONS.map((filter) => ({
      value: params[filter.param],
      clause: filter.clause,
      bindings: { [filter.bindingKey]: params[filter.param] },
    }));
  }

  private applyFilters(
    queryBuilder: SelectQueryBuilder<EventLedger>,
    filters: Array<{
      value: unknown;
      clause: string;
      bindings: Record<string, unknown>;
    }>,
  ): void {
    for (const filter of filters) {
      if (filter.value) {
        queryBuilder.andWhere(filter.clause, filter.bindings);
      }
    }
  }
}
