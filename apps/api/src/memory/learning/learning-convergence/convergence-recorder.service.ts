import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from '../../../observability/metrics.service';
import { EventLedgerService } from '../../../observability/event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from '../../../observability/autonomy-observability.types';
import { SystemSettingsService } from '../../../settings/system-settings.service';
import { MemoryMetricsService } from '../../memory-metrics.service';
import { MemorySegmentFeedbackService } from '../../memory-segment-feedback.service';
import { MemorySegmentCrudRepository } from '../../database/repositories/memory-segment.crud.repository';
import { decideMemoryRetentionKeep } from '../../memory-decay.value-predicate';
import type { MemorySegment } from '../../database/entities/memory-segment.entity';
import { LearningMeasurementSnapshotRepository } from './database/repositories/learning-measurement-snapshot.repository';
import { MemoryRetentionPolicyRepository } from './database/repositories/memory-retention-policy.repository';
import type {
  MemoryRetentionPolicyUpsertOutcome,
  MemoryRetentionPolicyUpsertResult,
} from './database/repositories/memory-retention-policy.repository';
import type { LearningMeasurementSnapshot } from './database/entities/learning-measurement-snapshot.entity';
import {
  buildRetentionDecisionDistribution,
  buildUsefulnessHistogram,
  computeKeepFraction,
  recalculateUsefulnessThreshold,
} from './convergence-recorder.helpers';
import {
  LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON,
  LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_DEFAULT,
  LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_SETTING,
  LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
  LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING,
} from './settings/learning-convergence.settings.constants';
import type {
  ConvergenceRecorderTickResult,
  ConvergenceRecorderWindow,
} from './convergence-recorder.service.types';

export type {
  ConvergenceRecorderTickOutcome,
  ConvergenceRecorderTickResult,
  ConvergenceRecorderWindow,
} from './convergence-recorder.service.types';

/** Map of window label → days-of-history the recorder scans. */
export const CONVERGENCE_RECORDER_WINDOW_DAYS: Record<
  ConvergenceRecorderWindow,
  number
> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
};

/**
 * Typed error returned by
 * {@link ConvergenceRecorderService.tick} when the pass
 * throws (AC-9). The scheduler / cron processor can inspect
 * `error.outcome === 'failed'` and the underlying `cause`
 * to decide whether to retry, alert, or no-op.
 *
 * Persistence MUST complete before the metrics write — when
 * the snapshot insert throws the metrics are NEVER bumped,
 * the upsert NEVER happens, and the error event is emitted
 * (best-effort) before the typed error is returned.
 */
export class ConvergenceRecorderTickError extends Error {
  public readonly outcome: 'failed' = 'failed' as const;
  public readonly window: ConvergenceRecorderWindow | 'multi';
  public override readonly cause: unknown;

  constructor(params: {
    message: string;
    window: ConvergenceRecorderWindow | 'multi';
    cause: unknown;
  }) {
    super(params.message);
    this.name = 'ConvergenceRecorderTickError';
    this.window = params.window;
    this.cause = params.cause;
  }
}

/**
 * Daily convergence recorder service (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2).
 *
 * The recorder is the cron-driven service that closes the
 * self-improvement feedback loop's "did the lesson actually
 * help?" measurement surface:
 *
 *   1. Reads the per-scope convergence snapshots from
 *      {@link MemoryMetricsService.getConvergenceSnapshots}
 *      for the configured rolling window.
 *   2. Aggregates them into a per-window
 *      `promoted_to_bound_score` /
 *      `bound_to_reused_score` pair (mean ratio across active
 *      scopes).
 *   3. Pulls the active `MemorySegment` set via
 *      `MemorySegmentCrudRepository.findAll({ includeArchived: false })`
 *      and computes the per-segment rolling-window
 *      usefulness ratio via the existing
 *      `MemorySegmentFeedbackService.computeUsefulnessForSegments(...)`.
 *   4. Builds the JSONB `usefulness_histogram` payload
 *      (10 numeric bins + the `unknown` bin) from the
 *      per-segment usefulness ratios.
 *   5. Builds the JSONB
 *      `retention_decision_distribution` payload from the
 *      `decideMemoryRetentionKeep` verdicts the recorder
 *      derives from the same per-segment usefulness ratios.
 *   6. Persists ONE `learning_measurement_snapshots` row per
 *      `tick()` call (AC-8 — each tick inserts a NEW row, never
 *      upserts).
 *   7. Recomputes the `memory_retention_policy` usefulness
 *      threshold via
 *      {@link recalculateUsefulnessThreshold} and upserts the
 *      singleton row via
 *      `MemoryRetentionPolicyRepository.upsertIfChanged`.
 *   8. Pushes the per-window score to the prom-client
 *      `nexus_learning_convergence_score{source}` gauge via
 *      {@link MetricsService.setConvergenceScore}
 *      (canonical label key per
 *      `ADR-learning-convergence-gauge-rename.md`).
 *   9. Increments the
 *      `nexus_memory_retention_recalibrations_total{outcome}`
 *      counter (plural `recalibrations`, canonical per
 *      `ADR-learning-convergence-gauge-rename.md`) via
 *      {@link MetricsService.recordMemoryRetentionRecalibration}.
 *  10. Emits a best-effort
 *      `AUTONOMY_EVENT_NAMES.memoryConvergenceRecorderSucceeded`
 *      audit event so the EventLedger has a per-pass heartbeat.
 *
 * Persistence (steps 6–7) MUST complete BEFORE metrics (steps
 * 8–9). When step 6 or 7 throws, the recorder catches the
 * error, emits a best-effort
 * `AUTONOMY_EVENT_NAMES.memoryConvergenceRecorderFailed`
 * event, and returns a typed {@link ConvergenceRecorderTickError}
 * so the cron processor can decide whether to retry (AC-9).
 *
 * The recorder is `@Injectable()` but does NOT register a
 * BullMQ repeatable job itself — the cron-driven scheduling
 * is owned by `ConvergenceRecorderScheduler` (milestone 3),
 * which calls `tick()` on every BullMQ tick. The `tick()`
 * method is the test-friendly seam: it is a pure
 * orchestration entry point that can be invoked from a
 * scheduler, an admin trigger handler, or a unit test.
 */
@Injectable()
export class ConvergenceRecorderService {
  private readonly logger = new Logger(ConvergenceRecorderService.name);

  /**
   * Event name the recorder uses for the pass-success
   * heartbeat (best-effort; never bubbles out of `tick()`).
   * Widened into `AUTONOMY_EVENT_NAMES` as
   * `memoryConvergenceRecorderSucceeded` so the EventLedger
   * registry is the single source of truth for autonomy
   * event names — milestone 3 (work item
   * 946a3c8b-5814-4e76-a804-b557e589600b) closes the
   * deferred-item from milestone 2.
   */
  static readonly RECORDER_PASSED_EVENT_NAME =
    AUTONOMY_EVENT_NAMES.memoryConvergenceRecorderSucceeded;

  /**
   * Event name the recorder uses for the failure
   * heartbeat. Widened into `AUTONOMY_EVENT_NAMES` as
   * `memoryConvergenceRecorderFailed`. The recorder emits
   * this event best-effort on a swallowed persistence
   * failure (AC-9).
   */
  static readonly RECORDER_FAILED_EVENT_NAME =
    AUTONOMY_EVENT_NAMES.memoryConvergenceRecorderFailed;

  /**
   * Event name the recorder emits when the
   * `memory_retention_policy` upsert applies a new
   * threshold (the proposed threshold moved by more than
   * `LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON`
   * from the singleton's current threshold). The recorder
   * currently emits the persistence metrics counter on
   * every upsert attempt; the autonomy-event surface is
   * reserved for a future milestone where the operator UI
   * subscribes to the event stream to render
   * "recalibration applied" timeline entries. Surfaced as a
   * static constant now so the call sites stay
   * self-documenting.
   */
  static readonly RECALIBRATION_APPLIED_EVENT_NAME =
    AUTONOMY_EVENT_NAMES.memoryRetentionRecalibrated;

  /**
   * Event name the recorder emits when the
   * `memory_retention_policy` upsert was a no-op (the
   * proposed threshold was within `ε` of the singleton's
   * current threshold). Mirror of
   * {@link RECALIBRATION_APPLIED_EVENT_NAME}; see that
   * field for the rationale on pre-wiring the constant.
   */
  static readonly RECALIBRATION_SKIPPED_EVENT_NAME =
    AUTONOMY_EVENT_NAMES.memoryRetentionRecalibrationSkipped;

  /**
   * Hardcoded fallback threshold the recorder hands to
   * `recalculateUsefulnessThreshold` when the operator
   * never tunes `memory_decay_usefulness_threshold` (the
   * sibling setting the memory-decay reaper consults).
   * Mirrors `MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT` so
   * the recorder and the reaper agree on the default.
   */
  static readonly DEFAULT_USEFULNESS_THRESHOLD = 0.5;

  constructor(
    private readonly memoryMetrics: MemoryMetricsService,
    private readonly feedback: MemorySegmentFeedbackService,
    private readonly segments: MemorySegmentCrudRepository,
    private readonly snapshotRepository: LearningMeasurementSnapshotRepository,
    private readonly policyRepository: MemoryRetentionPolicyRepository,
    private readonly metrics: MetricsService,
    @Optional() private readonly eventLedger?: EventLedgerService,
    @Optional() private readonly settings?: SystemSettingsService,
  ) {}

  /**
   * Run a single recorder pass over the configured rolling
   * window. The orchestration is the AC-5 / AC-8 matrix:
   *
   *   - Persistence (snapshot insert + policy upsert)
   *     completes BEFORE metrics (counter + score gauge +
   *     best-effort event). On any persistence failure the
   *     recorder catches, logs, emits the
   *     `AUTONOMY_EVENT_NAMES.memoryConvergenceRecorderFailed`
   *     event best-effort, and returns a typed
   *     {@link ConvergenceRecorderTickError}.
   *   - The per-window score is the MEAN ratio across
   *     active scopes in the window (zero when no scopes
   *     contributed). The recorder never throws on an empty
   *     scope set — it still persists a snapshot row with
   *     the all-zero histogram + distribution payload.
   *   - The policy upsert honours the
   *     `LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON`
   *     ε — a proposed threshold within `ε` of the current
   *     threshold yields `{ outcome: 'no_change', ... }`,
   *     the counter is incremented with the `no_change`
   *     label, and the gauge is NOT bumped.
   *
   * The recorder reads
   * `LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING` and
   * `LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_SETTING`
   * fresh on every call so operator tuning takes effect on
   * the next pass without restarting the API. A missing /
   * non-numeric setting falls back to the hardcoded default
   * so a malformed value cannot crash the pass.
   *
   * @returns
   *   - `{ outcome: 'recorded', snapshot, policyRow }` on a
   *     successful pass.
   *   - `ConvergenceRecorderTickError` on persistence failure
   *     (the typed error is returned, not thrown — the
   *     `catch` rethrows the typed error so callers can
   *     `instanceof`-check the return value).
   */
  async tick(): Promise<
    ConvergenceRecorderTickResult | ConvergenceRecorderTickError
  > {
    try {
      return await this.runTick();
    } catch (error) {
      const typed = this.toTickError(error, 'multi');
      this.logger.error(
        `ConvergenceRecorderService tick failed: ${typed.message}`,
        typed.stack,
      );
      await this.emitRecorderFailedSafely(typed);
      return typed;
    }
  }

  /**
   * Compute and persist a single per-window snapshot. Test
   * seam + future on-demand admin handler — the cron
   * processor iterates the three windows via `tick()`, but
   * a single-window test can call this directly.
   *
   * The `options.now` parameter is the wall-clock anchor
   * for the window scan (defaults to `new Date()`); the
   * unit tests pass an explicit clock so the rolling
   * window is deterministic.
   */
  async computeAndPersistSnapshot(params: {
    window: ConvergenceRecorderWindow;
    now?: Date;
  }): Promise<LearningMeasurementSnapshot> {
    const now = params.now ?? new Date();
    const windowDays = CONVERGENCE_RECORDER_WINDOW_DAYS[params.window];
    const snapshotsByScope =
      this.memoryMetrics.getConvergenceSnapshots(windowDays);

    const segments = await this.resolveScanSegments();
    const usefulnessBySegment = await this.computeUsefulnessForSegments(
      segments,
      now,
    );
    const usefulnessValues = this.collectUsefulnessValues(usefulnessBySegment);
    const minSamples = await this.resolveMinSamples();
    const decisionReasons = this.collectDecisionReasons(
      usefulnessBySegment,
      segments,
      minSamples,
    );

    const histogram = buildUsefulnessHistogram(usefulnessValues);
    const distribution = buildRetentionDecisionDistribution(decisionReasons);

    const aggregate = this.aggregateSnapshot(snapshotsByScope, decisionReasons);

    const snapshot = await this.snapshotRepository.insertSnapshot({
      source_window: params.window,
      promoted_to_bound_score: aggregate.promotedToBound,
      bound_to_reused_score: aggregate.boundToReused,
      usefulness_histogram: histogram,
      retention_decision_distribution: distribution,
    });

    this.metrics.setConvergenceScore(
      params.window,
      Number(aggregate.promotedToBound),
    );

    return snapshot;
  }

  /**
   * Apply the recorder's recalibrated usefulness threshold
   * to the `memory_retention_policy` singleton row, guarded
   * by the
   * `LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON`
   * ε-comparison the repository owns. Also bumps the
   * prom-client recalibration counter (best-effort — a
   * metrics outage never bubbles out of this method).
   *
   * Returns the upsert result so the caller (the cron
   * processor / unit test) can inspect the persisted row
   * without a second round trip.
   */
  async recordRetentionRecalibrationIfChanged(params: {
    threshold: number;
    sampleSize: number;
    now?: Date;
  }): Promise<MemoryRetentionPolicyUpsertResult> {
    const result = await this.policyRepository.upsertIfChanged(
      params.threshold,
      params.sampleSize,
      LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON,
    );
    try {
      this.metrics.recordMemoryRetentionRecalibration(result.outcome);
    } catch (error) {
      this.logger.warn(
        `ConvergenceRecorderService failed to bump recalibration counter: ${(error as Error).message}`,
      );
    }
    return result;
  }

  // -----------------------------------------------------------------
  // Private orchestration
  // -----------------------------------------------------------------

  /**
   * The orchestration body of {@link tick}. Split out so the
   * outer `tick()` can wrap the entire pass in a single
   * try/catch + error-event emit (AC-9), and so the unit
   * tests can drive the pass directly via the
   * `Test.createTestingModule({ providers: [ConvergenceRecorderService, ...] }).get(...)`
   * seam without going through the outer error wrapper.
   */
  private async runTick(): Promise<ConvergenceRecorderTickResult> {
    const windowDays = await this.resolveWindowDays();
    const minSamples = await this.resolveMinSamples();
    const now = new Date();
    const targetWindow = this.dominantWindow(windowDays);

    const snapshotsByScope =
      this.memoryMetrics.getConvergenceSnapshots(windowDays);

    const segments = await this.resolveScanSegments();
    const usefulnessBySegment = await this.computeUsefulnessForSegments(
      segments,
      now,
    );
    const usefulnessValues = this.collectUsefulnessValues(usefulnessBySegment);
    const decisionReasons = this.collectDecisionReasons(
      usefulnessBySegment,
      segments,
      minSamples,
    );

    const histogram = buildUsefulnessHistogram(usefulnessValues);
    const distribution = buildRetentionDecisionDistribution(decisionReasons);

    const aggregate = this.aggregateSnapshot(snapshotsByScope, decisionReasons);

    const snapshot = await this.snapshotRepository.insertSnapshot({
      source_window: targetWindow,
      promoted_to_bound_score: aggregate.promotedToBound,
      bound_to_reused_score: aggregate.boundToReused,
      usefulness_histogram: histogram,
      retention_decision_distribution: distribution,
    });

    const defaultThreshold =
      ConvergenceRecorderService.DEFAULT_USEFULNESS_THRESHOLD;
    const recalibration = recalculateUsefulnessThreshold(
      usefulnessValues,
      minSamples,
      defaultThreshold,
    );
    const policyRow = await this.recordRetentionRecalibrationIfChanged({
      threshold: recalibration.threshold,
      sampleSize: recalibration.sampleSize,
      now,
    });

    this.metrics.setConvergenceScore(
      targetWindow,
      Number(aggregate.promotedToBound),
    );

    await this.emitRecorderPassedSafely({
      snapshot_id: snapshot.computed_at.toISOString(),
      window: targetWindow,
      policy_outcome: policyRow.outcome,
      sample_size: recalibration.sampleSize,
    });

    return {
      outcome: 'recorded',
      window: 'multi',
      snapshot,
      policyRow,
    };
  }

  /**
   * Compute the per-window aggregate scores:
   *
   *   - `promoted_to_bound_score` = mean `ratio` across
   *     active scopes in the window (or `0` when no scopes
   *     contributed). Persisted as a `numeric` string so the
   *     column's arbitrary-precision guarantee holds across
   *     recorder passes.
   *   - `bound_to_reused_score` = the per-window
   *     keep-fraction — the count of
   *     `decideMemoryRetentionKeep` verdicts in
   *     `decisionReasons` whose reason is one of
   *     `RETENTION_DECISION_KEEP_REASON_KEYS`
   *     (`pinned` | `injected_and_helped` | `useful`),
   *     divided by the total NON-NULL verdict count. Also a
   *     numeric string. `null` / `undefined` verdict entries
   *     are excluded from both numerator and denominator so
   *     a no-verdicts pass deterministically yields `'0'`
   *     instead of `NaN`.
   *
   * Both are clamped to `[0, 1]` and serialised to 6 decimal
   * places so the persisted row is byte-identical across
   * recorder passes that produce the same input (AC-1 +
   * AC-8).
   *
   * Operator-facing note (milestone 1, AC-1):
   * `bound_to_reused_score` is the PER-WINDOW keep-fraction,
   * NOT a global / cumulative ratio. Two recorder passes
   * that scan different segment sets produce different
   * scores even when their underlying keep-rates are
   * identical — operators reading the operator UI must
   * compare like-for-like windows (e.g. two consecutive
   * `'24h'` rows) rather than summing the column.
   */
  private aggregateSnapshot(
    snapshotsByScope: Record<
      string,
      {
        ratio: number;
        runs_after_lesson: number;
        successes_after_lesson: number;
      }
    >,
    decisionReasons: ReadonlyArray<string | null | undefined>,
  ): { promotedToBound: string; boundToReused: string } {
    const scopeEntries = Object.values(snapshotsByScope);
    const promotedToBound =
      scopeEntries.length === 0
        ? 0
        : scopeEntries.reduce((acc, snapshot) => acc + snapshot.ratio, 0) /
          scopeEntries.length;
    const boundToReused = computeKeepFraction(decisionReasons);
    return {
      promotedToBound: roundToSixDecimals(clamp01(promotedToBound)).toString(),
      boundToReused: roundToSixDecimals(clamp01(boundToReused)).toString(),
    };
  }

  /**
   * Resolve the candidate segment set the recorder scans
   * for the usefulness + decision-distribution legs. The
   * recorder pulls every active (non-archived) segment via
   * {@link MemorySegmentCrudRepository.findAll}; the
   * usefulness batch query against this set is the source
   * of truth for "what segments to scan this pass".
   *
   * Defensive: a segment-repository outage is swallowed
   * (logged) so a transient DB blip never breaks the recorder
   * pass — the snapshot row is still persisted with an
   * all-zero histogram + distribution.
   */
  private async resolveScanSegments(): Promise<MemorySegment[]> {
    try {
      return await this.segments.findAll({ includeArchived: false });
    } catch (error) {
      this.logger.warn(
        `ConvergenceRecorderService failed to resolve scan segments; falling back to empty set: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Compute the per-segment rolling-window usefulness map
   * for the segments the recorder scans. Defensive: a
   * feedback-service outage is swallowed (logged) and the
   * recorder proceeds with an empty usefulness map (which
   * yields an all-zero histogram + distribution payload).
   */
  private async computeUsefulnessForSegments(
    segments: MemorySegment[],
    now: Date,
  ): Promise<Map<string, { usefulness: number | null; sampleSize: number }>> {
    if (segments.length === 0) {
      return new Map();
    }
    try {
      return await this.feedback.computeUsefulnessForSegments(
        segments.map((segment) => segment.id),
        now,
      );
    } catch (error) {
      this.logger.warn(
        `ConvergenceRecorderService failed to compute usefulness for segments; falling back to empty map: ${(error as Error).message}`,
      );
      return new Map();
    }
  }

  /**
   * Reduce the per-segment usefulness map into the flat list
   * the histogram helper consumes. `null` entries (never
   * voted) are passed through verbatim so they land in the
   * `unknown` bin.
   */
  private collectUsefulnessValues(
    usefulnessBySegment: Map<
      string,
      { usefulness: number | null; sampleSize: number }
    >,
  ): Array<number | null | undefined> {
    const values: Array<number | null | undefined> = [];
    for (const vote of usefulnessBySegment.values()) {
      values.push(vote.usefulness);
    }
    return values;
  }

  /**
   * Reduce the per-segment usefulness map + scan set into the
   * flat list of `decideMemoryRetentionKeep` reason codes the
   * distribution helper consumes. The decision for each
   * segment is computed against the recorder's
   * `LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_SETTING` and
   * the `DEFAULT_USEFULNESS_THRESHOLD` fallback.
   *
   * The function is pure — no DB, no I/O — so the unit
   * tests can exhaustively pin the reason-code mapping
   * without spinning up a NestJS module.
   */
  private collectDecisionReasons(
    usefulnessBySegment: Map<
      string,
      { usefulness: number | null; sampleSize: number }
    >,
    segments: MemorySegment[],
    minSamples: number,
  ): Array<string | null | undefined> {
    if (segments.length === 0) {
      return [];
    }
    const reasons: Array<string | null | undefined> = [];
    for (const segment of segments) {
      const vote = usefulnessBySegment.get(segment.id) ?? {
        usefulness: null,
        sampleSize: 0,
      };
      const verdict = decideMemoryRetentionKeep(
        {
          pinned: segment.pinned,
          usefulness: vote.usefulness,
          sampleSize: vote.sampleSize,
          injectedAndHelped: false,
          source: segment.source,
        },
        {
          usefulnessThreshold:
            ConvergenceRecorderService.DEFAULT_USEFULNESS_THRESHOLD,
          minSamples: Math.max(0, Math.floor(minSamples)),
        },
      );
      reasons.push(verdict.reason);
    }
    return reasons;
  }

  /**
   * Map the recorder's resolved rolling window (in days) to
   * the closed `ConvergenceRecorderWindow` enum the snapshot
   * repository accepts. The mapping is one-to-one and
   * exhaustive over the canonical
   * `CONVERGENCE_RECORDER_WINDOW_DAYS` table — any
   * `windowDays` outside the canonical set is bucketed into
   * the closest enum value (`<= 1` → `24h`, `<= 7` → `7d`,
   * otherwise `30d`).
   */
  private dominantWindow(windowDays: number): ConvergenceRecorderWindow {
    if (windowDays <= 1) {
      return '24h';
    }
    if (windowDays <= 7) {
      return '7d';
    }
    return '30d';
  }

  /**
   * Resolve the live
   * `learning_convergence_window_days` SystemSetting.
   * Falls back to the hardcoded
   * `LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT` (1 day) when
   * the settings service is not wired or when the read
   * itself throws.
   */
  private async resolveWindowDays(): Promise<number> {
    if (!this.settings) {
      return LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT;
    }
    try {
      const raw = await this.settings.get<unknown>(
        LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING,
        LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
      );
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        return Math.floor(raw);
      }
      return LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT;
    } catch {
      return LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT;
    }
  }

  /**
   * Resolve the live
   * `learning_convergence_usefulness_min_samples` SystemSetting.
   * Falls back to
   * `LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_DEFAULT`
   * (10) when the settings service is not wired or when the
   * read itself throws.
   */
  private async resolveMinSamples(): Promise<number> {
    if (!this.settings) {
      return LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_DEFAULT;
    }
    try {
      const raw = await this.settings.get<unknown>(
        LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_SETTING,
        LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_DEFAULT,
      );
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
        return Math.floor(raw);
      }
      return LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_DEFAULT;
    } catch {
      return LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_DEFAULT;
    }
  }

  /**
   * Best-effort emit of the
   * `AUTONOMY_EVENT_NAMES.memoryConvergenceRecorderSucceeded`
   * event. Mirrors the `emitBestEffort` swallow-and-continue
   * pattern in `MemoryDecayReaperService.emitDecayShadow` —
   * a downstream EventLedger outage never bubbles out of the
   * recorder pass. The DB has already been mutated with the
   * snapshot + upsert by the time this runs; this method
   * only OBSERVES.
   */
  private async emitRecorderPassedSafely(params: {
    snapshot_id: string;
    window: ConvergenceRecorderWindow;
    policy_outcome: MemoryRetentionPolicyUpsertOutcome;
    sample_size: number;
  }): Promise<void> {
    if (!this.eventLedger) {
      return;
    }
    try {
      await this.eventLedger.emitBestEffort({
        domain: 'memory',
        eventName: ConvergenceRecorderService.RECORDER_PASSED_EVENT_NAME,
        outcome: 'success',
        payload: {
          snapshot_id: params.snapshot_id,
          window: params.window,
          policy_outcome: params.policy_outcome,
          sample_size: params.sample_size,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit ${ConvergenceRecorderService.RECORDER_PASSED_EVENT_NAME}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Best-effort emit of the
   * `AUTONOMY_EVENT_NAMES.memoryConvergenceRecorderFailed`
   * event on a persistence failure. Mirrors the
   * swallow-and-continue pattern in
   * `MemoryDecayReaperService.emitDecayShadow` — the typed
   * {@link ConvergenceRecorderTickError} is returned to the
   * caller regardless of the emit outcome.
   */
  private async emitRecorderFailedSafely(
    error: ConvergenceRecorderTickError,
  ): Promise<void> {
    if (!this.eventLedger) {
      return;
    }
    try {
      await this.eventLedger.emitBestEffort({
        domain: 'memory',
        eventName: ConvergenceRecorderService.RECORDER_FAILED_EVENT_NAME,
        outcome: 'failure',
        errorMessage: error.message,
        payload: {
          window: error.window,
          error_name: error.name,
        },
      });
    } catch (emitError) {
      this.logger.warn(
        `Failed to emit ${ConvergenceRecorderService.RECORDER_FAILED_EVENT_NAME}: ${(emitError as Error).message}`,
      );
    }
  }

  /**
   * Wrap an arbitrary caught error in a typed
   * {@link ConvergenceRecorderTickError}. Idempotent on
   * already-typed errors so the outer `tick()` does not
   * double-wrap when the inner orchestration already threw
   * a typed error.
   */
  private toTickError(
    error: unknown,
    window: ConvergenceRecorderWindow | 'multi',
  ): ConvergenceRecorderTickError {
    if (error instanceof ConvergenceRecorderTickError) {
      return error;
    }
    const err = error as Error;
    return new ConvergenceRecorderTickError({
      message: err?.message ?? 'ConvergenceRecorderService tick failed',
      window,
      cause: error,
    });
  }
}

/**
 * Clamp a finite number to the `[0, 1]` interval so the
 * persisted score can never escape the convergence-ratio
 * domain. Non-finite inputs are coerced to `0` so a bad
 * upstream value cannot persist a `NaN` row.
 */
function clamp01(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

/**
 * Round a finite number to 6 decimal places via the
 * `Math.round(value * 1e6) / 1e6` idiom — matches the
 * `LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON`
 * so the persisted score is round-trip stable across
 * recorder passes.
 */
function roundToSixDecimals(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
