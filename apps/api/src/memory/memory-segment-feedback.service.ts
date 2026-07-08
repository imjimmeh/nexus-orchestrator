import { Injectable, Logger, Optional } from '@nestjs/common';
import type { MemorySegmentFeedback } from './database/entities/memory-segment-feedback.entity';
import { MemorySegmentFeedbackRepository } from './database/repositories/memory-segment-feedback.repository';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import { SystemSettingsService } from '../settings/system-settings.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from '../observability/autonomy-observability.types';
import {
  MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT,
  MEMORY_FEEDBACK_WINDOW_DAYS_SETTING,
  coerceMemoryFeedbackWindowDays,
} from '../settings/memory-feedback-window-days.constants';
import type { RecordFeedbackInput } from './memory-segment-feedback.service.types';

export type { RecordFeedbackInput } from './memory-segment-feedback.service.types';

/**
 * Maximum length (in characters) accepted on the optional
 * `reason` field of {@link RecordFeedbackInput}.
 *
 * The repository column is `text` (no length cap at the
 * Postgres layer) and the downstream UI is expected to render
 * the rationale verbatim. 2_000 chars matches the
 * `agent_war_room_max_message_chars` (`4000`) ceiling halved
 * so a single feedback row's rationale fits comfortably inside
 * the larger surface. The cap is applied at the service layer
 * so the truncation happens BEFORE the row is persisted — a
 * caller-supplied rationale longer than the cap is silently
 * truncated with a single trailing ellipsis rather than
 * rejected with an exception (the rationale is optional, so a
 * 50_000-char essay is still a valid vote, just a verbose
 * one).
 */
const FEEDBACK_REASON_MAX_LENGTH = 2_000;

/**
 * Service layer for the explicit agent usefulness feedback
 * channel (work item
 * 66ea23d1-59f2-451b-a090-a292fad8f21b, milestone 2).
 *
 * Mirrors the project's
 * `controller-handles-transport / service-owns-domain /
 * repository-owns-persistence` quality gate: this service owns
 * the input-side normalisation (trim + cap on `reason`),
 * the post-write audit event emission, and the rolling-window
 * aggregation. Persistence is delegated to
 * {@link MemorySegmentFeedbackRepository}; segment-source
 * lookups for the audit payload go through
 * {@link MemorySegmentRepository}; the rolling-window length
 * is read from {@link SystemSettingsService}.
 *
 * Public surface (called from the milestone-3
 * `query_memory` internal tool handler, and from any future
 * programmatic feedback write site):
 *   - {@link recordFeedback} — persist one vote + emit one
 *     `memory.feedback.recorded.v1` event with the segment's
 *     `source` so downstream dashboards can group feedback by
 *     the source taxonomy that produced the segment.
 *   - {@link computeUsefulnessForSegment} — single-segment
 *     rolling-window usefulness ratio.
 *   - {@link computeUsefulnessForSegments} — batch variant of
 *     the same computation; uses one
 *     `GROUP BY segment_id` round trip via
 *     `MemorySegmentFeedbackRepository.findUsefulnessSince`.
 *
 * The audit event is emitted AFTER the row is persisted so a
 * crash before persist cannot leak a phantom event. Emission
 * is delegated to `EventLedgerService.emitBestEffort` so a
 * downstream EventLedger outage never bubbles out of the
 * feedback write — the feedback row is the source of truth
 * for the vote, and the event is the auditability side
 * channel.
 */
@Injectable()
export class MemorySegmentFeedbackService {
  private readonly logger = new Logger(MemorySegmentFeedbackService.name);

  constructor(
    private readonly feedbackRepository: MemorySegmentFeedbackRepository,
    private readonly segmentRepository: MemorySegmentCrudRepository,
    @Optional() private readonly settings?: SystemSettingsService,
    @Optional() private readonly eventLedger?: EventLedgerService,
  ) {}

  /**
   * Persist one explicit usefulness vote and emit the
   * matching `memory.feedback.recorded.v1` audit event.
   *
   * The repository handles the column-level persistence and
   * already trims an empty-string `reason` to `null`; this
   * method additionally:
   *
   *   - caps the optional `reason` to
   *     {@link FEEDBACK_REASON_MAX_LENGTH} characters with a
   *     trailing ellipsis when truncation happens, so a
   *     runaway caller cannot bloat the `text` column.
   *   - looks up the originating segment's `source` for the
   *     audit payload. The lookup is best-effort — a missing
   *     segment (deleted between retrieval and vote, archived
   *     by the decay reaper, etc.) surfaces as
   *     `source: null` on the event payload rather than
   *     failing the feedback write. The `reason` truncation
   *     and the segment lookup are the two non-persistence
   *     responsibilities of the service; both are documented
   *     in the unit-test spec for this file (added by
   *     milestone 4).
   *
   * @returns the persisted {@link MemorySegmentFeedback}
   *   entity, including the server-assigned `id` and
   *   `created_at`. The caller (the `query_memory` tool
   *   handler in milestone 3) uses the `id` to ack the
   *   vote in its result payload.
   */
  async recordFeedback(
    input: RecordFeedbackInput,
  ): Promise<MemorySegmentFeedback> {
    const persisted = await this.feedbackRepository.createAndSave({
      segment_id: input.segmentId,
      query_id: input.queryId,
      agent_profile_id: input.agentProfileId,
      workflow_run_id: input.workflowRunId,
      useful: input.useful,
      reason: normaliseReason(input.reason),
    });

    const source = await this.resolveSegmentSource(input.segmentId);
    await this.emitFeedbackRecorded({
      segmentId: input.segmentId,
      useful: input.useful,
      source,
      agentProfile: input.agentProfileId,
    });

    return persisted;
  }

  /**
   * Compute the rolling-window usefulness ratio for a single
   * segment.
   *
   *   usefulness = count_useful / count_total
   *
   * computed over the `memory_feedback_window_days` SystemSetting
   * (default {@link MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT}). The
   * `now` parameter is optional and defaults to `new Date()`;
   * tests pass an explicit clock to keep the rolling window
   * deterministic.
   *
   * The result is `{ usefulness, sampleSize }`:
   *   - `usefulness` is `null` when `sampleSize === 0` (no
   *     feedback in the window). This is the backfill-safe
   *     shape: a fresh deployment with zero feedback rows
   *     surfaces as `usefulness: null`, NOT `usefulness: 0`,
   *     so downstream dashboards can distinguish "the agent
   *     has not voted on this segment yet" from "every vote
   *     so far was not-useful".
   *   - `sampleSize` is the total vote count in the window
   *     (sum of useful + not-useful).
   *
   * Implementation: two count queries against the composite
   * `(segment_id, created_at)` index added by the milestone-1
   * migration. Single-segment callers do NOT get the
   * `findUsefulnessSince` batch path — that optimisation is
   * reserved for the plural
   * {@link computeUsefulnessForSegments} surface.
   */
  async computeUsefulnessForSegment(
    segmentId: string,
    now: Date = new Date(),
  ): Promise<{ usefulness: number | null; sampleSize: number }> {
    const windowStart = await this.resolveWindowStart(now);
    const [usefulCount, totalCount] = await Promise.all([
      this.feedbackRepository.countUsefulSince(segmentId, windowStart),
      this.feedbackRepository.countTotalSince(segmentId, windowStart),
    ]);

    if (totalCount === 0) {
      return { usefulness: null, sampleSize: 0 };
    }

    return {
      usefulness: usefulCount / totalCount,
      sampleSize: totalCount,
    };
  }

  /**
   * Batch variant of {@link computeUsefulnessForSegment}.
   * Uses
   * {@link MemorySegmentFeedbackRepository.findUsefulnessSince}
   * for a single `GROUP BY segment_id` round trip regardless
   * of `segmentIds.length`.
   *
   * The returned `Map` is keyed by `segmentId`. Segments
   * that received zero feedback in the window are NOT
   * included in the underlying query result, so the caller
   * is expected to default those entries to
   * `{ usefulness: null, sampleSize: 0 }` — this matches the
   * backfill-safe shape of the single-segment method.
   *
   * An empty `segmentIds` array short-circuits to an empty
   * `Map` (the repository returns `[]` for an empty IN list
   * and we never want to issue a window-bound query with no
   * targets).
   */
  async computeUsefulnessForSegments(
    segmentIds: string[],
    now: Date = new Date(),
  ): Promise<Map<string, { usefulness: number | null; sampleSize: number }>> {
    const result = new Map<
      string,
      { usefulness: number | null; sampleSize: number }
    >();

    if (segmentIds.length === 0) {
      return result;
    }

    const windowStart = await this.resolveWindowStart(now);
    const rows = await this.feedbackRepository.findUsefulnessSince(
      segmentIds,
      windowStart,
    );

    for (const segmentId of segmentIds) {
      result.set(segmentId, { usefulness: null, sampleSize: 0 });
    }
    for (const row of rows) {
      const sampleSize = row.total;
      if (sampleSize === 0) {
        result.set(row.segment_id, { usefulness: null, sampleSize: 0 });
        continue;
      }
      result.set(row.segment_id, {
        usefulness: row.useful / sampleSize,
        sampleSize,
      });
    }

    return result;
  }

  /**
   * Look up the originating segment's `source` for the audit
   * payload. Missing segments surface as `null` so the
   * feedback write succeeds even when the segment has been
   * deleted / archived between retrieval and vote. Errors
   * from the repository are also swallowed with a logged
   * warning so a transient DB blip never breaks the vote.
   */
  private async resolveSegmentSource(
    segmentId: string,
  ): Promise<string | null> {
    try {
      const segment = await this.segmentRepository.findById(segmentId);
      if (segment === null) {
        return null;
      }
      return segment.source;
    } catch (error) {
      this.logger.warn(
        `Failed to resolve segment ${segmentId} for memory.feedback.recorded.v1 payload: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Best-effort emit of the `memory.feedback.recorded.v1`
   * event. Delegates to
   * {@link EventLedgerService.emitBestEffort} which already
   * swallows failures internally — the surrounding
   * try/catch is a belt-and-suspenders in case a future
   * refactor swaps the underlying emitter for one that
   * rethrows. Mirrors the audit-emit style in
   * `DistillationThresholdService.emitSettingChanged`.
   */
  private async emitFeedbackRecorded(params: {
    segmentId: string;
    useful: boolean;
    source: string | null;
    agentProfile: string;
  }): Promise<void> {
    if (!this.eventLedger) {
      return;
    }
    try {
      await this.eventLedger.emitBestEffort({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.memoryFeedbackRecorded,
        outcome: 'success',
        payload: {
          segment_id: params.segmentId,
          useful: params.useful,
          source: params.source,
          agent_profile: params.agentProfile,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit memory.feedback.recorded.v1 event: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Resolve the rolling-window start timestamp.
   *
   * Reads the live `memory_feedback_window_days` SystemSetting
   * via {@link SystemSettingsService}, coerces it through
   * {@link coerceMemoryFeedbackWindowDays} so out-of-range /
   * non-numeric values fall back to the hardcoded default,
   * and computes `now - windowDays * 86_400_000` for the
   * window-start anchor.
   *
   * Falls back to {@link MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT}
   * when the settings service is not wired (e.g. a unit test
   * that constructs the service via
   * `new MemorySegmentFeedbackService()`) or when the read
   * itself throws (e.g. a transient DB blip). Both paths
   * match the resolve-settings pattern in
   * `MemoryMetricsService.resolveWindowDays`.
   */
  private async resolveWindowStart(now: Date): Promise<Date> {
    const windowDays = await this.resolveWindowDays();
    return new Date(now.getTime() - windowDays * 86_400_000);
  }

  private async resolveWindowDays(): Promise<number> {
    if (!this.settings) {
      return MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT;
    }
    try {
      const raw = await this.settings.get<unknown>(
        MEMORY_FEEDBACK_WINDOW_DAYS_SETTING,
        MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT,
      );
      return coerceMemoryFeedbackWindowDays(raw);
    } catch {
      return MEMORY_FEEDBACK_WINDOW_DAYS_DEFAULT;
    }
  }
}

/**
 * Normalise the optional `reason` field before persistence:
 *   - `null` / `undefined` → `null` (no rationale).
 *   - Whitespace-only string → `null` (mirrors the
 *     repository's empty-string-to-null rule, applied here so
 *     a long-string-of-spaces rationale also collapses).
 *   - Trims leading / trailing whitespace, then caps to
 *     {@link FEEDBACK_REASON_MAX_LENGTH} characters. A string
 *     that exceeds the cap is truncated with a trailing
 *     `'…'` ellipsis so the audit trail records that the
 *     caller supplied a longer rationale.
 *
 * The repository's trim-empty-to-null rule is preserved as a
 * defensive duplicate: even if a future refactor moves the
 * trim to this layer only, the repository will still
 * collapse the empty case.
 */
function normaliseReason(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length <= FEEDBACK_REASON_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, FEEDBACK_REASON_MAX_LENGTH - 1)}…`;
}
