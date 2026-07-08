import { Injectable, Logger, Optional } from '@nestjs/common';
import { SystemSettingsService } from '../settings/system-settings.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { MemorySegmentEvictionRepository } from './database/repositories/memory-segment.eviction.repository';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import type { MemorySegment } from './database/entities/memory-segment.entity';
import { MemorySegmentFeedbackService } from './memory-segment-feedback.service';
import { evaluateRetentionFromMap } from './memory-decay.value-predicate';
import type { DecayKeepThresholds } from './memory-decay.value-predicate.types';
import {
  MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS,
  MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT,
  MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES,
} from '../settings/learning-settings.constants';
import {
  EVICTION_VALUE_PREDICATE_ENABLED_DEFAULT,
  EVICTION_VALUE_PREDICATE_ENABLED_SETTING,
  MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_DEFAULT,
  MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_SETTING,
  MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT,
  MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
  coerceEvictionValuePredicateEnabled,
  coerceMemoryDecayUsefulnessMinSamples,
  coerceMemoryDecayUsefulnessThreshold,
} from '../settings/memory-decay-value.settings.constants';
import {
  DEFAULT_MAX_IDLE_DAYS,
  DEFAULT_MIN_ACCESS_COUNT,
  DEFAULT_PROTECTED_SOURCES,
  MEMORY_SEGMENT_EVICTED_EVENT,
} from './memory-eviction.constants';
import { coerceInteger } from '../settings/setting-coercers';
import type {
  MemoryEvictionRunOptions,
  MemoryEvictionRunSummary,
} from './memory-eviction.types';

export type {
  MemoryEvictionRunOptions,
  MemoryEvictionRunSummary,
} from './memory-eviction.types';

/**
 * Maximum number of protection values that the reaper will accept in the
 * `memory_segment_eviction_protected_sources` setting. The setting is a
 * free-form comma-separated string and we want a defensive upper bound
 * so a runaway operator value (e.g. a paste of a multi-thousand-line
 * allowlist) does not balloon the reaper's query plan or make the
 * repository's `NOT IN` clause unusable.
 */
const PROTECTED_SOURCES_MAX_LENGTH = 64;

/** One day expressed in milliseconds — the reaper's "idle" unit. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Reaper's per-row delete upper bound for one run. */
const DEFAULT_MAX_ROWS_PER_RUN = 1_000;

/**
 * Usage-based eviction reaper for the `memory_segments` table.
 *
 * The reaper is invoked on a cron schedule (see work item
 * bef49c3a-0c0f-4c85-b134-29d839c72bad) and runs a single pass that:
 *
 *   1. Resolves the active eviction settings from
 *      {@link SystemSettingsService} (no caching at construction —
 *      operators can change the values between ticks).
 *   2. Queries the `memory_segments` table for candidate rows:
 *        - not pinned,
 *        - not in the protected-source allowlist (defaults to
 *          `learning_candidate`),
 *        - `access_count` below the configured floor (default 1),
 *        - and either:
 *            - `last_accessed_at` is non-null and older than
 *              `now - max_idle_days`, OR
 *            - `last_accessed_at` is null and the row's `created_at`
 *              is older than the same cutoff (defensive: a null
 *              `last_accessed_at` is treated as "never touched" and
 *              is eligible for eviction once the row is old enough).
 *   3. For each candidate, deletes the row and emits a
 *      `memory.segment.evicted.v1` observability event carrying the
 *      `segmentId`, `source`, `lastAccessedAt`, `accessCount`, and
 *      `evictedAt` so downstream consumers (audit log, metrics,
 *      learning writeback) can reason about what was removed and why
 *      it was eligible.
 *   4. Returns a {@link MemoryEvictionRunSummary} so callers (and
 *      tests) can assert on the run outcome.
 *
 * Settings are resolved fresh on every `runOnce()` so the operator
 * can tune the values between ticks without restarting the
 * application. The reaper NEVER throws on a per-row failure — a
 * transient DB blip will lose the row's contribution to the run
 * but not the rest of the batch. The run summary's `errors` counter
 * surfaces the count.
 *
 * BullMQ wiring:
 *   The cron-driven scheduling is owned by the infra layer (a
 *   separate work item). `runOnce()` is the test-friendly seam: it
 *   is a pure method that can be invoked from a BullMQ processor,
 *   an admin trigger handler, or a unit test.
 *
 * TODO(memory-eviction-scheduler): wire `runOnce()` into a BullMQ
 *   repeatable job. The schedule expression should be sourced from
 *   the `memory_segment_eviction_cron` SystemSetting (default
 *   `0 3 * * *` — daily 03:00 UTC, see
 *   {@link DEFAULT_MEMORY_EVICTION_CRON} in
 *   `memory-eviction.constants.ts`). The reaper is the unit of
 *   work; the scheduler is the trigger. Until that wiring lands, the
 *   reaper can be invoked manually from a unit test, an admin
 *   endpoint, or a CLI command.
 */
@Injectable()
export class MemoryEvictionReaperService {
  private readonly logger = new Logger(MemoryEvictionReaperService.name);

  constructor(
    private readonly evictionSegments: MemorySegmentEvictionRepository,
    private readonly memorySegments: MemorySegmentCrudRepository,
    private readonly settings: SystemSettingsService,
    @Optional() private readonly eventLedger?: EventLedgerService,
    @Optional() private readonly feedback?: MemorySegmentFeedbackService,
  ) {}

  /**
   * Run a single eviction pass. The method is idempotent: re-running
   * it on a database state that has not changed produces the same
   * result. Concurrent invocations are safe — the candidate query
   * selects rows to be deleted and the per-row delete is atomic at
   * the SQL level; the reaper does not rely on cross-row ordering.
   */
  async runOnce(
    options: MemoryEvictionRunOptions = {},
  ): Promise<MemoryEvictionRunSummary> {
    const startedAtDate = options.now ?? new Date();
    const startedAt = startedAtDate.toISOString();
    const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS_PER_RUN;

    const resolved = await this.resolveSettings();
    const idleCutoff = new Date(
      startedAtDate.getTime() - resolved.maxIdleDays * MS_PER_DAY,
    );

    this.logger.log(
      `MemoryEvictionReaper starting: maxIdleDays=${resolved.maxIdleDays.toString()}, minAccessCount=${resolved.minAccessCount.toString()}, protectedSources=[${resolved.protectedSources.join(',')}], idleCutoff=${idleCutoff.toISOString()}`,
    );

    const candidates = await this.evictionSegments.findEvictionCandidates({
      protectedSources: resolved.protectedSources,
      minAccessCount: resolved.minAccessCount,
      idleCutoff,
    });
    const scanned = candidates.length;

    // VALUE PREDICATE (EPIC-212 Phase-3 Task 3): when
    // `eviction_value_predicate_enabled` is on, consult the SAME
    // shared retention predicate the decay reaper uses so a
    // high-usefulness / pinned / injected-and-helped row is never
    // evicted even when idle + low-access. Default-off → an empty set
    // → eviction byte-identical to the pre-Phase-3 behaviour.
    const retainedByValue = await this.resolveValueRetainedIds(
      candidates,
      startedAtDate,
    );

    let evicted = 0;
    let skipped = 0;
    let errors = 0;

    for (const candidate of candidates) {
      if (evicted + errors >= maxRows) {
        this.logger.warn(
          `MemoryEvictionReaper hit the per-run cap of ${maxRows.toString()} rows; deferring ${(scanned - evicted - errors).toString()} remaining candidate(s) to the next tick`,
        );
        break;
      }

      const outcome = await this.evictOne(candidate, retainedByValue);
      if (outcome === 'evicted') {
        evicted += 1;
      } else if (outcome === 'skipped') {
        skipped += 1;
      } else {
        errors += 1;
      }
    }

    const finishedAt = new Date().toISOString();
    const summary: MemoryEvictionRunSummary = {
      scanned,
      evicted,
      skipped,
      errors,
      startedAt,
      finishedAt,
      settings: resolved,
    };

    this.logger.log(
      `MemoryEvictionReaper finished: scanned=${scanned.toString()}, evicted=${evicted.toString()}, skipped=${skipped.toString()}, errors=${errors.toString()}`,
    );

    return summary;
  }

  /**
   * Delete a single candidate row and emit the eviction event. Returns
   * the per-row outcome so the caller can update the run summary.
   *
   * `skipped` is reserved for future hardening (e.g. a race where the
   * row was deleted by another path between the candidate scan and
   * the delete). Today the delete is a one-shot
   * `repository.delete(id)` and we do not re-read the row, so the
   * "skipped" branch is not reachable from the public surface — but
   * it is part of the return contract so callers do not have to be
   * updated when the race-handling lands.
   */
  private async evictOne(
    candidate: MemorySegment,
    retainedByValue: ReadonlySet<string>,
  ): Promise<'evicted' | 'skipped' | 'error'> {
    // Defensive: the repository's candidate query already filters
    // `pinned = false` out of the result set, but the reaper refuses
    // to delete a pinned row even if the contract is weakened. This
    // is a belt-and-suspenders check — the repository is the primary
    // defense, this is the second. The row is logged and skipped
    // without an event emission.
    if (candidate.pinned) {
      this.logger.warn(
        `MemoryEvictionReaper encountered a pinned segment ${candidate.id} in the candidate list; skipping (the repository should have filtered this out)`,
      );
      return 'skipped';
    }

    // VALUE PREDICATE keep (EPIC-212 Phase-3 Task 3): a row the shared
    // retention predicate kept (high usefulness / pinned /
    // injected-and-helped) is preserved, never evicted. The set is
    // empty when `eviction_value_predicate_enabled` is off, so this
    // branch is inert by default.
    if (retainedByValue.has(candidate.id)) {
      this.logger.debug(
        `MemoryEvictionReaper preserving segment ${candidate.id} — kept by the usefulness-aware retention predicate`,
      );
      return 'skipped';
    }

    const evictedAt = new Date();
    try {
      await this.memorySegments.remove(candidate.id);
    } catch (error) {
      this.logger.error(
        `MemoryEvictionReaper failed to delete segment ${candidate.id} (source=${candidate.source ?? 'null'}): ${(error as Error).message}`,
        (error as Error).stack,
      );
      return 'error';
    }

    await this.emitEvictedEventBestEffort({
      segmentId: candidate.id,
      source: candidate.source ?? null,
      lastAccessedAt: candidate.last_accessed_at,
      accessCount: candidate.access_count,
      evictedAt,
    });

    return 'evicted';
  }

  /**
   * Best-effort emit of the `memory.segment.evicted.v1` observability
   * event. The delete has already happened by the time this is called;
   * a failure to emit is logged but does not roll back the delete.
   * Audit consumers will see a missing event for the segment, which
   * is preferable to a half-deleted state.
   */
  private async emitEvictedEventBestEffort(params: {
    segmentId: string;
    source: string | null;
    lastAccessedAt: Date | null;
    accessCount: number;
    evictedAt: Date;
  }): Promise<void> {
    if (!this.eventLedger) {
      return;
    }
    try {
      await this.eventLedger.emitBestEffort({
        domain: 'memory',
        eventName: MEMORY_SEGMENT_EVICTED_EVENT,
        outcome: 'success',
        payload: {
          segmentId: params.segmentId,
          source: params.source,
          lastAccessedAt: params.lastAccessedAt?.toISOString() ?? null,
          accessCount: params.accessCount,
          evictedAt: params.evictedAt.toISOString(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit ${MEMORY_SEGMENT_EVICTED_EVENT} for segment ${params.segmentId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Resolve the set of candidate ids the usefulness-aware retention
   * predicate keeps (and the reaper must therefore NOT evict).
   *
   * Returns an EMPTY set — i.e. "evict exactly as today" — when:
   *   - `eviction_value_predicate_enabled` is off (the default), or
   *   - the {@link MemorySegmentFeedbackService} is not wired
   *     (`@Optional()` dependency absent), or
   *   - the candidate set is empty, or
   *   - the batch usefulness call throws (fail-soft: a transient DB
   *     blip must never change which rows are evicted).
   *
   * When enabled, batches one
   * `computeUsefulnessForSegments(candidateIds, now)` call and runs
   * the SHARED {@link evaluateRetentionFromMap} predicate per
   * candidate, mirroring the decay reaper's `enforce` path.
   */
  private async resolveValueRetainedIds(
    candidates: MemorySegment[],
    now: Date,
  ): Promise<ReadonlySet<string>> {
    const empty: ReadonlySet<string> = new Set<string>();

    const rawEnabled = await this.settings.get<unknown>(
      EVICTION_VALUE_PREDICATE_ENABLED_SETTING,
      EVICTION_VALUE_PREDICATE_ENABLED_DEFAULT,
    );
    if (!coerceEvictionValuePredicateEnabled(rawEnabled)) {
      return empty;
    }
    if (!this.feedback || candidates.length === 0) {
      return empty;
    }

    const thresholds = await this.resolveRetentionThresholds();

    try {
      const usefulness = await this.feedback.computeUsefulnessForSegments(
        candidates.map((candidate) => candidate.id),
        now,
      );
      const retained = new Set<string>();
      for (const candidate of candidates) {
        const verdict = evaluateRetentionFromMap(
          candidate,
          usefulness,
          thresholds,
        );
        if (verdict.keep) {
          retained.add(candidate.id);
        }
      }
      return retained;
    } catch (error) {
      this.logger.warn(
        `MemoryEvictionReaper failed to compute usefulness for the value-predicate keep set; degrading to evict-as-today for this pass: ${(error as Error).message}`,
      );
      return empty;
    }
  }

  /**
   * Resolve the shared usefulness keep thresholds. Reuses the
   * Task-2 `memory_decay_usefulness_threshold` /
   * `memory_decay_usefulness_min_samples` keys — the eviction reaper
   * deliberately does NOT introduce duplicate threshold settings.
   */
  private async resolveRetentionThresholds(): Promise<DecayKeepThresholds> {
    const rawThreshold = await this.settings.get<unknown>(
      MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
      MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT,
    );
    const rawMinSamples = await this.settings.get<unknown>(
      MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_SETTING,
      MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_DEFAULT,
    );
    return {
      usefulnessThreshold: coerceMemoryDecayUsefulnessThreshold(rawThreshold),
      minSamples: coerceMemoryDecayUsefulnessMinSamples(rawMinSamples),
    };
  }

  /**
   * Resolve the live eviction settings from
   * {@link SystemSettingsService}. Reads happen fresh on every call —
   * never cached at construction — so an operator can tighten or
   * loosen the values between ticks without restarting the app.
   *
   * Each setting is coerced into a sane runtime value:
   *   - `maxIdleDays`: coerced to a positive integer; falls back to
   *     the hardcoded default when the stored value is missing,
   *     non-numeric, or non-positive.
   *   - `minAccessCount`: coerced to a non-negative integer; falls
   *     back to the hardcoded default when the stored value is
   *     missing or non-numeric. A value of 0 disables the
   *     access-count protection and relies solely on the idle cutoff.
   *   - `protectedSources`: coerced to a deduplicated
   *     comma-separated list. When the stored value is missing or
   *     resolves to the empty list, the hardcoded default
   *     (`learning_candidate`) is applied — the reaper refuses to
   *     run with an empty allowlist so a disaster-recovery seed
   *     cannot silently delete learning-candidate memory.
   */
  private async resolveSettings(): Promise<{
    maxIdleDays: number;
    minAccessCount: number;
    protectedSources: readonly string[];
  }> {
    const rawMaxIdleDays = await this.settings.get<unknown>(
      MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS,
      DEFAULT_MAX_IDLE_DAYS,
    );
    // coerceMaxIdleDays: parses the max-idle-days override; falls
    // back to DEFAULT_MAX_IDLE_DAYS for any missing / non-numeric
    // / non-positive value.
    const maxIdleDays = coerceInteger(rawMaxIdleDays, DEFAULT_MAX_IDLE_DAYS, {
      min: 1,
    });

    const rawMinAccessCount = await this.settings.get<unknown>(
      MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT,
      DEFAULT_MIN_ACCESS_COUNT,
    );
    // coerceMinAccessCount: parses the min-access-count override;
    // falls back to DEFAULT_MIN_ACCESS_COUNT for any non-numeric or
    // negative value. A value of 0 disables the access-count
    // protection (the reaper relies solely on the idle cutoff).
    const minAccessCount = coerceInteger(
      rawMinAccessCount,
      DEFAULT_MIN_ACCESS_COUNT,
      { min: 0 },
    );

    const rawProtectedSources = await this.settings.get<unknown>(
      MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES,
      DEFAULT_PROTECTED_SOURCES.join(','),
    );
    const protectedSources = coerceProtectedSources(rawProtectedSources);

    return {
      maxIdleDays,
      minAccessCount,
      protectedSources,
    };
  }
}

/**
 * Coerce the `memory_segment_eviction_protected_sources` setting into
 * a deduplicated list of non-empty source strings. Accepts either a
 * comma-separated string (the documented storage shape) or an
 * already-parsed string array (handy for tests and for callers that
 * persist the value as JSONB). Falls back to the hardcoded default
 * allowlist when the stored value resolves to the empty list so the
 * reaper is never allowed to run with an unprotected candidate set.
 */
export function coerceProtectedSources(
  value: unknown,
  fallback: readonly string[] = DEFAULT_PROTECTED_SOURCES,
): readonly string[] {
  const raw = parseProtectedSourcesValue(value);
  if (raw.length === 0) {
    return fallback;
  }
  // Deduplicate while preserving first-seen order, then cap the
  // length to PROTECTED_SOURCES_MAX_LENGTH to keep the SQL plan in
  // the repository bounded.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= PROTECTED_SOURCES_MAX_LENGTH) {
      break;
    }
  }
  if (out.length === 0) {
    return fallback;
  }
  return out;
}

function parseProtectedSourcesValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    return value.split(',');
  }
  return [];
}
