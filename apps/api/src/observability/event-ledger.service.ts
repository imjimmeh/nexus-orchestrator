import { Injectable, Logger } from '@nestjs/common';
import { EventLedgerRepository } from '../runtime/database/repositories/event-ledger.repository';
import { RequestContextService } from '../common/request-context.service';
import { EventLedger } from '../runtime/database/entities/event-ledger.entity';

export type {
  EmitEventLedgerParams,
  EventLedgerQuery,
  MemorySettingChangedPayload,
  MemorySettingChangedLedgerEntry,
} from './event-ledger.service.types';
import type {
  EmitEventLedgerParams,
  EventLedgerQuery,
  MemorySettingChangedLedgerEntry,
  MemorySettingChangedPayload,
} from './event-ledger.service.types';

const REDACTED_PLACEHOLDER = '[REDACTED]';
const MAX_ERROR_MESSAGE_LENGTH = 2000;

@Injectable()
export class EventLedgerService {
  private readonly logger = new Logger(EventLedgerService.name);

  constructor(
    private readonly repository: EventLedgerRepository,
    private readonly requestContext: RequestContextService,
  ) {}

  async emit(params: EmitEventLedgerParams): Promise<EventLedger> {
    return this.repository.append(this.buildLedgerEntry(params));
  }

  async emitBestEffort(params: EmitEventLedgerParams): Promise<void> {
    try {
      await this.emit(params);
    } catch (error) {
      this.logger.warn(
        `Failed to append event [${params.domain}.${params.eventName}]: ${(error as Error).message}`,
      );
    }
  }

  async getById(id: string): Promise<EventLedger | null> {
    return this.repository.findById(id);
  }

  /**
   * Look up the most recent `memory.setting.changed.v1` event whose
   * `payload.source` matches the supplied identifier, returning a
   * narrowed view of the row.
   *
   * Used by `DistillationThresholdService.primeBaselineFromLedger()`
   * to rehydrate its process-local `(value, source)` cache from the
   * EventLedger on startup so change detection does not diverge
   * across replicas or after restarts.
   *
   * The narrowing is safe at runtime because:
   *   - The repository query constrains `event_name` to
   *     `memory.setting.changed.v1`, and
   *   - Every current producer of that event name supplies a payload
   *     conforming to `MemorySettingChangedPayload` (see
   *     `SystemSettingsService.setAndEmit` and
   *     `DistillationThresholdService.emitSettingChanged`).
   */
  async findLatestMemorySettingChangedByPayloadSource(params: {
    source: string;
  }): Promise<MemorySettingChangedLedgerEntry | null> {
    const entry =
      await this.repository.findLatestMemorySettingChangedByPayloadSource(
        params,
      );
    if (!entry) {
      return null;
    }
    return {
      id: entry.id,
      occurredAt: entry.occurred_at,
      payload: entry.payload as unknown as MemorySettingChangedPayload,
    };
  }

  async getByCorrelationId(
    correlationId: string,
    limit = 100,
    offset = 0,
  ): Promise<{ events: EventLedger[]; total: number }> {
    const [events, total] = await this.repository.findByCorrelationId(
      correlationId,
      limit,
      offset,
    );

    return { events, total };
  }

  async query(
    query: EventLedgerQuery,
  ): Promise<{ events: EventLedger[]; total: number }> {
    const [events, total] = await this.repository.query({
      domain: query.domain,
      event_name: query.eventName,
      outcome: query.outcome,
      severity: query.severity,
      source: query.source,
      actor_type: query.actorType,
      actor_id: query.actorId,
      scopeId: query.context?.scopeId ?? undefined,
      contextId: query.context?.contextId ?? undefined,
      workflow_id: query.workflowId,
      workflow_run_id: query.workflowRunId,
      job_id: query.jobId,
      step_id: query.stepId,
      tool_name: query.toolName,
      request_id: query.requestId,
      correlation_id: query.correlationId,
      occurred_after: query.occurredAfter,
      occurred_before: query.occurredBefore,
      limit: query.limit,
      offset: query.offset,
      search: query.search,
      sort_by: query.sortBy,
      sort_dir: query.sortDir,
    });

    return { events, total };
  }

  private inferSeverity(
    outcome: EventLedger['outcome'],
  ): EventLedger['severity'] {
    if (outcome === 'failure') {
      return 'error';
    }

    if (outcome === 'denied') {
      return 'warn';
    }

    return 'info';
  }

  private sanitizeErrorMessage(errorMessage?: string): string | undefined {
    if (!errorMessage) {
      return undefined;
    }

    const trimmed = errorMessage.trim();
    if (!trimmed) {
      return undefined;
    }

    const redacted = this.redactString(trimmed);
    return redacted.length > MAX_ERROR_MESSAGE_LENGTH
      ? `${redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...[TRUNCATED]`
      : redacted;
  }

  private buildLedgerEntry(
    params: EmitEventLedgerParams,
  ): Partial<EventLedger> {
    const contextValues = this.resolveContextValues(params);

    return {
      domain: params.domain,
      event_name: params.eventName,
      outcome: params.outcome,
      severity: params.severity ?? this.inferSeverity(params.outcome),
      source: params.source ?? 'api',
      actor_type: params.actorType,
      actor_id: contextValues.actorId,
      scopeId: params.context?.scopeId ?? undefined,
      contextId: params.context?.contextId ?? undefined,
      workflow_id: params.workflowId,
      workflow_run_id: contextValues.workflowRunId,
      job_id: params.jobId,
      step_id: contextValues.stepId,
      tool_id: params.toolId,
      tool_name: params.toolName,
      subagent_execution_id: params.subagentExecutionId,
      session_tree_id: params.sessionTreeId,
      request_id: contextValues.requestId,
      correlation_id: contextValues.correlationId,
      parent_event_id: params.parentEventId,
      payload: this.redactRecord(params.payload),
      error_code: params.errorCode,
      error_message: this.sanitizeErrorMessage(params.errorMessage),
    };
  }

  private resolveContextValues(params: EmitEventLedgerParams): {
    requestId: string | undefined;
    correlationId: string | undefined;
    actorId: string | undefined;
    workflowRunId: string | undefined;
    stepId: string | undefined;
  } {
    const context = this.requestContext.getContext();
    const requestId = params.requestId ?? context?.requestId;

    return {
      requestId,
      correlationId: params.correlationId ?? requestId,
      actorId: params.actorId ?? context?.userId,
      workflowRunId: params.workflowRunId ?? context?.workflowRunId,
      stepId: params.stepId ?? context?.stepId,
    };
  }

  private redactRecord(
    payload?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!payload) {
      return undefined;
    }

    return this.redactValue(payload) as Record<string, unknown>;
  }

  private redactValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.redactValue(entry));
    }

    if (typeof value === 'string') {
      return this.redactString(value);
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const source = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};

    for (const [key, entryValue] of Object.entries(source)) {
      if (this.isSensitiveKey(key)) {
        redacted[key] = REDACTED_PLACEHOLDER;
        continue;
      }

      redacted[key] = this.redactValue(entryValue);
    }

    return redacted;
  }

  private redactString(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }

    // Basic protection against accidental token/key leakage in free-form text.
    if (
      /(api[_-]?key|access[_-]?token|secret|password|authorization)/i.test(
        trimmed,
      )
    ) {
      return REDACTED_PLACEHOLDER;
    }

    return value;
  }

  private isSensitiveKey(key: string): boolean {
    return /(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)/i.test(
      key,
    );
  }
}
