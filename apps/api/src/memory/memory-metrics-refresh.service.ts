import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Optional } from '@nestjs/common';
import { MemoryMetricsService } from './memory-metrics.service';
import { MemoryProbationEvaluatorService } from './learning/memory-probation-evaluator.service';
import { MemorySegmentAggregationRepository } from './database/repositories/memory-segment.aggregation.repository';
import { MemorySegmentLearningCandidateRepository } from './database/repositories/memory-segment.learning-candidate.repository';
import { LearningCandidateRepository } from './database/repositories/learning-candidate.repository';
import { BudgetUsageEventRepository } from '../cost-governance/database/repositories/budget-usage-event.repository';
import { SystemSettingsService } from '../settings/system-settings.service';
import { MetricsService } from '../observability/metrics.service';
import type { BackendLabel } from './memory-metrics.types';
import {
  MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING,
  coerceMemoryMetricsGaugeUseRefresh,
  coerceMemoryMetricsRefreshIntervalSeconds,
} from '../settings/memory-metrics-settings.constants';
import {
  LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
  LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING,
  coerceLearningConvergenceWindowDays,
} from '../settings/learning-convergence-settings.constants';
import { LEARNING_COST_CONTEXT_TYPES } from '../settings/learning-measurement.settings.constants';

const MS_PER_DAY = 86_400_000;

/**
 * The single backend label the refresh service can authoritatively
 * count against. The `memory_segments` table is the postgres-backed
 * source of truth; Honcho data lives in an external service and the
 * `active_segments` gauge for `honcho` therefore remains the legacy
 * bump-on-write path until a future work item introduces an equivalent
 * query surface. The kill-switch semantics in the work item only
 * require the *postgres* gauge to be query-authoritative.
 */
const REFRESHABLE_BACKEND: BackendLabel = 'postgres';

/**
 * Recurring refresh service that overwrites the per-backend
 * `active_segments` gauge in `MemoryMetricsService` (and the matching
 * prom-client gauge on `MetricsService`) with the result of a real
 * `SELECT count(*) FROM memory_segments GROUP BY source` against the
 * database.
 *
 * The legacy `bumpActiveSegmentsGauge` path in `MemoryManagerService`
 * is preserved so operators can roll back via the
 * `memory_metrics_gauge_use_refresh` kill switch without code changes.
 * When the kill switch is on (default), the refresh tick replaces the
 * gauge for `postgres`/`<source>` with the DB-authoritative count. When
 * the kill switch is off, the refresh is a no-op and the bump path is
 * the only source of the gauge.
 *
 * Lifecycle:
 *   - `onApplicationBootstrap` arms a self-rescheduling async chain
 *     that re-reads the interval setting on every tick, so operator
 *     changes take effect on the next tick without a restart. The tick
 *     body is fully try/catch'd — DB outages MUST NOT crash the
 *     process.
 *   - `onModuleDestroy` cancels the pending reschedule.
 *
 * Why `OnApplicationBootstrap` and not `OnModuleInit`:
 *   - `MemoryModule` and `SystemSettingsModule` are both global. Using
 *     `OnApplicationBootstrap` (mirroring the pattern in
 *     `BuiltInContextProviderRegistrar`) means the chain is only
 *     armed after every module's `onModuleInit` has finished — in
 *     particular after `SystemSettingsModule.onModuleInit` has run
 *     `seedDefaults`, so the two new settings are guaranteed to exist
 *     on the first tick.
 */
@Injectable()
export class MemoryMetricsRefreshService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MemoryMetricsRefreshService.name);
  private rescheduleHandle: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private isStopped = false;

  constructor(
    private readonly memoryMetrics: MemoryMetricsService,
    private readonly metrics: MetricsService,
    private readonly memorySegments: MemorySegmentAggregationRepository,
    private readonly learningCandidateSegments: MemorySegmentLearningCandidateRepository,
    private readonly settings: SystemSettingsService,
    @Optional()
    private readonly budgetUsage?: BudgetUsageEventRepository,
    @Optional()
    private readonly learningCandidates?: LearningCandidateRepository,
    @Optional()
    private readonly probationEvaluator?: MemoryProbationEvaluatorService,
  ) {}

  /**
   * Arm the recurring refresh. Public so the test suite can drive the
   * lifecycle without spinning up the full NestJS app.
   */
  onApplicationBootstrap(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /**
   * Public start hook for tests. Idempotent — calling it twice does
   * not stack reschedule handles.
   */
  start(): void {
    if (this.rescheduleHandle !== null) {
      return;
    }
    this.isStopped = false;
    void this.scheduleNext();
    this.logger.log(
      `Memory metrics active_segments refresh armed (default interval ${MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT.toString()}s, re-read on every tick)`,
    );
  }

  /**
   * Public stop hook for tests. Idempotent — calling it twice is a
   * no-op. Cancels the pending reschedule so a slow test does not keep
   * the Node process alive.
   */
  stop(): void {
    this.isStopped = true;
    if (this.rescheduleHandle === null) {
      return;
    }
    clearTimeout(this.rescheduleHandle);
    this.rescheduleHandle = null;
  }

  /**
   * Run a single refresh tick. Public so tests can drive the body
   * without relying on fake timers.
   *
   * The body is structured as a sequence of independent steps so each
   * failure mode is observable:
   *   1. Read the kill switch — if `false`, return early without
   *      touching any gauge.
   *   2. Read the live count from the database.
   *   3. Push each `(source, count)` row into both the in-memory
   *      `MemoryMetricsService` and the prom-client `MetricsService`.
   *
   * Step 1 is non-throwing (uses `?? true` semantics). Steps 2 & 3 are
   * wrapped in try/catch — DB errors are logged but never thrown out
   * of the function.
   */
  async runRefreshOnce(): Promise<void> {
    const useRefresh = await this.readKillSwitch();
    if (!useRefresh) {
      return;
    }

    let rows: Array<{ source: string; count: number }>;
    try {
      rows = await this.memorySegments.countActiveSegmentsBySource();
    } catch (error) {
      this.logger.warn(
        `Memory metrics refresh query failed: ${(error as Error).message}`,
      );
      return;
    }

    try {
      for (const row of rows) {
        const count = Math.max(0, Math.floor(row.count));
        this.memoryMetrics.setActiveSegments(
          REFRESHABLE_BACKEND,
          row.source,
          count,
        );
        this.metrics.setMemoryBackendActiveSegments(
          REFRESHABLE_BACKEND,
          row.source,
          count,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Memory metrics refresh push failed: ${(error as Error).message}`,
      );
    }

    await this.runMeasurementPass();
  }

  /**
   * Cost-per-promoted-memory + suppressed-noise measurement pass (EPIC-212
   * Phase 3, Task 6). Runs under the same refresh kill switch as the gauge
   * refresh. Fail-soft and additive: each leg independently reports `null`
   * (clearing the field) when its data source is unavailable, so a missing
   * repository or DB error never throws out of the tick.
   */
  private async runMeasurementPass(): Promise<void> {
    await this.refreshCostPerPromotedMemory();
    await this.refreshSuppressedNoiseCount();
    await this.runProbationPass();
  }

  /**
   * Provisional-memory probation evaluator pass (EPIC-212 Phase 3, Task 7).
   * Runs after the gauge + measurement passes, inside the same kill-switch +
   * fail-soft envelope so a probation failure never breaks the gauge refresh.
   * The evaluator owns its own default-OFF flag gating + DB query; this method
   * only wraps it (and no-ops when the evaluator is not wired).
   */
  private async runProbationPass(): Promise<void> {
    if (!this.probationEvaluator) {
      return;
    }
    try {
      await this.probationEvaluator.runProbationPass();
    } catch (error) {
      this.logger.warn(
        `Probation evaluator pass failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Compute `cost = (analyst + embedding spend in window) / promoted count`.
   * `null` when the spend or the promoted count is unavailable / zero.
   */
  private async refreshCostPerPromotedMemory(): Promise<void> {
    if (!this.budgetUsage) {
      return;
    }
    try {
      const windowStart = new Date(
        Date.now() - (await this.windowDays()) * MS_PER_DAY,
      );
      const [spendCents, promoted] = await Promise.all([
        this.budgetUsage.sumCostCentsInWindowByContextTypes(
          LEARNING_COST_CONTEXT_TYPES,
          windowStart,
        ),
        this.learningCandidateSegments.countPromotedSegmentsCreatedSince(
          windowStart,
        ),
      ]);
      if (spendCents <= 0 || promoted <= 0) {
        this.memoryMetrics.setLearningCostPerPromotedMemory(null);
        return;
      }
      const cost = spendCents / promoted;
      this.memoryMetrics.setLearningCostPerPromotedMemory(cost);
      this.metrics.setLearningCostPerPromotedMemory(cost);
    } catch (error) {
      this.logger.warn(
        `Cost-per-promoted-memory refresh failed: ${(error as Error).message}`,
      );
      this.memoryMetrics.setLearningCostPerPromotedMemory(null);
    }
  }

  /** Roll up the dedup/template-suppressed (merged) candidate count. */
  private async refreshSuppressedNoiseCount(): Promise<void> {
    if (!this.learningCandidates) {
      return;
    }
    try {
      const count = await this.learningCandidates.countMerged();
      this.memoryMetrics.setLearningSuppressedNoiseCount(count);
    } catch (error) {
      this.logger.warn(
        `Suppressed-noise refresh failed: ${(error as Error).message}`,
      );
      this.memoryMetrics.setLearningSuppressedNoiseCount(null);
    }
  }

  /** Resolve the live convergence window (reused as the cost window). */
  private async windowDays(): Promise<number> {
    try {
      const raw = await this.settings.get<unknown>(
        LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING,
        LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
      );
      return coerceLearningConvergenceWindowDays(raw);
    } catch {
      return LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT;
    }
  }

  /**
   * Re-entrant scheduler: read the live interval setting and arm the
   * next tick. The tick body itself is wrapped to guarantee that
   * `scheduleNext` is always called (success, error, or rejection) so
   * the chain does not die on a single bad tick.
   */
  private async scheduleNext(): Promise<void> {
    if (this.isStopped) {
      return;
    }

    const intervalMs = await this.readLiveIntervalMs();
    if (this.isStopped) {
      return;
    }

    this.rescheduleHandle = setTimeout(() => {
      this.rescheduleHandle = null;
      if (this.isRunning) {
        // Re-entrancy guard for double-scheduled ticks (should not
        // happen via the normal path; protects against external
        // re-entries in tests). Skip the body and reschedule.
        void this.scheduleNext();
        return;
      }

      this.isRunning = true;
      void this.runRefreshOnce()
        .catch((error: unknown) => {
          this.logger.error(
            `Unhandled error in MemoryMetricsRefreshService tick: ${(error as Error).message}`,
          );
        })
        .finally(() => {
          this.isRunning = false;
          void this.scheduleNext();
        });
    }, intervalMs);
  }

  /**
   * Read the kill switch setting. Returns `true` (refresh enabled)
   * when the setting is absent or malformed so a missing key never
   * silently disables the refresh.
   */
  private async readKillSwitch(): Promise<boolean> {
    try {
      const raw = await this.settings.get<unknown>(
        MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING,
        true,
      );
      return coerceMemoryMetricsGaugeUseRefresh(raw, true);
    } catch (error) {
      this.logger.warn(
        `Failed to read kill switch setting; defaulting to enabled: ${(error as Error).message}`,
      );
      return true;
    }
  }

  /**
   * Read the live interval setting. Re-reads on every call so operator
   * overrides take effect on the next tick without a restart. Falls
   * back to the hardcoded default when the setting is missing or out
   * of range.
   */
  private async readLiveIntervalMs(): Promise<number> {
    try {
      const raw = await this.settings.get<unknown>(
        MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING,
        MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT,
      );
      return coerceMemoryMetricsRefreshIntervalSeconds(raw) * 1000;
    } catch (error) {
      this.logger.warn(
        `Failed to read interval setting; defaulting to ${MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT.toString()}s: ${(error as Error).message}`,
      );
      return MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT * 1000;
    }
  }
}
