import type {
  PluginEventDeliveryMode,
  PluginEventDeliveryStatus,
} from '../entities/plugin-event-delivery.types';

export type { PluginEventDeliveryStatus };

// ---------------------------------------------------------------------------
// Query criteria (plain input objects — never TypeORM entities)
// ---------------------------------------------------------------------------

/**
 * Criteria for the findRecentDeliveries query.
 * All fields are optional and used to filter the result set.
 */
export interface DeliveryQueryCriteria {
  /** Return only deliveries for this topic. */
  topic?: string;
  /** Return only deliveries with this status. */
  status?: PluginEventDeliveryStatus;
  /** Return only deliveries for this contribution. */
  contributionId?: string;
  /** Maximum number of records to return (1–200, default 50). */
  limit?: number;
  /** Number of records to skip for pagination (default 0). */
  offset?: number;
}

/**
 * Criteria for the findDeadLetters query.
 * All fields are optional and used to filter the result set.
 */
export interface DeadLetterQueryCriteria {
  /** Return only dead letters for this topic. */
  topic?: string;
  /** Return only dead letters for this contribution. */
  contributionId?: string;
  /** Maximum number of records to return (1–200, default 50). */
  limit?: number;
  /** Number of records to skip for pagination (default 0). */
  offset?: number;
}

/**
 * Criteria for the aggregateCounts query.
 */
export interface AggregateCountsQueryCriteria {
  /** Return only counts for deliveries from this plugin. */
  pluginId?: string;
  /** Return only counts for this topic. */
  topic?: string;
}

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface CreatePendingPluginEventDeliveryInput {
  pluginId: string;
  pluginVersion: string;
  contributionId: string;
  topic: string;
  eventName: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  deliveryMode: PluginEventDeliveryMode;
  maxAttempts: number;
  retryInitialDelayMs: number;
  retryBackoffMultiplier: number;
  deadLetterEnabled: boolean;
  nextAttemptAt: Date;
}

export interface MarkFailedPluginEventDeliveryInput {
  id: string;
  nextAttemptAt?: Date;
  errorCode: string;
  errorMessage: string;
  errorMetadata?: Record<string, unknown>;
  incrementAttemptCount: boolean;
}

export interface MarkDeadLetteredPluginEventDeliveryInput {
  id: string;
  errorCode: string;
  errorMessage: string;
  errorMetadata?: Record<string, unknown>;
}

export interface ListPluginEventDeliveryFilters {
  status?: PluginEventDeliveryStatus;
  pluginId?: string;
  topic?: string;
  contributionId?: string;
  limit?: number;
}

export interface CountPluginEventDeliveriesByStatusFilters {
  pluginId?: string;
  topic?: string;
  contributionId?: string;
}

export type PluginEventDeliveryStatusCounts = Record<
  PluginEventDeliveryStatus,
  number
>;

/**
 * Aggregated counts of deliveries, keyed by status.
 */
export interface StatusCounts {
  pending: number;
  delivering: number;
  delivered: number;
  failed: number;
  dead_lettered: number;
}
