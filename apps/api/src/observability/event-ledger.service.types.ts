import type { EventLedger } from '../runtime/database/entities/event-ledger.entity';
import type { ExecutionContext } from '@nexus/core';

export interface EmitEventLedgerParams {
  domain: string;
  eventName: string;
  outcome: EventLedger['outcome'];
  severity?: EventLedger['severity'];
  source?: string;
  actorType?: EventLedger['actor_type'];
  actorId?: string;
  context?: ExecutionContext;
  workflowId?: string;
  workflowRunId?: string;
  jobId?: string;
  stepId?: string;
  toolId?: string;
  toolName?: string;
  subagentExecutionId?: string;
  sessionTreeId?: string;
  requestId?: string;
  correlationId?: string;
  parentEventId?: string;
  payload?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface EventLedgerQuery {
  domain?: string;
  eventName?: string;
  outcome?: EventLedger['outcome'];
  severity?: EventLedger['severity'];
  source?: string;
  actorType?: EventLedger['actor_type'];
  actorId?: string;
  context?: ExecutionContext;
  workflowId?: string;
  workflowRunId?: string;
  jobId?: string;
  stepId?: string;
  toolName?: string;
  requestId?: string;
  correlationId?: string;
  occurredAfter?: Date;
  occurredBefore?: Date;
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

/**
 * Narrowed payload shape for `memory.setting.changed.v1` events.
 *
 * Two producers emit this event today:
 *   1. `SystemSettingsService.setAndEmit` for operator-driven writes
 *      to allowlisted memory:* keys. Emits `key`, `previousValue`,
 *      `newValue`, and `source`.
 *   2. `DistillationThresholdService.emitSettingChanged` for
 *      runtime drift between consecutive resolutions. Emits the same
 *      four fields plus `previousSource` / `newSource`.
 *
 * `previousSource` and `newSource` are optional so a single interface
 * can describe both producers without forcing the operator-driven
 * event to invent dummy source-tier labels.
 */
export interface MemorySettingChangedPayload {
  key: string;
  previousValue: number | string | null;
  previousSource?: string;
  newValue: number | string | null;
  newSource?: string;
  source: string;
}

/**
 * Narrowed view of an `EventLedger` row that carries a
 * `MemorySettingChangedPayload`. Returned by
 * `EventLedgerService.findLatestMemorySettingChangedByPayloadSource`
 * so callers (e.g. `DistillationThresholdService`) get a stable
 * shape instead of a raw entity whose `payload` is
 * `Record<string, unknown>`.
 */
export interface MemorySettingChangedLedgerEntry {
  id: string;
  occurredAt: Date;
  payload: MemorySettingChangedPayload;
}
