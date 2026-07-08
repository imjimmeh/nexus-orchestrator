/**
 * Pure helpers that own the per-row and per-pass execution
 * logic of `MemoryDecayReaperService.runDecayPass()`.
 *
 * Extracted out of `memory-decay.reaper.ts` so the
 * `MemoryDecayReaperService` stays under the project's
 * `max-lines` lint cap and so the per-row contract has a
 * dedicated, unit-testable seam. The behaviour of every helper
 * is byte-identical to the inline implementation it replaced —
 * `MemoryDecayReaperService` now delegates to these helpers
 * with `this`-derived dependencies, and the public
 * `runDecayPass(options)` method signature / return value are
 * preserved.
 */
import type { MemorySegment } from './database/entities/memory-segment.entity';
import { AUTONOMY_EVENT_NAMES } from '../observability/autonomy-observability.types';
import {
  buildShadowCandidate,
  computeDecayShadowComparison,
  evaluateRetentionFromMap,
} from './memory-decay.value-predicate';
import type {
  DecayKeepVerdict,
  DecayShadowCandidate,
  DecayValuePredicateMode,
  SegmentUsefulness,
} from './memory-decay.value-predicate.types';
import {
  MS_PER_DAY,
  classifyDecay,
  type DecayClassification,
} from './memory-decay.classify';
import { MEMORY_DECAY_EXEMPT_SOURCES } from './memory-decay.constants';
import type { MemoryDecaySettings } from './memory-decay.types';
import type {
  MemoryDecayRunAggregates,
  MemoryDecayRunOrchestratorDeps,
  RowOutcome,
} from './memory-decay.run-orchestrator.types';

/**
 * Resolve the per-candidate usefulness map used by the shadow
 * comparison, or `null` to signal "behave exactly as legacy".
 *
 * Returns `null` when:
 *   - `decay_value_predicate_mode` is `legacy` (zero overhead — no
 *     batch query, no shadow emit), or
 *   - the {@link MemorySegmentFeedbackService} is not wired
 *     (`@Optional()` dependency absent), or
 *   - the batch usefulness call throws (a transient DB blip must
 *     never change the reaper's mutation behaviour — it degrades to
 *     legacy for this pass).
 *
 * Returns an empty `Map` for an empty candidate set so the caller
 * skips the shadow emit without a special case.
 */
export async function resolveUsefulnessForPredicate(
  deps: Pick<MemoryDecayRunOrchestratorDeps, 'feedback' | 'logger'>,
  candidates: MemorySegment[],
  settings: MemoryDecaySettings,
  now: Date,
): Promise<Map<string, SegmentUsefulness> | null> {
  const { feedback, logger } = deps;
  if (settings.valuePredicateMode === 'legacy') {
    return null;
  }
  if (!feedback) {
    logger.debug(
      `MemoryDecayReaper value predicate mode is '${settings.valuePredicateMode}' but MemorySegmentFeedbackService is not wired; degrading to legacy (no shadow emit)`,
    );
    return null;
  }
  if (candidates.length === 0) {
    return new Map<string, SegmentUsefulness>();
  }
  try {
    return await feedback.computeUsefulnessForSegments(
      candidates.map((candidate) => candidate.id),
      now,
    );
  } catch (error) {
    logger.warn(
      `MemoryDecayReaper failed to compute usefulness for the shadow comparison; degrading to legacy for this pass: ${(error as Error).message}`,
    );
    return null;
  }
}

/**
 * Apply a {@link classifyDecay} verdict to the database. The pure
 * classification (which rows would decay / archive / skip under the
 * legacy confidence-floor rules) is computed by the free
 * {@link classifyDecay} function; this helper owns the I/O and the
 * `enforce`-mode short-circuit:
 *
 *   - `skipped` classifications (exempt source, null touch,
 *     in-grace, no confidence) are a no-op.
 *   - `archived` classifications set `archived_at` — UNLESS
 *     `enforceKeep` is `true` (`decay_value_predicate_mode=enforce`
 *     AND the value predicate kept the row), in which case the row
 *     is preserved untouched and the helper returns `'skipped'`. In
 *     `legacy`/`shadow` modes `enforceKeep` is always `false`, so
 *     archival proceeds byte-identically to today.
 *   - `decayed` classifications persist the decremented confidence.
 *
 * Per-row I/O errors are caught and logged so a single bad row does
 * not abort the pass; the helper returns `'skipped'` for them.
 */
export async function applyClassifiedOutcome(
  deps: Pick<MemoryDecayRunOrchestratorDeps, 'memorySegments' | 'logger'>,
  candidate: MemorySegment,
  classification: DecayClassification,
  now: Date,
  enforceKeep: boolean,
): Promise<RowOutcome> {
  const { memorySegments, logger } = deps;

  if (classification.outcome === 'skipped') {
    return 'skipped';
  }

  if (classification.outcome === 'archived') {
    if (enforceKeep) {
      // ENFORCE keep short-circuit: a useful / pinned /
      // injected-and-helped row is preserved even though its
      // decayed confidence fell below the floor.
      return 'skipped';
    }
    try {
      await memorySegments.update(candidate.id, { archived_at: now });
      return 'archived';
    } catch (error) {
      logger.error(
        `MemoryDecayReaper failed to archive segment ${candidate.id} (source=${candidate.source ?? 'null'}): ${(error as Error).message}`,
        (error as Error).stack,
      );
      return 'skipped';
    }
  }

  try {
    const nextMetadata: Record<string, unknown> = {
      ...(candidate.metadata_json ?? {}),
      confidence: classification.decayedConfidence,
    };
    candidate.metadata_json = nextMetadata;
    await memorySegments.save(candidate);
    return 'decayed';
  } catch (error) {
    logger.error(
      `MemoryDecayReaper failed to persist decayed confidence for segment ${candidate.id} (source=${candidate.source ?? 'null'}): ${(error as Error).message}`,
      (error as Error).stack,
    );
    return 'skipped';
  }
}

/**
 * Walk a candidate list exactly once: classify each row, resolve
 * the value-predicate verdict, persist the row's outcome, and
 * accumulate aggregates + shadow candidates. Pure with respect to
 * the supplied dependencies; the helper does not touch any
 * `this` state.
 *
 * Returns the `{ evaluated, decayed, archived, shadowCandidates,
 * usefulnessForPredicate }` snapshot the post-loop metric / log /
 * shadow-emit code consumes byte-identically to the pre-extraction
 * inline loop.
 */
export async function runCandidateLoop(
  deps: MemoryDecayRunOrchestratorDeps,
  candidates: MemorySegment[],
  settings: MemoryDecaySettings,
  usefulnessForPredicate: Map<string, SegmentUsefulness> | null,
  usefulnessThresholds: {
    usefulnessThreshold: number;
    minSamples: number;
  },
  now: Date,
): Promise<
  Pick<
    MemoryDecayRunAggregates,
    'evaluated' | 'decayed' | 'archived' | 'shadowCandidates'
  >
> {
  let evaluated = 0;
  let decayed = 0;
  let archived = 0;
  const shadowCandidates: DecayShadowCandidate[] = [];

  for (const candidate of candidates) {
    // EPIC-212 Phase-3 Task 4: `classifyDecay` reads the drift knobs off
    // `settings` and accelerates a drift-stamped row internally.
    const classification = classifyDecay(candidate, settings, now);
    const verdict: DecayKeepVerdict | null =
      usefulnessForPredicate !== null
        ? evaluateRetentionFromMap(
            candidate,
            usefulnessForPredicate,
            usefulnessThresholds,
          )
        : null;
    const enforceKeep =
      settings.valuePredicateMode === 'enforce' && verdict?.keep === true;

    const result = await applyClassifiedOutcome(
      deps,
      candidate,
      classification,
      now,
      enforceKeep,
    );
    if (result === 'decayed') {
      evaluated += 1;
      decayed += 1;
    } else if (result === 'archived') {
      evaluated += 1;
      archived += 1;
    }

    if (verdict !== null) {
      shadowCandidates.push(
        buildShadowCandidate(
          candidate,
          classification.outcome === 'archived',
          verdict,
        ),
      );
    }
  }

  return { evaluated, decayed, archived, shadowCandidates };
}

/**
 * Compute the shadow comparison and emit the
 * `memory.decay.shadow.v1` event. The event is best-effort — a
 * downstream EventLedger outage never bubbles out of the reaper
 * pass. The DB has already been mutated with the legacy behaviour
 * by the time this runs; this helper only OBSERVES.
 */
export async function emitDecayShadow(
  deps: Pick<MemoryDecayRunOrchestratorDeps, 'eventLedger' | 'logger'>,
  records: DecayShadowCandidate[],
  mode: DecayValuePredicateMode,
  now: Date,
): Promise<void> {
  const { eventLedger, logger } = deps;
  const comparison = computeDecayShadowComparison(mode, records);
  logger.log(
    `MemoryDecayReaper shadow comparison (mode=${mode}): evaluated=${comparison.evaluated.toString()}, legacyArchive=${comparison.legacyArchiveCount.toString()}, valuePredicateArchive=${comparison.valuePredicateArchiveCount.toString()}, keptByValueArchivedByLegacy=${comparison.keptByValueArchivedByLegacy.length.toString()}`,
  );
  if (!eventLedger) {
    return;
  }
  await eventLedger.emitBestEffort({
    domain: 'memory',
    eventName: AUTONOMY_EVENT_NAMES.memoryDecayShadow,
    outcome: 'success',
    payload: {
      mode: comparison.mode,
      evaluated: comparison.evaluated,
      legacy_archive_count: comparison.legacyArchiveCount,
      value_predicate_archive_count: comparison.valuePredicateArchiveCount,
      kept_by_value_archived_by_legacy: comparison.keptByValueArchivedByLegacy,
      archived_by_value_kept_by_legacy: comparison.archivedByValueKeptByLegacy,
      observed_at: now.toISOString(),
    },
  });
}

/**
 * Query the `memory_segments` table for reaper candidates using
 * the project's canonical `findDecayCandidates(...)` filter —
 * `archived_at IS NULL`, `source NOT IN MEMORY_DECAY_EXEMPT_SOURCES`,
 * `effective_last_touch < now − graceDays`. The drift knob is
 * forwarded so a drifted row inside the grace window can be
 * OR-selected when the operator has flipped on the invalidation
 * knob (EPIC-212 Phase-3 Task 4).
 */
export async function findDecayCandidates(
  deps: Pick<MemoryDecayRunOrchestratorDeps, 'decaySegments'>,
  settings: MemoryDecaySettings,
  now: Date,
): Promise<MemorySegment[]> {
  return deps.decaySegments.findDecayCandidates({
    exemptSources: [...MEMORY_DECAY_EXEMPT_SOURCES],
    graceCutoff: new Date(now.getTime() - settings.graceDays * MS_PER_DAY),
    treatDriftedAsEligible: settings.driftInvalidationEnabled,
  });
}
