/**
 * `WorkflowFailurePostmortemListener` — milestone 4 of work item
 * 71cdcd7b-daff-489d-b681-44d239765c99.
 *
 * Subscribes to `WORKFLOW_RUN_FAILED_EVENT` and orchestrates the
 * postmortem writeback pipeline by delegating to three
 * purpose-built collaborators:
 *   - `WorkflowFailureClassificationService` — failure class +
 *     repair eligibility decision.
 *   - `PostmortemWriter` — kill switch + delay resolution
 *     (via the internally-injected `PostmortemSettingsResolver`),
 *     payload validation, dedup probe, `memory_segments` write,
 *     recorded-event emission (milestones 1 + 2).
 *   - `PostmortemMemoryBackfiller` — aggregator call for the
 *     EPIC-212 Phase-2 recurrence gate signal (m3).
 *
 * The listener is reduced to a thin orchestrator with exactly
 * three direct dependencies. The handler is named
 * `handleWorkflowRunFailed` to mirror the neighbouring
 * `WorkflowFailureClassificationListener`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { readString, WorkflowStatus } from '@nexus/core';
import { sleep } from '../../common/utils/async.utils';
import { WORKFLOW_RUN_FAILED_EVENT } from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';
import type { FailureClassificationDecision } from './failure-classification.types';
import { WorkflowFailureClassificationService } from './workflow-failure-classification.service';
import { WORKFLOW_POSTMORTEM_SETTING_KEYS } from './workflow-failure-postmortem.constants';
import { PostmortemMemoryBackfiller } from './postmortem-memory-backfiller.service';
import { PostmortemWriter } from './postmortem-writer.service';

const MS_PER_SECOND = 1000;

@Injectable()
export class WorkflowFailurePostmortemListener {
  private readonly logger = new Logger(WorkflowFailurePostmortemListener.name);

  constructor(
    private readonly classification: WorkflowFailureClassificationService,
    private readonly writer: PostmortemWriter,
    private readonly backfiller: PostmortemMemoryBackfiller,
  ) {}

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async handleWorkflowRunFailed(event: WorkflowRunEvent): Promise<void> {
    try {
      // Belt-and-suspenders: the listener only subscribes to
      // FAILED. Skip early rather than write a postmortem for a
      // non-failed run.
      if (event.status !== WorkflowStatus.FAILED) {
        return;
      }
      await this.processFailedRun(event);
    } catch (error) {
      // Final safety net — the listener must NEVER throw out.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `WorkflowFailurePostmortemListener swallowed unhandled error for run ${event.workflowRunId ?? 'unknown'}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      try {
        this.writer.recordFailed(
          event,
          this.resolveScopeId(event) ?? 'unknown',
          ambiguousFailureDecision(`unhandled-listener-error: ${message}`),
          `unhandled: ${message}`,
        );
      } catch (recordingError) {
        // Recording itself must NEVER throw — log and move on.
        const recordingMessage =
          recordingError instanceof Error
            ? recordingError.message
            : String(recordingError);
        this.logger.warn(
          `WorkflowFailurePostmortemListener failed to record unhandled-error outcome: ${recordingMessage}`,
        );
      }
    }
  }

  /** Drive the postmortem writeback orchestration end-to-end.
   *  Split out from `handleWorkflowRunFailed` to keep the
   *  listener's complexity budget under the project lint cap. */
  private async processFailedRun(event: WorkflowRunEvent): Promise<void> {
    const resolved = await this.writer.resolveSettings();
    if (!resolved.enabled) {
      this.writer.recordSkipped('disabled');
      this.logger.debug(
        `WorkflowFailurePostmortemListener kill switch (${WORKFLOW_POSTMORTEM_SETTING_KEYS.enabled}) is off; skipping postmortem writeback for run ${event.workflowRunId}.`,
      );
      return;
    }

    if (resolved.delaySeconds > 0) {
      await sleep(resolved.delaySeconds * MS_PER_SECOND);
    }

    const scopeId = this.resolveScopeId(event);
    if (scopeId === null) {
      this.writer.recordSkipped('scope-resolution-failed');
      this.logger.warn(
        `WorkflowFailurePostmortemListener could not resolve scope_id for run ${event.workflowRunId}; skipping postmortem writeback.`,
      );
      return;
    }

    const classificationResult = await this.classify(event);
    if (classificationResult.kind === 'error') {
      this.writer.recordFailed(
        event,
        scopeId,
        classificationResult.fallbackDecision,
        classificationResult.reason,
      );
      return;
    }

    await this.commitPostmortem(event, scopeId, classificationResult.decision);
  }

  /** Build the postmortem payload, delegate the writeback
   *  pipeline to the writer, and — on a successful write — kick
   *  off the recurrence-count backfill so the EPIC-212 Phase-2
   *  gate signal fires. The backfill call only fires on
   *  `kind: 'ok'` so a dedup hit or a failed write does NOT
   *  spuriously increment the recurrence counter. */
  private async commitPostmortem(
    event: WorkflowRunEvent,
    scopeId: string,
    decision: FailureClassificationDecision,
  ): Promise<void> {
    const payload = this.writer.buildPayload(event, scopeId, decision);
    const result = await this.writer.writePostmortem({
      payload,
      decision,
      event,
    });
    if (result.kind !== 'ok') {
      return;
    }

    // The backfiller wraps the aggregator with its own catch-all
    // so a transient settings / DB blip cannot break the
    // success-path recording. The `await` keeps the handler
    // sequential (event-bus ordering invariant).
    await this.backfiller.recordRecurrence({
      scopeId,
      failureClass: decision.class,
      triggeredByWorkflowRunId: event.workflowRunId,
      triggeredAt: new Date(),
    });
  }

  /** Classify the failed run. Returns a discriminated result so
   *  the handler can switch on `kind` without a try/catch ladder. */
  private async classify(event: WorkflowRunEvent): Promise<
    | { kind: 'ok'; decision: FailureClassificationDecision }
    | {
        kind: 'error';
        fallbackDecision: FailureClassificationDecision;
        reason: string;
      }
  > {
    try {
      const decision = await this.classification.classifyRunFailure(
        event.workflowRunId,
      );
      return { kind: 'ok', decision };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `WorkflowFailurePostmortemListener failed to classify run ${event.workflowRunId}: ${message}`,
      );
      return {
        kind: 'error',
        reason: `classification-threw: ${message}`,
        fallbackDecision: ambiguousFailureDecision(
          `classification-error: ${message}`,
        ),
      };
    }
  }

  /** Defensive `scope_id` extraction. Reads
   *  `state_variables.trigger.scopeId` (camelCase) first, then
   *  the snake_case `scope_id` fallback, then a last-ditch
   *  `state_variables.scopeId`. Returns `null` when the value is
   *  missing or non-string so the caller emits a
   *  `scope-resolution-failed` recorded event and returns. */
  private resolveScopeId(event: WorkflowRunEvent): string | null {
    const stateVariables = readRecord(event.stateVariables);
    if (stateVariables === null) {
      return null;
    }
    const trigger = readRecord(stateVariables.trigger);
    const fromTrigger = readNonEmptyString(trigger?.scopeId);
    if (fromTrigger !== null) {
      return fromTrigger;
    }
    const fromTriggerSnake = readNonEmptyString(trigger?.scope_id);
    if (fromTriggerSnake !== null) {
      return fromTriggerSnake;
    }
    return readNonEmptyString(stateVariables.scopeId);
  }
}

/** Sentinel `FailureClassificationDecision` used when the real
 *  decision could not be computed (classification threw, the
 *  safety net caught an unhandled error). Centralised so the
 *  two catch-arms stay in sync and the listener stays slim. */
function ambiguousFailureDecision(
  reason: string,
): FailureClassificationDecision {
  return {
    class: 'ambiguous_failure',
    confidence: 0,
    reason,
    evidenceReferences: [],
    eligibility: 'human_required',
    allowedRepairActionIds: [],
  };
}

/** Defensive record read. Returns `null` for any non-object input
 *  (primitives, arrays, `null`, `undefined`). */
function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** Read a non-empty string. Returns `null` for non-strings,
 *  empty strings, and whitespace-only strings. */
function readNonEmptyString(value: unknown): string | null {
  const trimmed = readString(value)?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
