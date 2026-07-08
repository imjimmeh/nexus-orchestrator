import { Injectable, Logger, Optional } from '@nestjs/common';
import { MemorySegmentLearningCandidateRepository } from '../database/repositories/memory-segment.learning-candidate.repository';
import { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import type { MemorySegment } from '../database/entities/memory-segment.entity';
import { MemorySegmentFeedbackService } from '../memory-segment-feedback.service';
import { MemoryMetricsService } from '../memory-metrics.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { decideProbation } from './memory-probation.decide';
import type { ProbationVerdict } from './memory-probation.decide.types';
import type { ProbationOutcomeCounts } from '../memory-metrics.types';
import {
  MEMORY_PROBATION_AUTO_REVERT_ENABLED_DEFAULT,
  MEMORY_PROBATION_AUTO_REVERT_ENABLED_SETTING,
  MEMORY_PROBATION_EVALUATOR_ENABLED_DEFAULT,
  MEMORY_PROBATION_EVALUATOR_ENABLED_SETTING,
  MEMORY_PROBATION_MIN_SAMPLES_DEFAULT,
  MEMORY_PROBATION_MIN_SAMPLES_SETTING,
  MEMORY_PROBATION_USEFULNESS_THRESHOLD_DEFAULT,
  MEMORY_PROBATION_USEFULNESS_THRESHOLD_SETTING,
  coerceMemoryProbationAutoRevertEnabled,
  coerceMemoryProbationEvaluatorEnabled,
  coerceMemoryProbationMinSamples,
  coerceMemoryProbationUsefulnessThreshold,
} from '../../settings/memory-probation.settings.constants';

/** The settled `governance_state` a confirmed segment carries. */
const CONFIRMED_STATE = 'confirmed';

/** Per-segment usefulness vote shape from the feedback batch. */
interface SegmentUsefulnessVote {
  usefulness: number | null;
  sampleSize: number;
}

/** Resolved, flag-gated configuration for a single probation pass. */
interface ProbationConfig {
  autoRevertEnabled: boolean;
  usefulnessThreshold: number;
  minSamples: number;
}

const EMPTY_OUTCOME: ProbationOutcomeCounts = {
  confirmed: 0,
  reverted: 0,
  held: 0,
};

/**
 * Provisional-memory probation evaluator (EPIC-212 Phase-3 Task 7).
 *
 * Past a segment's `probation_until`, confirms good provisional
 * auto-promotions (`governance_state = 'confirmed'`) or reverts bad ones
 * (archive-only — NEVER hard-delete, so a wrong revert is recoverable). Runs
 * as a pass inside `MemoryMetricsRefreshService` under the same kill-switch +
 * fail-soft envelope as the gauge refresh.
 *
 * Safety + gating:
 *   - `memory_probation_evaluator_enabled` (default false) — when off, the
 *     pass is a no-op BEFORE any DB query (zero overhead).
 *   - The `confirm` action (no data loss) runs whenever the evaluator is on.
 *   - The `revert` action is additionally gated by
 *     `memory_probation_auto_revert_enabled` (default false). When the
 *     evaluator is on but auto-revert is off, would-revert rows run in SHADOW
 *     MODE — a `memory.probation.shadow.v1` event lists their ids WITHOUT
 *     archiving.
 *
 * All external dependencies are `@Optional()` and fail-soft: a dep down (or a
 * settings read failure) degrades the pass to evaluator-disabled / hold so a
 * probation failure never breaks the surrounding refresh tick.
 *
 * Carry-forward: there is no persisted per-segment "injected & helped" signal
 * yet (Phase-3 Task-6), so `injectedAndHelped` is passed `false`; the
 * usefulness path still drives confirm.
 */
@Injectable()
export class MemoryProbationEvaluatorService {
  private readonly logger = new Logger(MemoryProbationEvaluatorService.name);

  constructor(
    private readonly learningCandidateSegments: MemorySegmentLearningCandidateRepository,
    private readonly memorySegments: MemorySegmentCrudRepository,
    private readonly settings: SystemSettingsService,
    @Optional() private readonly feedback?: MemorySegmentFeedbackService,
    @Optional() private readonly memoryMetrics?: MemoryMetricsService,
    @Optional() private readonly eventLedger?: EventLedgerService,
  ) {}

  /**
   * Run a single probation pass. Returns the applied
   * {@link ProbationOutcomeCounts} (also recorded on
   * {@link MemoryMetricsService}). `held` includes shadow would-reverts that
   * were NOT archived (auto-revert off).
   */
  async runProbationPass(
    now: Date = new Date(),
  ): Promise<ProbationOutcomeCounts> {
    if (!(await this.readEvaluatorEnabled())) {
      return EMPTY_OUTCOME;
    }

    const config = await this.resolveConfig();
    const segments =
      await this.learningCandidateSegments.findProvisionalPastProbation(now);
    if (segments.length === 0) {
      this.recordOutcome(EMPTY_OUTCOME);
      return EMPTY_OUTCOME;
    }

    const usefulnessById = await this.resolveUsefulness(segments, now);
    const shadowReverts: string[] = [];
    const counts: ProbationOutcomeCounts = {
      confirmed: 0,
      reverted: 0,
      held: 0,
    };

    for (const segment of segments) {
      const verdict = decideProbation(
        this.buildInput(segment, usefulnessById),
        {
          confirmThreshold: config.usefulnessThreshold,
          minSamples: config.minSamples,
        },
        now.getTime(),
      );
      const applied = await this.applyVerdict(
        segment,
        verdict,
        config,
        shadowReverts,
        now,
      );
      counts[applied] += 1;
    }

    if (shadowReverts.length > 0) {
      await this.emitShadow(shadowReverts, now);
    }
    this.recordOutcome(counts);
    return counts;
  }

  /**
   * Apply a verdict under the flags. Returns the ACTUAL applied outcome so
   * the counters stay honest: a shadow would-revert (auto-revert off) and a
   * failed DB write both count as `held`, not `reverted`.
   */
  private async applyVerdict(
    segment: MemorySegment,
    verdict: ProbationVerdict,
    config: ProbationConfig,
    shadowReverts: string[],
    now: Date,
  ): Promise<keyof ProbationOutcomeCounts> {
    if (verdict.action === 'confirm') {
      return (await this.confirmSegment(segment)) ? 'confirmed' : 'held';
    }
    if (verdict.action === 'revert') {
      if (!config.autoRevertEnabled) {
        // SHADOW MODE: list the would-revert id, archive nothing.
        shadowReverts.push(segment.id);
        return 'held';
      }
      return (await this.revertSegment(segment, now)) ? 'reverted' : 'held';
    }
    return 'held';
  }

  /** Flip `governance_state` to `confirmed`. Fail-soft (logs, returns false). */
  private async confirmSegment(segment: MemorySegment): Promise<boolean> {
    try {
      await this.memorySegments.update(segment.id, {
        governance_state: CONFIRMED_STATE,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to confirm provisional segment ${segment.id}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Archive a bad auto-promotion (sets `archived_at` — NEVER hard-deletes, so
   * a wrong revert is recoverable). Fail-soft (logs, returns false).
   */
  private async revertSegment(
    segment: MemorySegment,
    now: Date,
  ): Promise<boolean> {
    try {
      await this.memorySegments.update(segment.id, { archived_at: now });
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to revert (archive) provisional segment ${segment.id}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /** Build the pure decision input from a loaded segment + its vote tally. */
  private buildInput(
    segment: MemorySegment,
    usefulnessById: Map<string, SegmentUsefulnessVote>,
  ) {
    const vote = usefulnessById.get(segment.id) ?? {
      usefulness: null,
      sampleSize: 0,
    };
    return {
      segmentId: segment.id,
      usefulness: vote.usefulness,
      sampleSize: vote.sampleSize,
      accessCount: segment.access_count,
      contradicted: segment.superseded_by !== null,
      drifted: segment.drift_detected_at !== null,
      // Carry-forward: no persisted per-segment "injected & helped" signal yet.
      injectedAndHelped: false,
      probationUntilMs: parseProbationUntil(segment.metadata_json),
    };
  }

  /**
   * Resolve the per-segment usefulness map. Fail-soft: a missing feedback
   * service or a thrown batch call degrades to an empty map (every row treated
   * as no-votes → confirm/low-usefulness verdicts cannot fire → the row holds
   * unless a hard revert signal is present), matching the "dep down → hold"
   * contract.
   */
  private async resolveUsefulness(
    segments: MemorySegment[],
    now: Date,
  ): Promise<Map<string, SegmentUsefulnessVote>> {
    if (!this.feedback) {
      return new Map();
    }
    try {
      return await this.feedback.computeUsefulnessForSegments(
        segments.map((segment) => segment.id),
        now,
      );
    } catch (error) {
      this.logger.warn(
        `MemoryProbationEvaluator failed to compute usefulness; degrading to no-votes for this pass: ${(error as Error).message}`,
      );
      return new Map();
    }
  }

  /** Record the applied outcome counts on the metrics snapshot (best-effort). */
  private recordOutcome(counts: ProbationOutcomeCounts): void {
    this.memoryMetrics?.recordProbationOutcome(counts);
  }

  /**
   * Emit the `memory.probation.shadow.v1` event listing the would-revert
   * segment ids (auto-revert off). Best-effort — a downstream EventLedger
   * outage never bubbles out of the pass.
   */
  private async emitShadow(segmentIds: string[], now: Date): Promise<void> {
    this.logger.log(
      `MemoryProbationEvaluator shadow: ${segmentIds.length.toString()} provisional segment(s) would revert (auto-revert off; nothing archived)`,
    );
    if (!this.eventLedger) {
      return;
    }
    try {
      await this.eventLedger.emitBestEffort({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.memoryProbationShadow,
        outcome: 'success',
        payload: {
          would_revert_segment_ids: segmentIds,
          count: segmentIds.length,
          observed_at: now.toISOString(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit ${AUTONOMY_EVENT_NAMES.memoryProbationShadow}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Read the master kill switch. Fail-soft: a settings read failure degrades
   * to evaluator-disabled (default-OFF) so a transient blip can never run the
   * pass with stale assumptions.
   */
  private async readEvaluatorEnabled(): Promise<boolean> {
    try {
      const raw = await this.settings.get<unknown>(
        MEMORY_PROBATION_EVALUATOR_ENABLED_SETTING,
        MEMORY_PROBATION_EVALUATOR_ENABLED_DEFAULT,
      );
      return coerceMemoryProbationEvaluatorEnabled(raw);
    } catch (error) {
      this.logger.warn(
        `Failed to read ${MEMORY_PROBATION_EVALUATOR_ENABLED_SETTING}; treating evaluator as disabled: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Resolve the live auto-revert flag + thresholds. Each read is coerced
   * non-throwingly; a total settings failure falls back to the safe defaults
   * (auto-revert off — shadow only).
   */
  private async resolveConfig(): Promise<ProbationConfig> {
    try {
      const [rawAutoRevert, rawThreshold, rawMinSamples] = await Promise.all([
        this.settings.get<unknown>(
          MEMORY_PROBATION_AUTO_REVERT_ENABLED_SETTING,
          MEMORY_PROBATION_AUTO_REVERT_ENABLED_DEFAULT,
        ),
        this.settings.get<unknown>(
          MEMORY_PROBATION_USEFULNESS_THRESHOLD_SETTING,
          MEMORY_PROBATION_USEFULNESS_THRESHOLD_DEFAULT,
        ),
        this.settings.get<unknown>(
          MEMORY_PROBATION_MIN_SAMPLES_SETTING,
          MEMORY_PROBATION_MIN_SAMPLES_DEFAULT,
        ),
      ]);
      return {
        autoRevertEnabled:
          coerceMemoryProbationAutoRevertEnabled(rawAutoRevert),
        usefulnessThreshold:
          coerceMemoryProbationUsefulnessThreshold(rawThreshold),
        minSamples: coerceMemoryProbationMinSamples(rawMinSamples),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to resolve probation config; using safe defaults (auto-revert off): ${(error as Error).message}`,
      );
      return {
        autoRevertEnabled: MEMORY_PROBATION_AUTO_REVERT_ENABLED_DEFAULT,
        usefulnessThreshold: MEMORY_PROBATION_USEFULNESS_THRESHOLD_DEFAULT,
        minSamples: MEMORY_PROBATION_MIN_SAMPLES_DEFAULT,
      };
    }
  }
}

/**
 * Parse `metadata_json.probation_until` (an ISO-8601 string written by
 * `PromotionGovernancePolicyService`) into epoch-ms, or `null` when missing /
 * unparseable. Pure helper.
 */
function parseProbationUntil(
  metadata: Record<string, unknown> | null,
): number | null {
  if (metadata == null) {
    return null;
  }
  const raw = metadata.probation_until;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
