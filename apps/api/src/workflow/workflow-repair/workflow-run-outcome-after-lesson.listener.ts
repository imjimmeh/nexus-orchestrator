/**
 * `WorkflowRunOutcomeAfterLessonListener` — milestone 2 of work item
 * 88d7654e-ca93-4ffa-8ba5-7065db9506db.
 *
 * Subscribes to the terminal workflow-run events
 * (`WORKFLOW_RUN_COMPLETED_EVENT`, `WORKFLOW_RUN_FAILED_EVENT`)
 * and, for each `(lesson_id, scope)` pair that
 * `MemoryMetricsService.recordLearningLessonInjected` recorded
 * during the run, emits exactly one
 * `nexus_workflow_run_outcome_after_lesson_total{lesson_id,
 * scope, outcome}` increment — closing the self-improvement
 * feedback loop that milestone 1 (the inject counter) opened.
 *
 * Listener contract (mirrors the spec document):
 *   1. Defensive `status` check (the listener subscribes to
 *      COMPLETED and FAILED only; the check is
 *      belt-and-suspenders against a misconfigured event
 *      name on the publisher side). CANCELLED is intentionally
 *      excluded because cancellation is not a meaningful
 *      convergence signal for an injected lesson.
 *   2. Resolve `outcome` from `event.status` — `COMPLETED →
 *      'success'`, `FAILED → 'failure'`. Any other status
 *      (e.g. `CANCELLED` due to a publisher mistake) returns
 *      early WITHOUT touching the counter.
 *   3. Call
 *      `memoryMetrics.consumeRunLessonInjects(workflowRunId)`
 *      to drain the per-run set. The drain is consume-once:
 *      a duplicate terminal event (publisher retry, race
 *      between COMPLETED and FAILED observers) returns an
 *      empty array and does NOT increment the counter.
 *   4. If the drained array is empty (the run had no
 *      injections), return WITHOUT incrementing the counter
 *      — milestone 1 only fires the inject counter when a
 *      lesson actually enters the planning context, so the
 *      absence of an inject implies the absence of an
 *      outcome-after-lesson to record.
 *   5. For each `(lesson_id, scope)` pair in the drained
 *      array, call
 *      `metrics.recordLearningRunOutcomeAfterLesson(...)` AND
 *      `memoryMetrics.recordWorkflowRunOutcomeAfterLesson(...)`
 *      in lock-step so the per-process REST snapshot and the
 *      Prometheus scrape agree.
 *   6. On ANY thrown error → catch, log at warn, swallow so
 *      the event bus is never crashed. The outcome-after-lesson
 *      counter is a best-effort observability surface and
 *      must not interfere with the rest of the lifecycle
 *      pipeline (parallel postmortem / classification /
 *      repair-dispatch listeners run on the same event).
 *
 * The handler is named `handleWorkflowRunCompleted` /
 * `handleWorkflowRunFailed` to mirror the neighbouring
 * `WorkflowFailurePostmortemListener` (same import line, same
 * lifecycle hooks, same NestJS `OnEvent` convention).
 *
 * The listener does NOT depend on `WorkflowRunRepository` or
 * any DB-touching service — it operates entirely on the
 * in-process per-run inject set populated by
 * `StepSupportService.buildPromotedLearningContext`. This
 * keeps the listener single-purpose (and the unit test
 * trivial: a `MemoryMetricsService` mock with a
 * `consumeRunLessonInjects` vi.fn and a `MetricsService`
 * mock with a `recordLearningRunOutcomeAfterLesson` vi.fn).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowStatus } from '@nexus/core';
import { MemoryMetricsService } from '../../memory/memory-metrics.service';
import { MetricsService } from '../../observability/metrics.service';
import { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { matchesAnchor } from '../../memory/signals/anchor-match.helper';
import type { AnchorMatchRow } from '../../memory/signals/anchor-match.types';
import type { LessonAnchor } from '../../memory/signals/lesson-anchor.types';
import type { LearningLessonInjectRecord } from '../../memory/memory-metrics.types';
import {
  LEARNING_BEHAVIOUR_CHANGE_ENABLED_DEFAULT,
  LEARNING_BEHAVIOUR_CHANGE_ENABLED_SETTING,
  coerceLearningBehaviourChangeEnabled,
} from '../../settings/learning-measurement.settings.constants';
import {
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
} from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';

type OutcomeAfterLesson = 'success' | 'failure';

/** Cap on the tool-execution scan, matching the `EventLedgerRepository.query` ceiling. */
const TOOL_SCAN_LIMIT = 1000;

@Injectable()
export class WorkflowRunOutcomeAfterLessonListener {
  private readonly logger = new Logger(
    WorkflowRunOutcomeAfterLessonListener.name,
  );

  constructor(
    private readonly memoryMetrics: MemoryMetricsService,
    private readonly metrics: MetricsService,
    @Optional() private readonly settings?: SystemSettingsService,
    @Optional() private readonly eventLedger?: EventLedgerRepository,
  ) {}

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async handleWorkflowRunCompleted(event: WorkflowRunEvent): Promise<void> {
    // The outcome-after-lesson recording is synchronous; the
    // behaviour-change pass is async (a capped DB scan) and is
    // awaited after so a slow / failing scan never blocks the
    // outcome counter and never crashes the event bus.
    const result = this.processTerminalEvent(event, WorkflowStatus.COMPLETED);
    if (result) {
      await this.recordBehaviourChange(event, result.drained);
    }
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async handleWorkflowRunFailed(event: WorkflowRunEvent): Promise<void> {
    const result = this.processTerminalEvent(event, WorkflowStatus.FAILED);
    if (result) {
      await this.recordBehaviourChange(event, result.drained);
    }
  }

  /**
   * Drive the outcome-after-lesson pipeline end-to-end.
   *
   * Belt-and-suspenders: each `@OnEvent` handler is wired to
   * a single event name but the publisher could in principle
   * publish a different status on the same event name in the
   * future. The early `status !== expected` return also
   * shields CANCELLED runs from being counted as either
   * `success` or `failure` — CANCELLED is not a meaningful
   * convergence signal.
   *
   * Returns when the per-run set has been drained (either
   * to the counter or to a no-op when the run had no
   * injections). Never throws — any error that escapes the
   * pipeline is caught by the inner try/catch and logged at
   * warn.
   *
   * Synchronous: the underlying `consumeRunLessonInjects` and
   * `record*` mutators are all in-process and complete on the
   * same tick. The outer `handleWorkflowRunCompleted` /
   * `handleWorkflowRunFailed` handlers are still `async`
   * (NestJS `@OnEvent` contract); the `await` on the
   * returned Promise just lets the synchronous pipeline run
   * to completion before yielding.
   */
  private processTerminalEvent(
    event: WorkflowRunEvent,
    expectedStatus: WorkflowStatus,
  ): { drained: ReadonlyArray<LearningLessonInjectRecord> } | null {
    if (event.status !== expectedStatus) {
      return null;
    }
    const outcome = this.resolveOutcome(event.status);
    if (outcome === null) {
      return null;
    }

    try {
      const drained = this.memoryMetrics.consumeRunLessonInjects(
        event.workflowRunId,
      );
      if (drained.length === 0) {
        // No injections during this run → nothing to record.
        // This is the expected path for the majority of
        // runs (only planning-step runs that resolved a
        // promoted-lesson scope actually inject). Leaving
        // the counter untouched here is critical for
        // milestone 3's convergence ratio: it must count
        // outcome-after-injection, not outcome-after-run.
        return { drained };
      }
      for (const pair of drained) {
        this.metrics.recordLearningRunOutcomeAfterLesson(
          pair.lesson_id,
          pair.scope,
          outcome,
        );
        this.memoryMetrics.recordWorkflowRunOutcomeAfterLesson({
          lesson_id: pair.lesson_id,
          scope: pair.scope,
          outcome,
          ...(pair.holdout_arm !== undefined
            ? { holdout_arm: pair.holdout_arm }
            : {}),
        });
      }
      this.logger.debug(
        `WorkflowRunOutcomeAfterLessonListener recorded ${drained.length.toString()} outcome-after-lesson event(s) for run ${event.workflowRunId} (status=${event.status}, outcome=${outcome}).`,
      );
      return { drained };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `WorkflowRunOutcomeAfterLessonListener swallowed error for run ${event.workflowRunId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }

  /**
   * Behaviour-change pass (EPIC-212 Phase 3, Task 6).
   *
   * For each injected lesson that carried a behaviour-change anchor, scan
   * the run's tool-execution rows (one capped `EventLedgerRepository.query`)
   * and record whether the anchored tool/path was actually invoked after
   * injection. Read-only measurement; gated by
   * `learning_behaviour_change_enabled` (default on). Fail-soft end to end:
   * gate off, no ledger wired, or any error → skip without counting.
   *
   * A lesson with no anchor is NEVER counted (no false negatives).
   */
  private async recordBehaviourChange(
    event: WorkflowRunEvent,
    drained: ReadonlyArray<LearningLessonInjectRecord>,
  ): Promise<void> {
    const anchored = drained.filter(
      (record) =>
        record.anchored_tool !== undefined ||
        record.anchored_path !== undefined,
    );
    if (anchored.length === 0) {
      return;
    }
    if (!(await this.isBehaviourChangeEnabled()) || !this.eventLedger) {
      return;
    }
    try {
      const rows = await this.scanToolRows(event.workflowRunId);
      for (const record of anchored) {
        const anchor = toAnchor(record);
        const changed = matchesAnchor(rows, anchor);
        this.metrics.recordLearningBehaviourChange(record.scope, changed);
        this.memoryMetrics.recordLearningBehaviourChange({
          lesson_id: record.lesson_id,
          scope: record.scope,
          changed,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `WorkflowRunOutcomeAfterLessonListener behaviour-change scan failed for run ${event.workflowRunId}: ${message}`,
      );
    }
  }

  /** Resolve the behaviour-change gate, defaulting ON when unwired/malformed. */
  private async isBehaviourChangeEnabled(): Promise<boolean> {
    if (!this.settings) {
      return LEARNING_BEHAVIOUR_CHANGE_ENABLED_DEFAULT;
    }
    try {
      const raw = await this.settings.get<unknown>(
        LEARNING_BEHAVIOUR_CHANGE_ENABLED_SETTING,
        LEARNING_BEHAVIOUR_CHANGE_ENABLED_DEFAULT,
      );
      return coerceLearningBehaviourChangeEnabled(raw);
    } catch {
      return LEARNING_BEHAVIOUR_CHANGE_ENABLED_DEFAULT;
    }
  }

  /**
   * One capped scan of the run's tool-execution ledger rows, projected to
   * the {@link AnchorMatchRow} shape the pure matcher consumes.
   */
  private async scanToolRows(workflowRunId: string): Promise<AnchorMatchRow[]> {
    if (!this.eventLedger) {
      return [];
    }
    const [rows] = await this.eventLedger.query({
      workflow_run_id: workflowRunId,
      domain: 'tool',
      limit: TOOL_SCAN_LIMIT,
    });
    return rows.map((row) => ({
      ...(typeof row.tool_name === 'string' ? { toolName: row.tool_name } : {}),
      pathText: row.payload ? JSON.stringify(row.payload) : '',
    }));
  }

  /**
   * Map a workflow-run terminal status to the closed
   * `outcome` label union on the
   * `nexus_workflow_run_outcome_after_lesson_total` counter.
   *
   * Returns `null` for any non-terminal status (e.g.
   * `CANCELLED`) so the caller can skip early. This keeps
   * the counter label union strictly closed: only
   * `success` and `failure` are ever written.
   */
  private resolveOutcome(status: WorkflowStatus): OutcomeAfterLesson | null {
    if (status === WorkflowStatus.COMPLETED) {
      return 'success';
    }
    if (status === WorkflowStatus.FAILED) {
      return 'failure';
    }
    return null;
  }
}

/** Rebuild the {@link LessonAnchor} from a drained inject record's fields. */
function toAnchor(record: LearningLessonInjectRecord): LessonAnchor {
  return {
    ...(record.anchored_tool !== undefined
      ? { tool: record.anchored_tool }
      : {}),
    ...(record.anchored_path !== undefined
      ? { path: record.anchored_path }
      : {}),
  };
}
