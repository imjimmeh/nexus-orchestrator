import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { PluginEventDelivery } from '../entities/plugin-event-delivery.entity';
import type { PluginEventDeliveryStatus } from '../entities/plugin-event-delivery.types';
import {
  type AggregateCountsQueryCriteria,
  type CountPluginEventDeliveriesByStatusFilters,
  type CreatePendingPluginEventDeliveryInput,
  type DeadLetterQueryCriteria,
  type DeliveryQueryCriteria,
  type ListPluginEventDeliveryFilters,
  type MarkDeadLetteredPluginEventDeliveryInput,
  type MarkFailedPluginEventDeliveryInput,
  type PluginEventDeliveryStatusCounts,
} from './plugin-event-delivery.repository.types';
export type { PluginEventDeliveryStatus };
import type {
  AggregateCountsResponseDto,
  DeadLetterResponseDto,
  RecentDeliveryResponseDto,
  RecentDeliveriesResponseDto,
} from '../../dto/plugin-event-delivery.dto';
export type {
  AggregateCountsResponseDto,
  DeadLetterResponseDto,
  RecentDeliveryResponseDto,
  RecentDeliveriesResponseDto,
};

const CLAIMABLE_STATUSES: PluginEventDeliveryStatus[] = ['pending', 'failed'];

@Injectable()
export class PluginEventDeliveryRepository {
  constructor(
    @InjectRepository(PluginEventDelivery)
    private readonly repository: Repository<PluginEventDelivery>,
  ) {}

  async createPending(
    input: CreatePendingPluginEventDeliveryInput,
  ): Promise<PluginEventDelivery> {
    const entity = this.repository.create({
      plugin_id: input.pluginId,
      plugin_version: input.pluginVersion,
      contribution_id: input.contributionId,
      topic: input.topic,
      event_name: input.eventName,
      payload: input.payload,
      correlation_id: input.correlationId ?? null,
      delivery_mode: input.deliveryMode,
      status: 'pending',
      attempt_count: 0,
      max_attempts: input.maxAttempts,
      retry_initial_delay_ms: input.retryInitialDelayMs,
      retry_backoff_multiplier: input.retryBackoffMultiplier,
      dead_letter_enabled: input.deadLetterEnabled,
      next_attempt_at: input.nextAttemptAt,
      delivered_at: null,
      error_code: null,
      error_message: null,
      error_metadata: null,
    });

    return this.repository.save(entity);
  }

  async claimDueDeliveries(
    limit: number,
    now: Date,
  ): Promise<PluginEventDelivery[]> {
    const boundedLimit = Math.max(1, limit);
    const result = await this.repository
      .createQueryBuilder()
      .update(PluginEventDelivery)
      .set({
        status: 'delivering',
        updated_at: () => 'NOW()',
      })
      .where(
        `id IN (
          SELECT id
          FROM plugin_event_deliveries
          WHERE status IN (:...claimableStatuses)
            AND next_attempt_at <= :now
          ORDER BY next_attempt_at ASC
          LIMIT :limit
          FOR UPDATE SKIP LOCKED
        )`,
        {
          claimableStatuses: CLAIMABLE_STATUSES,
          now,
          limit: boundedLimit,
        },
      )
      .returning('*')
      .execute();

    return result.raw as PluginEventDelivery[];
  }

  async markDelivered(
    id: string,
    deliveredAt: Date,
  ): Promise<PluginEventDelivery | null> {
    await this.repository.update(id, {
      status: 'delivered',
      delivered_at: deliveredAt,
      error_code: null,
      error_message: null,
      error_metadata: null,
    });

    return this.repository.findOne({ where: { id } });
  }

  async markFailed(
    input: MarkFailedPluginEventDeliveryInput,
  ): Promise<PluginEventDelivery | null> {
    const updateData: Record<string, unknown> = {
      status: 'failed',
      error_code: input.errorCode,
      error_message: input.errorMessage,
      error_metadata: input.errorMetadata ?? null,
    };

    if (input.nextAttemptAt) {
      updateData.next_attempt_at = input.nextAttemptAt;
    }

    if (input.incrementAttemptCount) {
      updateData.attempt_count = () => 'attempt_count + 1';
    }

    await this.repository.update(input.id, updateData);
    return this.repository.findOne({ where: { id: input.id } });
  }

  async markDeadLettered(
    input: MarkDeadLetteredPluginEventDeliveryInput,
  ): Promise<PluginEventDelivery | null> {
    await this.repository.update(input.id, {
      status: 'dead_lettered',
      error_code: input.errorCode,
      error_message: input.errorMessage,
      error_metadata: input.errorMetadata ?? null,
      next_attempt_at: () => 'NOW()',
    } as QueryDeepPartialEntity<PluginEventDelivery>);

    return this.repository.findOne({ where: { id: input.id } });
  }

  async listByFilters(
    filters: ListPluginEventDeliveryFilters,
  ): Promise<PluginEventDelivery[]> {
    return this.repository.find({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.pluginId ? { plugin_id: filters.pluginId } : {}),
        ...(filters.topic ? { topic: filters.topic } : {}),
        ...(filters.contributionId
          ? { contribution_id: filters.contributionId }
          : {}),
      },
      order: {
        created_at: 'DESC',
      },
      ...(filters.limit ? { take: filters.limit } : {}),
    });
  }

  async listRecentDeliveries(
    filters: ListPluginEventDeliveryFilters,
  ): Promise<PluginEventDelivery[]> {
    return this.listByFilters({
      ...filters,
      limit: filters.limit ?? 50,
    });
  }

  async listDeadLetterDeliveries(
    filters: Omit<ListPluginEventDeliveryFilters, 'status'>,
  ): Promise<PluginEventDelivery[]> {
    return this.listByFilters({
      ...filters,
      status: 'dead_lettered',
      limit: filters.limit ?? 50,
    });
  }

  async countByStatus(
    filters: CountPluginEventDeliveriesByStatusFilters,
  ): Promise<PluginEventDeliveryStatusCounts> {
    const rows = await this.repository
      .createQueryBuilder('delivery')
      .select('delivery.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where(filters.pluginId ? 'delivery.plugin_id = :pluginId' : '1=1', {
        pluginId: filters.pluginId,
      })
      .andWhere(filters.topic ? 'delivery.topic = :topic' : '1=1', {
        topic: filters.topic,
      })
      .andWhere(
        filters.contributionId
          ? 'delivery.contribution_id = :contributionId'
          : '1=1',
        {
          contributionId: filters.contributionId,
        },
      )
      .groupBy('delivery.status')
      .getRawMany<{ status: PluginEventDeliveryStatus; count: string }>();

    const counts: PluginEventDeliveryStatusCounts = {
      pending: 0,
      delivering: 0,
      delivered: 0,
      failed: 0,
      dead_lettered: 0,
    };

    for (const row of rows) {
      counts[row.status] = Number.parseInt(row.count, 10) || 0;
    }

    return counts;
  }

  // -------------------------------------------------------------------------
  // Observability query methods — return plain DTOs, not TypeORM entities
  // -------------------------------------------------------------------------

  /**
   * Returns a paginated list of recent deliveries filtered by the given
   * criteria. All returned records are plain DTO objects with no TypeORM
   * decorators or proxy behaviour.
   */
  async findRecentDeliveries(
    pluginId: string,
    criteria?: DeliveryQueryCriteria,
  ): Promise<RecentDeliveriesResponseDto> {
    const limit = Math.min(Math.max(criteria?.limit ?? 50, 1), 200);
    const offset = Math.max(criteria?.offset ?? 0, 0);

    const qb = this.repository
      .createQueryBuilder('delivery')
      .select('delivery.id', 'id')
      .addSelect('delivery.plugin_id', 'plugin_id')
      .addSelect('delivery.plugin_version', 'plugin_version')
      .addSelect('delivery.contribution_id', 'contribution_id')
      .addSelect('delivery.topic', 'topic')
      .addSelect('delivery.event_name', 'event_name')
      // payload is intentionally excluded — raw payloads are redacted in observability responses
      .addSelect('delivery.correlation_id', 'correlation_id')
      .addSelect('delivery.delivery_mode', 'delivery_mode')
      .addSelect('delivery.status', 'status')
      .addSelect('delivery.attempt_count', 'attempt_count')
      .addSelect('delivery.max_attempts', 'max_attempts')
      .addSelect('delivery.retry_initial_delay_ms', 'retry_initial_delay_ms')
      .addSelect(
        'delivery.retry_backoff_multiplier',
        'retry_backoff_multiplier',
      )
      .addSelect('delivery.dead_letter_enabled', 'dead_letter_enabled')
      .addSelect('delivery.next_attempt_at', 'next_attempt_at')
      .addSelect('delivery.delivered_at', 'delivered_at')
      .addSelect('delivery.error_code', 'error_code')
      .addSelect('delivery.error_message', 'error_message')
      .addSelect('delivery.error_metadata', 'error_metadata')
      .addSelect('delivery.created_at', 'created_at')
      .addSelect('delivery.updated_at', 'updated_at')
      .where('delivery.plugin_id = :pluginId', { pluginId })
      .orderBy('delivery.created_at', 'DESC')
      .offset(offset)
      .limit(limit);

    if (criteria?.topic) {
      qb.andWhere('delivery.topic = :topic', { topic: criteria.topic });
    }

    if (criteria?.status) {
      qb.andWhere('delivery.status = :status', {
        status: criteria.status,
      });
    }

    if (criteria?.contributionId) {
      qb.andWhere('delivery.contribution_id = :contributionId', {
        contributionId: criteria.contributionId,
      });
    }

    const [items, total] = await Promise.all([
      qb.getRawMany<Record<string, unknown>>(),
      qb.clone().offset(0).limit(0).getCount(),
    ]);

    const itemsDto: RecentDeliveryResponseDto[] = items.map((row) => ({
      id: row.id as string,
      pluginId: row.plugin_id as string,
      pluginVersion: row.plugin_version as string,
      contributionId: row.contribution_id as string,
      topic: row.topic as string,
      eventName: row.event_name as string,
      // payload is excluded — raw payloads are redacted in observability responses
      payload: null,
      correlationId: (row.correlation_id as string | null) ?? null,
      deliveryMode: row.delivery_mode as string,
      status: row.status as string,
      attemptCount: row.attempt_count as number,
      maxAttempts: row.max_attempts as number,
      retryInitialDelayMs: row.retry_initial_delay_ms as number,
      retryBackoffMultiplier: row.retry_backoff_multiplier as number,
      deadLetterEnabled: row.dead_letter_enabled as boolean,
      nextAttemptAt: (row.next_attempt_at as Date).toISOString(),
      deliveredAt: row.delivered_at
        ? (row.delivered_at as Date).toISOString()
        : null,
      errorCode: (row.error_code as string | null) ?? null,
      errorMessage: (row.error_message as string | null) ?? null,
      errorMetadata:
        (row.error_metadata as Record<string, unknown> | null) ?? null,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    }));

    return {
      items: itemsDto,
      total,
      limit,
      offset,
    };
  }

  /**
   * Returns dead-lettered deliveries with optional pluginId filter.
   * All returned records are plain DTO objects with no TypeORM decorators.
   */
  async findDeadLetters(
    pluginId: string | undefined,
    criteria?: DeadLetterQueryCriteria,
  ): Promise<{
    items: DeadLetterResponseDto[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(Math.max(criteria?.limit ?? 50, 1), 200);
    const offset = Math.max(criteria?.offset ?? 0, 0);

    const qb = this.repository
      .createQueryBuilder('delivery')
      .select('delivery.id', 'id')
      .addSelect('delivery.plugin_id', 'plugin_id')
      .addSelect('delivery.plugin_version', 'plugin_version')
      .addSelect('delivery.contribution_id', 'contribution_id')
      .addSelect('delivery.topic', 'topic')
      .addSelect('delivery.event_name', 'event_name')
      // payload is intentionally excluded — raw payloads are redacted in observability responses
      .addSelect('delivery.correlation_id', 'correlation_id')
      .addSelect('delivery.delivery_mode', 'delivery_mode')
      .addSelect('delivery.status', 'status')
      .addSelect('delivery.attempt_count', 'attempt_count')
      .addSelect('delivery.max_attempts', 'max_attempts')
      .addSelect('delivery.retry_initial_delay_ms', 'retry_initial_delay_ms')
      .addSelect(
        'delivery.retry_backoff_multiplier',
        'retry_backoff_multiplier',
      )
      .addSelect('delivery.dead_letter_enabled', 'dead_letter_enabled')
      .addSelect('delivery.next_attempt_at', 'next_attempt_at')
      .addSelect('delivery.delivered_at', 'delivered_at')
      .addSelect('delivery.error_code', 'error_code')
      .addSelect('delivery.error_message', 'error_message')
      .addSelect('delivery.error_metadata', 'error_metadata')
      .addSelect('delivery.created_at', 'created_at')
      .addSelect('delivery.updated_at', 'updated_at')
      .where('delivery.status = :status', { status: 'dead_lettered' })
      .orderBy('delivery.created_at', 'DESC')
      .offset(offset)
      .limit(limit);

    if (pluginId) {
      qb.andWhere('delivery.plugin_id = :pluginId', { pluginId });
    }

    if (criteria?.topic) {
      qb.andWhere('delivery.topic = :topic', { topic: criteria.topic });
    }

    if (criteria?.contributionId) {
      qb.andWhere('delivery.contribution_id = :contributionId', {
        contributionId: criteria.contributionId,
      });
    }

    const [items, total] = await Promise.all([
      qb.getRawMany<Record<string, unknown>>(),
      qb.clone().offset(0).limit(0).getCount(),
    ]);

    const itemsDto: DeadLetterResponseDto[] = items.map((row) => ({
      id: row.id as string,
      pluginId: row.plugin_id as string,
      pluginVersion: row.plugin_version as string,
      contributionId: row.contribution_id as string,
      topic: row.topic as string,
      eventName: row.event_name as string,
      // payload is excluded — raw payloads are redacted in observability responses
      payload: null,
      correlationId: (row.correlation_id as string | null) ?? null,
      deliveryMode: row.delivery_mode as string,
      status: row.status as string,
      attemptCount: row.attempt_count as number,
      maxAttempts: row.max_attempts as number,
      retryInitialDelayMs: row.retry_initial_delay_ms as number,
      retryBackoffMultiplier: row.retry_backoff_multiplier as number,
      deadLetterEnabled: row.dead_letter_enabled as boolean,
      nextAttemptAt: (row.next_attempt_at as Date).toISOString(),
      deliveredAt: row.delivered_at
        ? (row.delivered_at as Date).toISOString()
        : null,
      errorCode: (row.error_code as string | null) ?? null,
      errorMessage: (row.error_message as string | null) ?? null,
      errorMetadata:
        (row.error_metadata as Record<string, unknown> | null) ?? null,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    }));

    return {
      items: itemsDto,
      total,
      limit,
      offset,
    };
  }

  /**
   * Returns aggregated status counts for deliveries, optionally filtered
   * by pluginId and/or topic. Results are plain DTOs, not TypeORM entities.
   */
  async aggregateCounts(
    criteria?: AggregateCountsQueryCriteria,
  ): Promise<AggregateCountsResponseDto> {
    const qb = this.repository
      .createQueryBuilder('delivery')
      .select('delivery.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('delivery.status');

    if (criteria?.pluginId) {
      qb.andWhere('delivery.plugin_id = :pluginId', {
        pluginId: criteria.pluginId,
      });
    }

    if (criteria?.topic) {
      qb.andWhere('delivery.topic = :topic', { topic: criteria.topic });
    }

    const rows = await qb.getRawMany<{ status: string; count: string }>();

    const counts = rows.map((row) => ({
      status: row.status,
      count: Number.parseInt(row.count, 10) || 0,
    }));

    const total = counts.reduce((sum, c) => sum + c.count, 0);

    return { counts, total };
  }
}
