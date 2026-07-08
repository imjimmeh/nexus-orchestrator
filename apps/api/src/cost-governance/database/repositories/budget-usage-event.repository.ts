import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { BudgetUsageEvent } from '../entities/budget-usage-event.entity';
import type {
  BudgetSummaryRow,
  BudgetTimelineRow,
} from '../../dto/budget-query.dto.types';

@Injectable()
export class BudgetUsageEventRepository {
  constructor(
    @InjectRepository(BudgetUsageEvent)
    private readonly repo: Repository<BudgetUsageEvent>,
  ) {}

  async recordUsage(
    data: Partial<BudgetUsageEvent>,
  ): Promise<BudgetUsageEvent> {
    const entity = this.repo.create(data as DeepPartial<BudgetUsageEvent>);
    return this.repo.save(entity);
  }

  async getSpendInWindow(
    scopeId: string | null,
    contextId: string | null,
    windowStart: Date,
  ): Promise<{ totalCents: number; totalTokens: number }> {
    const qb = this.repo
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.estimated_cost_cents), 0)', 'totalCents')
      .addSelect('COALESCE(SUM(e.total_tokens), 0)', 'totalTokens')
      .where('e.created_at >= :windowStart', { windowStart });

    if (scopeId) {
      qb.andWhere('e.scope_id = :scopeId', { scopeId });
    }
    if (contextId) {
      qb.andWhere('e.context_id = :contextId', { contextId });
    }

    const raw: { totalCents: string; totalTokens: string } | undefined =
      await qb.getRawOne();
    return {
      totalCents: Number(raw?.totalCents ?? 0),
      totalTokens: Number(raw?.totalTokens ?? 0),
    };
  }

  /**
   * Sums the cumulative token usage recorded for a single run (every turn is
   * stored with `context_id = runId`). Used to attach run totals to terminal
   * lifecycle events so downstream consumers can project per-context spend.
   */
  /**
   * Sum `estimated_cost_cents` over all usage events of the given
   * `context_type`s recorded since `windowStart` (EPIC-212 Phase 3, Task 6,
   * cost-per-promoted-memory numerator). Returns `0` when there are no
   * matching rows. An empty `contextTypes` list returns `0` without a query.
   */
  async sumCostCentsInWindowByContextTypes(
    contextTypes: readonly string[],
    windowStart: Date,
  ): Promise<number> {
    if (contextTypes.length === 0) {
      return 0;
    }
    const raw: { totalCents: string } | undefined = await this.repo
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.estimated_cost_cents), 0)', 'totalCents')
      .where('e.created_at >= :windowStart', { windowStart })
      .andWhere('e.context_type IN (:...contextTypes)', { contextTypes })
      .getRawOne();
    return Number(raw?.totalCents ?? 0);
  }

  async getRunTotals(runId: string): Promise<{
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostCents: number;
    pricedTurnCount: number;
  }> {
    const raw:
      | {
          totalTokens: string;
          inputTokens: string;
          outputTokens: string;
          estimatedCostCents: string;
          pricedTurnCount: string;
        }
      | undefined = await this.repo
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.total_tokens), 0)', 'totalTokens')
      .addSelect('COALESCE(SUM(e.input_tokens), 0)', 'inputTokens')
      .addSelect('COALESCE(SUM(e.output_tokens), 0)', 'outputTokens')
      .addSelect(
        'COALESCE(SUM(e.estimated_cost_cents), 0)',
        'estimatedCostCents',
      )
      .addSelect(
        'COALESCE(COUNT(e.id) FILTER (WHERE e.estimated_cost_cents IS NOT NULL), 0)',
        'pricedTurnCount',
      )
      .where('e.context_id = :runId', { runId })
      .getRawOne();

    return {
      totalTokens: Number(raw?.totalTokens ?? 0),
      inputTokens: Number(raw?.inputTokens ?? 0),
      outputTokens: Number(raw?.outputTokens ?? 0),
      estimatedCostCents: Number(raw?.estimatedCostCents ?? 0),
      pricedTurnCount: Number(raw?.pricedTurnCount ?? 0),
    };
  }

  async getRunTotalsByModel(runId: string): Promise<
    {
      model_id: string;
      provider_name: string;
      model_name: string;
      input_tokens: number;
      output_tokens: number;
      cost_cents: number;
    }[]
  > {
    const raw: {
      model_id: string;
      provider_name: string;
      model_name: string;
      input_tokens: string;
      output_tokens: string;
      cost_cents: string;
    }[] = await this.repo
      .createQueryBuilder('e')
      .select('e.model_id', 'model_id')
      .addSelect('e.provider_name', 'provider_name')
      .addSelect('e.model_name', 'model_name')
      .addSelect('COALESCE(SUM(e.input_tokens), 0)', 'input_tokens')
      .addSelect('COALESCE(SUM(e.output_tokens), 0)', 'output_tokens')
      .addSelect('COALESCE(SUM(e.estimated_cost_cents), 0)', 'cost_cents')
      .where('e.context_id = :runId', { runId })
      .andWhere('e.model_id IS NOT NULL')
      .addGroupBy('e.model_id, e.provider_name, e.model_name')
      .getRawMany();

    return raw.map((row) => ({
      model_id: row.model_id,
      provider_name: row.provider_name,
      model_name: row.model_name,
      input_tokens: Number(row.input_tokens),
      output_tokens: Number(row.output_tokens),
      cost_cents: Number(row.cost_cents),
    }));
  }

  async findByContext(
    contextType: string,
    contextId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<BudgetUsageEvent[]> {
    return this.repo.find({
      where: { context_type: contextType, context_id: contextId },
      order: { created_at: 'DESC' as const },
      take: limit,
      skip: offset,
    });
  }

  async getSummary(params: {
    scopeId?: string;
    groupBy?: 'provider' | 'model' | 'scope' | 'context';
    window?: 'daily' | 'weekly' | 'monthly';
    from?: Date;
    to?: Date;
  }): Promise<BudgetSummaryRow[]> {
    const groupColumn = params.groupBy
      ? (
          {
            provider: 'provider_name',
            model: 'model_name',
            scope: 'scope_id',
            context: 'context_id',
          } as const
        )[params.groupBy]
      : null;

    const keyExpression = groupColumn
      ? `COALESCE(e.${groupColumn}, 'unknown')`
      : "'total'";

    const qb = this.repo
      .createQueryBuilder('e')
      .select(keyExpression, 'key')
      .addSelect('COALESCE(SUM(e.estimated_cost_cents), 0)', 'total_cents')
      .addSelect('COALESCE(SUM(e.total_tokens), 0)', 'total_tokens')
      .addSelect('COALESCE(COUNT(e.id), 0)', 'count')
      .addSelect(
        'COALESCE(SUM((e.estimated_cost_cents IS NULL)::int), 0)',
        'unpriced_count',
      );

    if (params.scopeId) {
      qb.andWhere('e.scope_id = :scopeId', { scopeId: params.scopeId });
    }

    if (params.from) {
      qb.andWhere('e.created_at >= :from', { from: params.from });
    }

    if (params.to) {
      qb.andWhere('e.created_at <= :to', { to: params.to });
    }

    if (groupColumn) {
      qb.addGroupBy(keyExpression);
    }

    qb.orderBy('total_cents', 'DESC');

    const rows = await qb.getRawMany<BudgetSummaryRow>();
    return rows;
  }

  async queryEvents(params: {
    scopeId?: string;
    contextType?: string;
    contextId?: string;
    providerName?: string;
    modelName?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<BudgetUsageEvent[]> {
    const qb = this.buildFilterQuery(params);
    qb.orderBy('e.created_at', 'DESC')
      .take(params.limit ?? 50)
      .skip(params.offset ?? 0);

    return qb.getMany();
  }

  async countEvents(params: {
    scopeId?: string;
    contextType?: string;
    contextId?: string;
    providerName?: string;
    modelName?: string;
    from?: Date;
    to?: Date;
  }): Promise<number> {
    const qb = this.buildFilterQuery(params);
    return qb.getCount();
  }

  private buildFilterQuery(params: {
    scopeId?: string;
    contextType?: string;
    contextId?: string;
    providerName?: string;
    modelName?: string;
    from?: Date;
    to?: Date;
  }) {
    const qb = this.repo.createQueryBuilder('e');

    if (params.scopeId) {
      qb.andWhere('e.scope_id = :scopeId', { scopeId: params.scopeId });
    }
    if (params.contextType) {
      qb.andWhere('e.context_type = :contextType', {
        contextType: params.contextType,
      });
    }
    if (params.contextId) {
      qb.andWhere('e.context_id = :contextId', { contextId: params.contextId });
    }
    if (params.providerName) {
      qb.andWhere('e.provider_name = :providerName', {
        providerName: params.providerName,
      });
    }
    if (params.modelName) {
      qb.andWhere('e.model_name = :modelName', { modelName: params.modelName });
    }
    if (params.from) {
      qb.andWhere('e.created_at >= :from', { from: params.from });
    }
    if (params.to) {
      qb.andWhere('e.created_at <= :to', { to: params.to });
    }

    return qb;
  }

  async getTimeline(params: {
    scopeId?: string;
    window?: 'daily' | 'weekly' | 'monthly';
    from?: Date;
    to?: Date;
  }): Promise<BudgetTimelineRow[]> {
    const truncExpr =
      params.window === 'monthly'
        ? "to_char(date_trunc('month', e.created_at), 'YYYY-MM')"
        : params.window === 'weekly'
          ? "to_char(date_trunc('week', e.created_at), 'YYYY-MM-DD')"
          : "to_char(e.created_at, 'YYYY-MM-DD')";

    const qb = this.repo
      .createQueryBuilder('e')
      .select(truncExpr, 'bucket')
      .addSelect('COALESCE(SUM(e.estimated_cost_cents), 0)', 'total_cents')
      .addSelect('COALESCE(SUM(e.total_tokens), 0)', 'total_tokens')
      .addSelect('COALESCE(COUNT(e.id), 0)', 'count');

    if (params.scopeId) {
      qb.andWhere('e.scope_id = :scopeId', { scopeId: params.scopeId });
    }
    if (params.from) {
      qb.andWhere('e.created_at >= :from', { from: params.from });
    }
    if (params.to) {
      qb.andWhere('e.created_at <= :to', { to: params.to });
    }

    qb.addGroupBy('bucket').orderBy('bucket', 'ASC');

    return qb.getRawMany<BudgetTimelineRow>();
  }
}
