/**
 * `PostmortemWriter` — milestone 2 of work item
 * 71cdcd7b-daff-489d-b681-44d239765c99.
 *
 * Owns the postmortem writeback surface that the
 * `WorkflowFailurePostmortemListener` (milestone 4 will wire it in)
 * used to host inline. Extracted so the listener's branchy logic
 * stays under the project's `max-lines` lint cap and so the
 * writeback pipeline can be unit-tested in isolation (without the
 * listener's full collaborator graph).
 *
 * What moved out of the listener:
 *   - `buildPayload` — pure helper that turns a
 *     `(WorkflowRunEvent, scopeId, FailureClassificationDecision)`
 *     triple into a `WorkflowPostmortemPayload`. Same shape the
 *     listener already produced; the existing
 *     `isWorkflowPostmortemPayload` boundary guard remains the
 *     only validation path.
 *   - `summarizeDecision` — builds the grep-friendly
 *     `evidence_summary` digest stored in `metadata_json` AND
 *     rendered into the segment content. Uses the same
 *     `workflowId=<id>; jobId=<id-or-unknown>; reason=<...>;
 *     errorCode=<code-or-unknown>; eligibility=<...>;
 *     allowedActions=<n>; evidenceRefs=<n>` layout so existing
 *     operators querying via the `query_memory` content search
 *     keep finding the same tokens.
 *   - `findExistingPostmortem` — dedup probe that gates the
 *     write. Stays in the writer (not in a separate "backfill"
 *     concern) because the dedup is a write-gate: skipping a
 *     duplicate IS the writeback outcome, not a sidecar.
 *   - `writeMemorySegment` — calls
 *     `MemoryManagerService.createMemorySegment` with the
 *     canonical postmortem metadata shape (`source =
 *     workflow_failure_postmortem`, `pinned: true`,
 *     `workflow_run_id`, `failure_class`, `repair_decision`,
 *     `confidence`, `occurred_at`, `evidence_summary`).
 *   - `recordSuccess` / `recordSkipped` / `recordFailed` —
 *     the three recording paths. All three emit on BOTH
 *     `AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded` AND
 *     `WORKFLOW_POSTMORTEM_RECORDED_EVENT` (mirroring the
 *     listener's existing dual-emit pattern, so downstream
 *     subscribers binding to either surface continue to fire
 *     after the extraction).
 *
 * Listener contract (mirrors the spec document — the listener is
 * the consumer; the writer is the executor):
 *   1. The listener resolves settings + scopeId + classification
 *      decision OUTSIDE the writer (settings is a separate
 *      `PostmortemSettingsResolver` service — milestone 1 —
 *      and classification stays in the listener because it has
 *      its own error-handling contract).
 *   2. The listener calls `writer.writePostmortem({payload,
 *      decision, event})` with the payload it built via
 *      `writer.buildPayload(event, scopeId, decision)` and the
 *      freshly-resolved `FailureClassificationDecision`.
 *   3. The writer validates the payload, runs the dedup probe,
 *      writes the memory segment, records the outcome via
 *      `recordSuccess` / `recordSkipped` / `recordFailed`, and
 *      returns a discriminated `WritePostmortemResult` so the
 *      listener can decide what to do next (e.g. invoke the
 *      `WorkflowPostmortemLearningAggregatorService` only on the
 *      `ok` branch).
 *   4. The three `record*` methods are PUBLIC so the listener
 *      can call them directly for the pre-writeback branches
 *      (kill switch off, scope resolution failed, classification
 *      threw) without going through `writePostmortem`. Each
 *      emits on BOTH event names and bumps both the prom
 *      counter and the in-process memory-metrics snapshot.
 *
 * The writer is NOT yet wired into
 * `WorkflowFailurePostmortemListener` — that lands in milestone 4.
 * For this milestone the service is created in isolation; the
 * listener still owns the same logic in duplicate so the
 * milestone-by-milestone refactor stays behaviour-preserving.
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IMemorySegment } from '@nexus/core';
import { readString } from '@nexus/core';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { MemoryMetricsService } from '../../memory/memory-metrics.service';
import { MemorySegmentPostmortemRepository } from '../../memory/database/repositories/memory-segment.postmortem.repository';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { MetricsService } from '../../observability/metrics.service';
import type { WorkflowRunEvent } from '../workflow-events.types';
import type { FailureClassificationDecision } from './failure-classification.types';
import { PostmortemSettingsResolver } from './postmortem-settings-resolver.service';
import type { ResolvedPostmortemSettings } from './postmortem-settings-resolver.types';
import {
  WORKFLOW_POSTMORTEM_MEMORY_TYPE,
  WORKFLOW_POSTMORTEM_RECORDED_EVENT,
  WORKFLOW_POSTMORTEM_SOURCE,
} from './workflow-failure-postmortem.constants';
import {
  isWorkflowPostmortemPayload,
  renderPostmortemText,
  type WorkflowPostmortemPayload,
  type WorkflowPostmortemRecordedEvent,
} from './workflow-failure-postmortem.types';
import type {
  WritePostmortemInput,
  WritePostmortemResult,
} from './postmortem-writer.types';

export type {
  WritePostmortemInput,
  WritePostmortemResult,
} from './postmortem-writer.types';

@Injectable()
export class PostmortemWriter {
  private readonly logger = new Logger(PostmortemWriter.name);

  constructor(
    private readonly memoryManager: MemoryManagerService,
    private readonly memorySegmentRepo: MemorySegmentPostmortemRepository,
    private readonly memoryMetrics: MemoryMetricsService,
    private readonly metrics: MetricsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settingsResolver: PostmortemSettingsResolver,
  ) {}

  /**
   * Resolve the live postmortem writeback settings (kill switch
   * + writeback delay). Delegates to the injected
   * `PostmortemSettingsResolver` so the listener can stay a
   * 3-dep orchestrator (per milestone 4 of work item
   * 71cdcd7b-daff-489d-b681-44d239765c99).
   *
   * Public on the writer — the listener calls
   * `this.writer.resolveSettings()` instead of holding a direct
   * reference to `PostmortemSettingsResolver`. The writer owns
   * the resolver and exposes it as a thin pass-through; the
   * resolver still owns the kill-switch + delay coercion logic
   * (coerceEnabled / coerceDelaySeconds).
   *
   * Intentionally NOT marked `async` so the method returns the
   * inner Promise directly — wrapping the return in an `async`
   * function would add an extra microtask hop and break the
   * listener's pre-extraction `await this.settingsResolver.resolveSettings()`
   * timing (the test suite's fake-timer drain relies on the
   * original hop count to reach the `await sleep(...)` line).
   */
  resolveSettings(): Promise<ResolvedPostmortemSettings> {
    return this.settingsResolver.resolveSettings();
  }

  /**
   * Build the postmortem payload from the resolved scopeId +
   * classification decision. Pure function — the listener calls
   * it with already-validated inputs and the writer's
   * `writePostmortem` performs the boundary check via
   * `isWorkflowPostmortemPayload`.
   *
   * Kept PUBLIC on the writer so the listener can build the
   * payload with the same helper that the test suite mocks
   * (the writer's spec verifies the shape end-to-end), without
   * duplicating the field layout in two places.
   */
  buildPayload(
    event: WorkflowRunEvent,
    scopeId: string,
    decision: FailureClassificationDecision,
  ): WorkflowPostmortemPayload {
    return {
      workflow_run_id: event.workflowRunId,
      scope_id: scopeId,
      failure_class: decision.class,
      confidence: decision.confidence,
      repair_decision: {
        eligibility: decision.eligibility,
        allowedRepairActionIds: decision.allowedRepairActionIds,
        reason: decision.reason,
      },
      evidence_summary: this.summarizeDecision(decision, event),
      occurred_at: new Date().toISOString(),
    };
  }

  /**
   * Build the 1–3 line `evidence_summary` digest stored in
   * `metadata_json.evidence_summary` AND rendered into the
   * segment content. The summary is intentionally grep-friendly
   * (no JSON, no nested objects) so the existing
   * `query_memory` content-keyword search can find individual
   * fields without parsing.
   *
   * Fields: `workflowId=<id>; jobId=<id-or-unknown>;
   * reason=<reason>; errorCode=<code-or-unknown>;
   * eligibility=<eligibility>; allowedActions=<n>;
   * evidenceRefs=<n>`.
   *
   * Kept PUBLIC so the spec can assert against the
   * `workflowId=` / `jobId=` / `errorCode=` tokens without
   * having to spin up the full writeback pipeline.
   */
  summarizeDecision(
    decision: FailureClassificationDecision,
    event: WorkflowRunEvent,
  ): string {
    const stateVariables = readRecord(event.stateVariables);
    const trigger = readRecord(stateVariables?.trigger);
    const jobs = readRecord(stateVariables?.jobs);
    const jobId =
      readNonEmptyString(event.failedJobId) ??
      readNonEmptyString(trigger?.failed_job_id) ??
      readNonEmptyString(stateVariables?.current_step_id) ??
      'unknown';
    const errorCode = readNonEmptyString(findFirstErrorCode(jobs)) ?? 'unknown';
    return [
      `workflowId=${event.workflowId}`,
      `jobId=${jobId}`,
      `reason=${decision.reason}`,
      `errorCode=${errorCode}`,
      `eligibility=${decision.eligibility}`,
      `allowedActions=${decision.allowedRepairActionIds.length.toString()}`,
      `evidenceRefs=${decision.evidenceReferences.length.toString()}`,
    ].join('; ');
  }

  /**
   * Drive the postmortem writeback pipeline:
   *   1. Validate the payload via `isWorkflowPostmortemPayload`
   *      (catches malformed shapes from operator-driven backfills
   *      and redrive-from-event-ledger paths). On invalid → emit
   *      `recordFailed` with reason `'payload-validation-failed'`
   *      and return `{kind: 'failed', reason}`.
   *   2. Dedup probe — return existing postmortem for the same
   *      `(workflow_run_id, scope_id)` pair, if any. On hit →
   *      emit `recordSkipped` with reason
   *      `'duplicate-workflow-run-id'` and return
   *      `{kind: 'skipped', reason}`.
   *   3. Otherwise call `writeMemorySegment`. On backend
   *      rejection → emit `recordFailed` with the underlying
   *      error message and return `{kind: 'error', reason}`.
   *   4. On success → emit `recordSuccess` with the new
   *      `memory_segment_id` and return
   *      `{kind: 'ok', segmentId}`.
   *
   * Each record* call emits on BOTH
   * `AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded` AND
   * `WORKFLOW_POSTMORTEM_RECORDED_EVENT` so downstream surfaces
   * binding to either name continue to fire after this
   * extraction. The listener's success path inspects the
   * returned kind to decide whether to invoke the
   * `WorkflowPostmortemLearningAggregatorService` (only on
   * `kind: 'ok'`).
   */
  async writePostmortem(
    input: WritePostmortemInput,
  ): Promise<WritePostmortemResult> {
    const { payload, decision, event } = input;

    if (!isWorkflowPostmortemPayload(payload)) {
      // Inside the `!isWorkflowPostmortemPayload` branch the
      // type guard narrows `payload` to `never` (the input
      // field is already typed as `WorkflowPostmortemPayload`,
      // so the negation collapses to `never`). Capture the
      // pre-narrow `scopeId` / `workflowRunId` from `input`
      // directly so the recorded event still carries
      // identifiers when the payload was built from a malformed
      // shape.
      const fallbackScopeId = input.payload.scope_id;
      const fallbackRunId = input.payload.workflow_run_id;
      this.recordFailed(
        event,
        fallbackScopeId,
        decision,
        'payload-validation-failed',
      );
      this.logger.warn(
        `PostmortemWriter rejected an invalid payload for run ${fallbackRunId ?? 'unknown'}; skipping writeback.`,
      );
      return { kind: 'failed', reason: 'payload-validation-failed' };
    }

    const dedupHit = await this.findExistingPostmortem(
      payload.workflow_run_id,
      payload.scope_id,
    );
    if (dedupHit !== null) {
      this.recordSkipped('duplicate-workflow-run-id');
      this.logger.debug(
        `PostmortemWriter detected existing postmortem ${dedupHit.id} for run ${payload.workflow_run_id}; skipping writeback.`,
      );
      return { kind: 'skipped', reason: 'duplicate-workflow-run-id' };
    }

    const writeResult = await this.writeMemorySegment(payload);
    if (writeResult.kind === 'error') {
      this.recordFailed(event, payload.scope_id, decision, writeResult.reason);
      return { kind: 'error', reason: writeResult.reason };
    }

    this.recordSuccess(
      event,
      payload.scope_id,
      decision,
      writeResult.segment.id,
    );
    this.logger.log(
      `PostmortemWriter wrote postmortem ${writeResult.segment.id} for run ${payload.workflow_run_id} (failure_class=${decision.class}, eligibility=${decision.eligibility}).`,
    );
    return { kind: 'ok', segmentId: writeResult.segment.id };
  }

  /**
   * Record a successful writeback. Synchronous — the prom counter
   * increment, the in-process snapshot bump, and the dual event
   * emit are all in-process and complete on the same tick.
   *
   * Emits on BOTH `AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded`
   * AND `WORKFLOW_POSTMORTEM_RECORDED_EVENT` (the two surfaces
   * resolve to the same constant string today, but emitting on
   * both keeps the contract uniform against future divergence —
   * e.g. a renamed autonomy mirror).
   */
  recordSuccess(
    event: WorkflowRunEvent,
    scopeId: string,
    decision: FailureClassificationDecision,
    memorySegmentId: string,
  ): void {
    const recordedAt = new Date();
    const occurredAt = recordedAt.toISOString();
    const payload: WorkflowPostmortemRecordedEvent = {
      workflow_run_id: event.workflowRunId,
      scope_id: scopeId,
      failure_class: decision.class,
      confidence: decision.confidence,
      outcome: 'success',
      memory_segment_id: memorySegmentId,
      occurred_at: occurredAt,
    };
    this.metrics.recordWorkflowPostmortemRecorded('success');
    this.memoryMetrics.recordPostmortemRecorded({
      outcome: 'success',
      occurred_at: occurredAt,
      memory_segment_id: memorySegmentId,
    });
    this.emitRecorded(payload);
  }

  /**
   * Record a skipped writeback. The recorded event is
   * best-effort — when no decision / scope is available the
   * writer uses `'unknown'` for `workflow_run_id` / `scope_id`
   * and `'ambiguous_failure'` for `failure_class` so the schema
   * stays well-formed and the contract remains uniform with the
   * listener's pre-extraction behaviour.
   *
   * Emits on BOTH event names (same dual-emit rationale as
   * `recordSuccess`).
   */
  recordSkipped(reason: string): void {
    const recordedAt = new Date();
    const occurredAt = recordedAt.toISOString();
    const payload: WorkflowPostmortemRecordedEvent = {
      workflow_run_id: 'unknown',
      scope_id: 'unknown',
      failure_class: 'ambiguous_failure',
      confidence: 0,
      outcome: 'skipped',
      reason,
      occurred_at: occurredAt,
    };
    this.metrics.recordWorkflowPostmortemRecorded('skipped');
    this.memoryMetrics.recordPostmortemRecorded({
      outcome: 'skipped',
      occurred_at: occurredAt,
      reason,
    });
    this.emitRecorded(payload);
  }

  /**
   * Record a failed writeback. Emits on BOTH event names (same
   * dual-emit rationale as `recordSuccess`). The recorded event
   * mirrors the prom counter and the in-process snapshot.
   */
  recordFailed(
    event: WorkflowRunEvent,
    scopeId: string,
    decision: FailureClassificationDecision,
    reason: string,
  ): void {
    const recordedAt = new Date();
    const occurredAt = recordedAt.toISOString();
    const payload: WorkflowPostmortemRecordedEvent = {
      workflow_run_id: event.workflowRunId,
      scope_id: scopeId,
      failure_class: decision.class,
      confidence: decision.confidence,
      outcome: 'failed',
      reason,
      occurred_at: occurredAt,
    };
    this.metrics.recordWorkflowPostmortemRecorded('failed');
    this.memoryMetrics.recordPostmortemRecorded({
      outcome: 'failed',
      occurred_at: occurredAt,
      reason,
    });
    this.emitRecorded(payload);
  }

  /**
   * Dual-emit helper. Centralises the
   * `AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded` +
   * `WORKFLOW_POSTMORTEM_RECORDED_EVENT` emission so the three
   * `record*` methods stay symmetric (no chance of forgetting
   * one surface in a future refactor).
   *
   * The two event-name constants currently resolve to the same
   * string literal — emitting on both keeps the contract uniform
   * for downstream subscribers binding to either surface.
   */
  private emitRecorded(payload: WorkflowPostmortemRecordedEvent): void {
    this.eventEmitter.emit(
      AUTONOMY_EVENT_NAMES.workflowPostmortemRecorded,
      payload,
    );
    this.eventEmitter.emit(WORKFLOW_POSTMORTEM_RECORDED_EVENT, payload);
  }

  /**
   * Dedup probe — return the first existing postmortem for the
   * same `workflow_run_id` in the same `project` scope, or
   * `null` if no row exists. The lookup is intentionally narrow
   * (one-row by metadata key) so it stays cheap on the hot
   * path.
   *
   * Stays in the writer (not extracted into a separate
   * "backfill" service) because the dedup IS the write gate —
   * skipping a duplicate is the writeback outcome, not a
   * sidecar. Moving it would force the listener to coordinate
   * two services on the hot path.
   */
  private async findExistingPostmortem(
    workflowRunId: string,
    scopeId: string,
  ): Promise<{ id: string } | null> {
    const existing = await this.memorySegmentRepo.findByMetadataKey(
      'workflow_run_id',
      workflowRunId,
      { entityType: 'project', entityId: scopeId },
    );
    return existing === null ? null : { id: existing.id };
  }

  /**
   * Write the postmortem memory segment. Returns a discriminated
   * result so the handler can route the failure to
   * `recordFailed` without a try/catch ladder. The
   * `pinned: true` flag in the metadata is what guarantees the
   * eviction reaper will never silently delete a postmortem —
   * the decay reaper is already exempt via
   * `MEMORY_DECAY_EXEMPT_SOURCES`, but eviction is a separate
   * concern.
   *
   * Errors propagate via the discriminated result instead of
   * being thrown so `writePostmortem` can convert them into a
   * `{kind: 'error', reason}` return value for the listener.
   * The listener can then choose to surface the error to the
   * learning aggregator's catch-all or simply log it; the
   * listener's contract requires that this surface never throws
   * out to the event bus.
   */
  private async writeMemorySegment(
    payload: WorkflowPostmortemPayload,
  ): Promise<WriteMemorySegmentResult> {
    try {
      const segment: IMemorySegment =
        await this.memoryManager.createMemorySegment(
          'project',
          payload.scope_id,
          renderPostmortemText(payload),
          WORKFLOW_POSTMORTEM_MEMORY_TYPE,
          {
            source: WORKFLOW_POSTMORTEM_SOURCE,
            pinned: true,
            workflow_run_id: payload.workflow_run_id,
            failure_class: payload.failure_class,
            repair_decision: payload.repair_decision,
            confidence: payload.confidence,
            occurred_at: payload.occurred_at,
            evidence_summary: payload.evidence_summary,
          },
        );
      return { kind: 'ok', segment };
    } catch (error: unknown) {
      const message = errorMessage(error);
      this.logger.warn(
        `PostmortemWriter failed to write memory segment for run ${payload.workflow_run_id}: ${message}`,
      );
      return { kind: 'error', reason: message };
    }
  }
}

/**
 * Defensive record read. Returns `null` for any non-object input
 * (primitives, arrays, `null`, `undefined`) so the caller can
 * use `=== null` as the "missing" sentinel without distinguishing
 * from "was actually the `null` literal`.
 */
function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Read a non-empty string. Returns `null` for non-strings,
 * empty strings, and whitespace-only strings — the caller
 * falls back to the `'unknown'` sentinel rather than
 * swallowing a stray `''` into the evidence summary.
 */
function readNonEmptyString(value: unknown): string | null {
  const raw = readString(value);
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extract a human-readable error message from an `unknown`
 * catch-block value. Wraps the standard
 * `error instanceof Error ? error.message : String(error)`
 * pattern so the call sites stay narrow (no `any`, no
 * `error-typed` reach-throughs).
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Internal discriminated result for `writeMemorySegment`. Kept
 * module-private — `writePostmortem` is the only public caller
 * and converts the `'error'` branch into
 * `{kind: 'error', reason: ...}` on the `WritePostmortemResult`
 * union.
 */
type WriteMemorySegmentResult =
  | { kind: 'ok'; segment: IMemorySegment }
  | { kind: 'error'; reason: string };

/**
 * Best-effort extraction of an error code from a workflow run's
 * job output. Walks one level into `stateVariables.jobs[*]` and
 * surfaces the first `errorCode` field found. Returns `null`
 * when no jobs block exists (e.g. the publisher omitted job
 * output) so the caller can fall back to the `'unknown'`
 * sentinel.
 */
function findFirstErrorCode(
  jobs: Record<string, unknown> | null,
): string | null {
  if (jobs === null) {
    return null;
  }
  for (const job of Object.values(jobs)) {
    const record = readRecord(job);
    if (record === null) {
      continue;
    }
    const output = readRecord(record.output);
    const errorCode = readNonEmptyString(output?.errorCode);
    if (errorCode !== null) {
      return errorCode;
    }
  }
  return null;
}
