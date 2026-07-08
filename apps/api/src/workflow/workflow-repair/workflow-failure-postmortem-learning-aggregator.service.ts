/**
 * `WorkflowPostmortemRecurrenceSignalService` — recurrence-count gate signal
 * (originally milestone 3 of work item 5743ac93-456d-41b3-ae5b-0ca2554318da).
 *
 * After the {@link WorkflowFailurePostmortemListener} writes a postmortem
 * `memory_segments` row on `WORKFLOW_RUN_FAILED_EVENT`, this service counts
 * matching postmortems by `(scope_id, failure_class)` over a sliding window and
 * reports whether the configured occurrence threshold has been crossed.
 *
 * EPIC-212 Phase 2 (Task 12) retired the templated learning-candidate emitter
 * that used to fire here — the retrospective analyst (`WorkflowRetrospectiveModule`)
 * now mines recurring failures into real, evidence-cited root-cause+fix
 * memories. What remains is the **recurrence count read**: it is preserved as a
 * deterministic Phase-2 gate signal (the postmortem `memory_segments` write and
 * this recurrence count together form the failure signal the analyst gate
 * consumes), and it is logged when the threshold is crossed so the recurrence
 * stays observable in the event/log stream.
 *
 * Design notes:
 *   - Invoked from the postmortem listener's success path with the just-written
 *     `(scope_id, failure_class)`. The listener NEVER blocks on it; the public
 *     method catches all errors and returns a discriminated result so the
 *     listener's recorded-event / metrics surface cannot be crashed by a
 *     transient settings-read or DB-count failure.
 *   - The threshold is enforced on the postmortem segment count (NOT the count
 *     of distinct runs); a single repeated run id (deduped on write) never
 *     inflates it. The dedup is owned by the listener — this service sees only
 *     segments that survived it.
 *   - Settings are read fresh on every call (no construction-time caching), the
 *     same pattern as `MemoryDecayReaperService.resolveSettings`, so operators
 *     can tune the threshold between events without restarting the app.
 *   - The service is `@Injectable()` and registered in
 *     `WorkflowRepairModule.providers` so the listener can inject it directly.
 */
import { Injectable, Logger } from '@nestjs/common';
import { MemorySegmentPostmortemRepository } from '../../memory/database/repositories/memory-segment.postmortem.repository';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  WORKFLOW_POSTMORTEM_DEFAULT_OCCURRENCE_THRESHOLD,
  WORKFLOW_POSTMORTEM_DEFAULT_OCCURRENCE_WINDOW_DAYS,
  WORKFLOW_POSTMORTEM_SETTING_KEYS,
} from './workflow-failure-postmortem.constants';
import type {
  PostmortemRecurrenceInput,
  PostmortemRecurrenceResult,
} from './workflow-failure-postmortem-learning-aggregator.types';

export type {
  PostmortemRecurrenceInput,
  PostmortemRecurrenceResult,
} from './workflow-failure-postmortem-learning-aggregator.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class WorkflowPostmortemLearningAggregatorService {
  private readonly logger = new Logger(
    WorkflowPostmortemLearningAggregatorService.name,
  );

  constructor(
    private readonly memorySegmentRepo: MemorySegmentPostmortemRepository,
    private readonly settings: SystemSettingsService,
  ) {}

  /**
   * Read the postmortem recurrence count for a `(scope_id, failure_class)` pair
   * over the trailing window and report whether the occurrence threshold has
   * been crossed. Never throws — all errors are caught and logged at warn so
   * the caller (the postmortem listener) can remain on its success path without
   * surfacing a transient settings / DB blip.
   *
   * The recurrence count is ALWAYS read: it is the deterministic Phase-2 gate
   * signal that survived the retirement of the templated learning-candidate
   * emitter (Task 12). When the threshold is crossed the recurrence is logged
   * so it stays observable; no learning candidate is proposed here.
   */
  async recordPostmortemRecurrence(
    input: PostmortemRecurrenceInput,
  ): Promise<PostmortemRecurrenceResult> {
    try {
      const { threshold, windowDays } = await this.resolveThresholds();
      const since = new Date(
        input.triggeredAt.getTime() - windowDays * MS_PER_DAY,
      );
      const sinceIso = since.toISOString();

      const count = await this.memorySegmentRepo.countPostmortemsByFailureClass(
        'project',
        input.scopeId,
        input.failureClass,
        sinceIso,
      );

      if (count < threshold) {
        return {
          thresholdCrossed: false,
          reason: 'below-threshold',
          count,
          threshold,
          windowDays,
        };
      }

      this.logger.log(
        `WorkflowPostmortemRecurrence threshold crossed for scope ${input.scopeId} / ${input.failureClass}: ${count.toString()} occurrence(s) in ${windowDays.toString()} day(s) (threshold ${threshold.toString()}). Recorded as a retrospective gate signal.`,
      );

      return { thresholdCrossed: true, count, threshold, windowDays };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `WorkflowPostmortemLearningAggregatorService swallowed error for scope ${input.scopeId}/${input.failureClass}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { thresholdCrossed: false, reason: 'recurrence-error' };
    }
  }

  /**
   * Read the live occurrence threshold and window from
   * {@link SystemSettingsService} with hardcoded fallbacks. Mirrors
   * `MemoryDecayReaperService.resolveSettings` — the values are
   * coerced to safe positive integers so a malformed setting cannot
   * silently zero out the threshold or invert the window.
   */
  private async resolveThresholds(): Promise<{
    threshold: number;
    windowDays: number;
  }> {
    const rawThreshold = await this.settings.get<unknown>(
      WORKFLOW_POSTMORTEM_SETTING_KEYS.occurrenceThreshold,
      WORKFLOW_POSTMORTEM_DEFAULT_OCCURRENCE_THRESHOLD,
    );
    const threshold = coercePositiveInteger(
      rawThreshold,
      WORKFLOW_POSTMORTEM_DEFAULT_OCCURRENCE_THRESHOLD,
    );

    const rawWindowDays = await this.settings.get<unknown>(
      WORKFLOW_POSTMORTEM_SETTING_KEYS.occurrenceWindowDays,
      WORKFLOW_POSTMORTEM_DEFAULT_OCCURRENCE_WINDOW_DAYS,
    );
    const windowDays = coercePositiveInteger(
      rawWindowDays,
      WORKFLOW_POSTMORTEM_DEFAULT_OCCURRENCE_WINDOW_DAYS,
    );

    return { threshold, windowDays };
  }
}

/**
 * Coerce a stored setting into a positive integer. Mirrors
 * `coerceGraceDays` in `memory-decay.reaper.ts` — any missing,
 * non-numeric, fractional, or non-positive value falls back to the
 * hardcoded default. A threshold of `0` would silently disable the
 * aggregator (every count >= 0) so we floor at `1` for safety.
 */
export function coercePositiveInteger(
  value: unknown,
  fallback: number,
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }
  return Math.floor(numeric);
}
