/**
 * Thin orchestrator wrapper for the `MemoryDecayReaperService`.
 *
 * The previous incarnation of this file owned the per-pass
 * classification loop, the BullMQ scheduler, the settings
 * resolution, and the per-system-setting coercion helpers —
 * 784 lines. To stay under the project's `max-lines` lint
 * cap the class now delegates to four sibling modules:
 *
 *   - `memory-decay.coercion.ts` — pure coercion helpers
 *     (`coerceEnabled`, `coerceDailyRate`, `coerceFloor`).
 *     Re-exported from this module for backwards-compatibility
 *     with the postmortem-settings consumer.
 *   - `memory-decay.scheduler.ts` — pure helper that registers
 *     the `memory-decay` BullMQ repeatable job.
 *   - `memory-decay.settings.helpers.ts` — pure helper that
 *     resolves the full `MemoryDecaySettings` snapshot from
 *     `SystemSettingsService` (priority chain identical to
 *     before).
 *   - `memory-decay.run-orchestrator.ts` — pure helpers that
 *     own the per-row classification, shadow emit, and
 *     candidate-query concerns.
 *
 * The public surface of `MemoryDecayReaperService` is preserved
 * byte-identically: the same constructors, the same
 * `onApplicationBootstrap`, `scheduleDecayJob`,
 * `runDecayPass(...)` method signatures, and the same exports.
 */
import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SystemSettingsService } from '../settings/system-settings.service';
import { MemorySegmentDecayRepository } from './database/repositories/memory-segment.decay.repository';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import {
  MEMORY_DECAY_EXEMPT_SOURCES,
  MEMORY_DECAY_QUEUE,
  MEMORY_DECAY_SETTING_KEYS,
} from './memory-decay.constants';
import { MemorySegmentFeedbackService } from './memory-segment-feedback.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import type { MemoryDecaySettings } from './memory-decay.types';
import { MemoryDecaySettingsResolver } from './memory-decay.settings.resolver';

export type {
  MemoryDecayRunOptions,
  MemoryDecayRunSummary,
  MemoryDecaySettings,
} from './memory-decay.types';

// Re-export the coercion helpers so existing external consumers
// (`PostmortemSettingsResolver` and the legacy drift-detection
// mirror) keep working without an import-path change. New code
// should import them directly from `./memory-decay.coercion`.
export {
  coerceEnabled,
  coerceDailyRate,
  coerceFloor,
} from './memory-decay.coercion';

// Re-export the BullMQ queue constant from the scheduler module
// so historical consumers of `MEMORY_DECAY_QUEUE` from this file
// keep working.
export {
  MEMORY_DECAY_REPEAT_JOB_ID,
  MEMORY_DECAY_REMOVE_ON_COMPLETE,
  MEMORY_DECAY_REMOVE_ON_FAIL,
} from './memory-decay.scheduler';

import { registerMemoryDecayRepeatableJob } from './memory-decay.scheduler';
import { resolveDecaySettings } from './memory-decay.settings.helpers';
import {
  emitDecayShadow,
  findDecayCandidates,
  resolveUsefulnessForPredicate,
  runCandidateLoop,
} from './memory-decay.run-orchestrator';

/**
 * Confidence-decay reaper for the `memory_segments` table.
 *
 * The reaper is invoked on a cron schedule (default `30 3 * * *`,
 * configurable via the `memory_decay_cron` SystemSetting) and
 * runs a single pass that:
 *
 *   1. Resolves the active decay settings from
 *      {@link SystemSettingsService} (no caching at construction —
 *      operators can change the values between ticks).
 *   2. Short-circuits with `skipped: true` if `memory_decay_enabled`
 *      is `false` (the kill switch). No DB scan, no row mutation.
 *   3. Queries the `memory_segments` table for candidate rows:
 *        - `archived_at IS NULL` (already-archived rows are
 *          invisible to the reaper — they are preserved for
 *          auditability and double-counting them would inflate the
 *          active-set gauge),
 *        - `source NOT IN MEMORY_DECAY_EXEMPT_SOURCES` (the
 *          defensive allowlist for promoted lessons,
 *          post-mortems, and strategic intent),
 *        - `effective_last_touch = max(last_accessed_at,
 *          last_reinforced_at)` is older than the configured
 *          grace window.
 *   4. For each candidate, computes the per-day subtractive decay
 *      on `metadata_json.confidence`. If the decayed value would
 *      fall below the floor, the reaper sets `archived_at` instead
 *      of mutating the confidence — the row is preserved for
 *      auditability.
 *   5. Returns a {@link MemoryDecayRunSummary} so callers (and
 *      tests) can assert on the run outcome and the
 *      `MemoryMetricsService` snapshot stays in sync via
 *      `setMemoryDecayLastRun(...)`.
 *
 * Settings are resolved fresh on every `runDecayPass()` so the
 * operator can tune the values between ticks without restarting
 * the application. The reaper NEVER throws on a per-row failure
 * — a transient DB blip will lose that row's contribution to the
 * run but not the rest of the batch.
 *
 * BullMQ wiring:
 *   The cron-driven scheduling is owned by
 *   {@link MemoryDecayReaperService.scheduleDecayJob}, which is
 *   invoked from `onApplicationBootstrap`. `runDecayPass()` is the
 *   test-friendly seam: it is a pure method that can be invoked
 *   from a BullMQ processor, an admin trigger handler, or a unit
 *   test.
 */
@Injectable()
export class MemoryDecayReaperService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MemoryDecayReaperService.name);

  constructor(
    private readonly decaySegments: MemorySegmentDecayRepository,
    private readonly memorySegments: MemorySegmentCrudRepository,
    private readonly settings: SystemSettingsService,
    private readonly memoryMetrics: MemoryMetricsService,
    private readonly metrics: MetricsService,
    @Optional()
    private readonly feedback?: MemorySegmentFeedbackService,
    @Optional()
    private readonly eventLedger?: EventLedgerService,
    @Optional()
    @InjectQueue(MEMORY_DECAY_QUEUE)
    private readonly queue?: Queue,
    @Optional()
    private readonly settingsResolver?: MemoryDecaySettingsResolver,
  ) {}

  /**
   * Register the repeatable BullMQ job. Delegates the actual
   * registration to {@link registerMemoryDecayRepeatableJob} so
   * this class stays a thin orchestrator.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.scheduleDecayJob();
  }

  /**
   * Resolve the cron expression from
   * {@link SystemSettingsService} and register a repeatable
   * job on the memory-decay queue. The body of the
   * registration lives in {@link registerMemoryDecayRepeatableJob}
   * — this method exists so callers (the NestJS bootstrap hook
   * and existing tests) keep seeing the same public surface.
   */
  async scheduleDecayJob(): Promise<void> {
    await registerMemoryDecayRepeatableJob({
      queue: this.queue,
      settings: this.settings,
      logger: this.logger,
    });
  }

  /**
   * Run a single decay pass. The method is idempotent: re-running
   * it on a database state that has not changed produces the same
   * result. Concurrent invocations are safe — the candidate query
   * selects rows to be evaluated and the per-row update is atomic
   * at the SQL level; the reaper does not rely on cross-row
   * ordering.
   *
   * The `memoryDecayLastRun` snapshot timestamp is updated on
   * every pass — including pass-throughs (kill switch, empty
   * candidate set) — so the snapshot always reflects "the reaper
   * was awake". This mirrors the documented behaviour of the
   * `memory_decay_enabled` setting ("the last-run timestamp is
   * still updated so the snapshot reflects 'the reaper was
   * awake'").
   */
  async runDecayPass(
    options: import('./memory-decay.types').MemoryDecayRunOptions = {},
  ): Promise<import('./memory-decay.types').MemoryDecayRunSummary> {
    const now = options.now ?? new Date();

    const resolved = await this.resolveSettings();
    this.memoryMetrics.setMemoryDecayLastRun(now);

    if (!resolved.enabled) {
      this.logger.log(
        `MemoryDecayReaper kill switch (${MEMORY_DECAY_SETTING_KEYS.enabled}) is off; skipping pass (no rows evaluated)`,
      );
      return {
        evaluated: 0,
        decayed: 0,
        archived: 0,
        skipped: true,
        reason: 'disabled',
      };
    }

    this.logger.log(
      `MemoryDecayReaper starting: graceDays=${resolved.graceDays.toString()}, dailyRate=${resolved.dailyRate.toString()}, floor=${resolved.floor.toString()}, exemptSources=[${[...MEMORY_DECAY_EXEMPT_SOURCES].join(',')}], now=${now.toISOString()}`,
    );

    const candidates = await findDecayCandidates(
      { decaySegments: this.decaySegments },
      resolved,
      now,
    );

    // VALUE PREDICATE (EPIC-212 Phase-3 Task 2/3): in `shadow`/`enforce`
    // the reaper computes the per-candidate usefulness verdict. In
    // `shadow` it only emits the divergence event (DB path byte-identical
    // to `legacy`); in `enforce` a `keep` verdict short-circuits archival.
    // `null` here means "behave as legacy" — either the mode IS legacy, or
    // the feedback service is unavailable / threw (fail-soft).
    const usefulnessForPredicate = await resolveUsefulnessForPredicate(
      { feedback: this.feedback, logger: this.logger },
      candidates,
      resolved,
      now,
    );

    const aggregates = await runCandidateLoop(
      {
        decaySegments: this.decaySegments,
        memorySegments: this.memorySegments,
        feedback: this.feedback,
        eventLedger: this.eventLedger,
        logger: this.logger,
      },
      candidates,
      resolved,
      usefulnessForPredicate,
      {
        usefulnessThreshold: resolved.usefulnessThreshold,
        minSamples: resolved.usefulnessMinSamples,
      },
      now,
    );

    this.metrics.recordMemoryDecayRun(
      aggregates.evaluated,
      aggregates.archived,
    );

    this.logger.log(
      `MemoryDecayReaper finished: evaluated=${aggregates.evaluated.toString()}, decayed=${aggregates.decayed.toString()}, archived=${aggregates.archived.toString()}`,
    );

    if (
      usefulnessForPredicate !== null &&
      aggregates.shadowCandidates.length > 0
    ) {
      await emitDecayShadow(
        { eventLedger: this.eventLedger, logger: this.logger },
        aggregates.shadowCandidates,
        resolved.valuePredicateMode,
        now,
      );
    }

    return {
      evaluated: aggregates.evaluated,
      decayed: aggregates.decayed,
      archived: aggregates.archived,
      skipped: false,
    };
  }

  /**
   * Resolve the live decay settings from
   * {@link SystemSettingsService}. Delegates to
   * {@link resolveDecaySettings} so this method stays a thin
   * pass-through — the priority chain (recorder-calibrated >
   * operator SystemSetting > hardcoded default) lives in
   * `memory-decay.settings.helpers.ts`.
   */
  private async resolveSettings(): Promise<MemoryDecaySettings> {
    return resolveDecaySettings({
      settings: this.settings,
      settingsResolver: this.settingsResolver,
    });
  }
}
