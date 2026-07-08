import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { pluginEventDeliveryStatuses } from '../database/entities/plugin-event-delivery.types';

// ---------------------------------------------------------------------------
// Query DTOs
// ---------------------------------------------------------------------------

export class RecentDeliveryQueryDto {
  @IsOptional()
  @IsString()
  pluginId?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsIn(pluginEventDeliveryStatuses)
  status?: string;

  @IsOptional()
  @IsString()
  contributionId?: string;

  @IsOptional()
  @Transform((value: unknown) => parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @Transform((value: unknown) => parseInt(String(value), 10))
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class DeadLetterQueryDto {
  @IsOptional()
  @IsString()
  pluginId?: string;

  @IsOptional()
  @Transform((value: unknown) => parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @Transform((value: unknown) => parseInt(String(value), 10))
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class AggregateCountsQueryDto {
  @IsOptional()
  @IsString()
  pluginId?: string;

  @IsOptional()
  @IsString()
  topic?: string;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export class RecentDeliveryResponseDto {
  id!: string;
  pluginId!: string;
  pluginVersion!: string;
  contributionId!: string;
  topic!: string;
  eventName!: string;
  /** Raw payload is always null in observability responses (redacted for security). */
  payload!: null;
  correlationId!: string | null;
  deliveryMode!: string;
  status!: string;
  attemptCount!: number;
  maxAttempts!: number;
  retryInitialDelayMs!: number;
  retryBackoffMultiplier!: number;
  deadLetterEnabled!: boolean;
  nextAttemptAt!: string;
  deliveredAt!: string | null;
  errorCode!: string | null;
  errorMessage!: string | null;
  errorMetadata!: Record<string, unknown> | null;
  createdAt!: string;
  updatedAt!: string;
}

export class RecentDeliveriesResponseDto {
  items!: RecentDeliveryResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class DeadLetterResponseDto {
  id!: string;
  pluginId!: string;
  pluginVersion!: string;
  contributionId!: string;
  topic!: string;
  eventName!: string;
  /** Raw payload is always null in observability responses (redacted for security). */
  payload!: null;
  correlationId!: string | null;
  deliveryMode!: string;
  status!: string;
  attemptCount!: number;
  maxAttempts!: number;
  retryInitialDelayMs!: number;
  retryBackoffMultiplier!: number;
  deadLetterEnabled!: boolean;
  nextAttemptAt!: string;
  deliveredAt!: string | null;
  errorCode!: string | null;
  errorMessage!: string | null;
  errorMetadata!: Record<string, unknown> | null;
  createdAt!: string;
  updatedAt!: string;
}

export class DeadLettersResponseDto {
  items!: DeadLetterResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class StatusCountDto {
  status!: string;
  count!: number;
}

export class AggregateCountsResponseDto {
  counts!: StatusCountDto[];
  total!: number;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Converts a raw plugin event delivery record to a RecentDeliveryResponseDto.
 * This ensures that Date fields are serialized as ISO strings and that we
 * return a plain object rather than the TypeORM entity. The payload is
 * always redacted (null) for security reasons.
 */
export function toRecentDeliveryDto(
  record: Record<string, unknown>,
): RecentDeliveryResponseDto {
  return {
    id: record.id as string,
    pluginId: record.plugin_id as string,
    pluginVersion: record.plugin_version as string,
    contributionId: record.contribution_id as string,
    topic: record.topic as string,
    eventName: record.event_name as string,
    payload: null, // Always redacted in observability responses
    correlationId: (record.correlation_id as string | null) ?? null,
    deliveryMode: record.delivery_mode as string,
    status: record.status as string,
    attemptCount: record.attempt_count as number,
    maxAttempts: record.max_attempts as number,
    retryInitialDelayMs: record.retry_initial_delay_ms as number,
    retryBackoffMultiplier: record.retry_backoff_multiplier as number,
    deadLetterEnabled: record.dead_letter_enabled as boolean,
    nextAttemptAt: (record.next_attempt_at as Date).toISOString(),
    deliveredAt: record.delivered_at
      ? (record.delivered_at as Date).toISOString()
      : null,
    errorCode: (record.error_code as string | null) ?? null,
    errorMessage: (record.error_message as string | null) ?? null,
    errorMetadata:
      (record.error_metadata as Record<string, unknown> | null) ?? null,
    createdAt: (record.created_at as Date).toISOString(),
    updatedAt: (record.updated_at as Date).toISOString(),
  };
}

/**
 * Converts a raw plugin event delivery record to a DeadLetterResponseDto.
 * Same as toRecentDeliveryDto but typed for dead-letter context. The payload
 * is always redacted (null) for security reasons.
 */
export function toDeadLetterDto(
  record: Record<string, unknown>,
): DeadLetterResponseDto {
  return {
    id: record.id as string,
    pluginId: record.plugin_id as string,
    pluginVersion: record.plugin_version as string,
    contributionId: record.contribution_id as string,
    topic: record.topic as string,
    eventName: record.event_name as string,
    payload: null, // Always redacted in observability responses
    correlationId: (record.correlation_id as string | null) ?? null,
    deliveryMode: record.delivery_mode as string,
    status: record.status as string,
    attemptCount: record.attempt_count as number,
    maxAttempts: record.max_attempts as number,
    retryInitialDelayMs: record.retry_initial_delay_ms as number,
    retryBackoffMultiplier: record.retry_backoff_multiplier as number,
    deadLetterEnabled: record.dead_letter_enabled as boolean,
    nextAttemptAt: (record.next_attempt_at as Date).toISOString(),
    deliveredAt: record.delivered_at
      ? (record.delivered_at as Date).toISOString()
      : null,
    errorCode: (record.error_code as string | null) ?? null,
    errorMessage: (record.error_message as string | null) ?? null,
    errorMetadata:
      (record.error_metadata as Record<string, unknown> | null) ?? null,
    createdAt: (record.created_at as Date).toISOString(),
    updatedAt: (record.updated_at as Date).toISOString(),
  };
}
