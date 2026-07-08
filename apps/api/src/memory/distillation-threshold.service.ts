import {
  Injectable,
  Inject,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { SystemSettingsService } from '../settings/system-settings.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from '../observability/autonomy-observability.types';
import {
  MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
  MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
  coerceMemoryDistillationThreshold,
  memoryDistillationThresholdKey,
} from '../settings/distillation-threshold.constants';
import {
  PROJECT_GOAL_OVERRIDE_ACCESSOR,
  PROJECT_GOAL_OVERRIDE_METADATA_KEY,
  ProjectGoalOverrideRecord,
} from './project-goal-override.types';
import type { IProjectGoalOverrideAccessor } from './project-goal-override.types';
import type {
  DistillationThresholdResolution,
  DistillationThresholdSource,
} from './distillation-threshold.types';
import type { MemorySettingChangedPayload } from '../observability/event-ledger.service';

/**
 * Source identifier embedded in every `MemorySettingChanged` event
 * payload this service emits. Used as the `payload.source` filter when
 * rehydrating the baseline from the EventLedger so we only read rows
 * this service itself produced (not operator-driven
 * `SystemSettingsService.setAndEmit` writes, which use a different
 * `source`). Must match the literal emitted in `emitSettingChanged`.
 */
const DISTILLATION_THRESHOLD_EVENT_SOURCE =
  'distillation-threshold.service.resolve' as const;

/**
 * Internal shape of the primed baseline. Mirrors the
 * `(value, source)` tuple that `resolve()` returns — the same tuple
 * we cache from the live resolution stream after each call.
 */
type DistillationThresholdBaseline = {
  value: number;
  source: DistillationThresholdSource;
};

export { coerceMemoryDistillationThreshold };
export type {
  DistillationThresholdResolution,
  DistillationThresholdSource,
} from './distillation-threshold.types';
export {
  PROJECT_GOAL_OVERRIDE_ACCESSOR,
  PROJECT_GOAL_OVERRIDE_METADATA_KEY,
  NoopProjectGoalOverrideAccessor,
} from './project-goal-override.types';
export type {
  IProjectGoalOverrideAccessor,
  ProjectGoalOverrideRecord,
} from './project-goal-override.types';

/**
 * Resolves the live session-distillation trigger threshold using the
 * 3-tier precedence chain described in work item 3effbfa9:
 *
 *   1. SystemSetting (highest priority)
 *        a. Per-resource SystemSetting
 *           `memoryDistillationThreshold.${resourceId}`.
 *        b. Global SystemSetting
 *           `memoryDistillationThreshold.__global__`.
 *   2. ProjectGoal override metadata
 *      `ProjectGoal.metadata.memoryDistillationThreshold`, looked
 *      up via {@link IProjectGoalOverrideAccessor} using the
 *      `resourceId` argument.
 *   3. Hardcoded default of 0.8 (`MEMORY_DISTILLATION_THRESHOLD_DEFAULT`).
 *
 * Resolution is performed fresh on every call so the value can change at
 * runtime without restarting the consumer. Out-of-range or non-numeric
 * SystemSetting / ProjectGoal values are coerced via
 * {@link coerceMemoryDistillationThreshold} which falls back to the
 * default rather than throwing — matching the existing convention in
 * `coerceEnforcementMode` and `sanitizeLimit`.
 *
 * Event emission:
 *   The resolver is the single source of truth for the live threshold
 *   and is the place where drift between consecutive resolutions is
 *   observable. On every call it compares the freshly resolved
 *   `(value, source)` tuple against the last cached resolution and,
 *   when the value or source has drifted, emits a
 *   `MemorySettingChanged` event to the EventLedger. The event is
 *   `emitBestEffort` so an EventLedger outage cannot break distillation
 *   enqueue / scheduling.
 *
 *   The first call always has `changed: false` (there is no prior
 *   resolution to compare against); the call is treated as the
 *   baseline. Subsequent calls match the `setAndEmit` semantics in
 *   `SystemSettingsService`: emit only on drift.
 */
@Injectable()
export class DistillationThresholdService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DistillationThresholdService.name);

  /**
   * The most recent `(value, source)` tuple the resolver has observed,
   * primed from the EventLedger on bootstrap (or seeded from a prior
   * `resolve()` call when no ledger row exists).
   *
   * `null` until the first priming completes AND the ledger has no
   * matching row, OR until the first `resolve()` call in a process
   * where priming was never triggered (legacy / test paths).
   *
   * Replaces the legacy `lastValue` / `lastSource` process-local cache
   * so change detection survives restarts and converges across
   * replicas that share the same EventLedger.
   */
  private baseline: DistillationThresholdBaseline | null = null;

  /**
   * Re-entrancy guard for {@link primeBaselineFromLedger}. `null`
   * when no priming is in flight (or has finished); otherwise the
   * in-flight promise that concurrent callers must await instead of
   * starting a parallel ledger read. Reset to `null` after the IIFE
   * settles so a later caller can re-prime.
   */
  private primingPromise: Promise<void> | null = null;

  constructor(
    private readonly settings: SystemSettingsService,
    @Inject(PROJECT_GOAL_OVERRIDE_ACCESSOR)
    private readonly projectGoalAccessor: IProjectGoalOverrideAccessor,
    @Optional() private readonly eventLedger?: EventLedgerService,
  ) {}

  /**
   * NestJS lifecycle hook: prime the baseline from the EventLedger
   * before the first `resolve()` call so drift detection converges
   * across replicas and survives process restarts. Best-effort: any
   * error (or a missing EventLedger) leaves the baseline `null` and
   * the resolver still functions — the first `resolve()` call is
   * treated as the baseline (matching the pre-refactor behaviour).
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.primeBaselineFromLedger();
  }

  /**
   * Public test seam + re-priming entrypoint. Reads the latest
   * `MemorySettingChanged` event this service emitted from the
   * EventLedger and populates `this.baseline`.
   *
   * Re-entrant: a second caller arriving while the first is still in
   * flight awaits the same promise rather than starting a parallel
   * ledger read. Errors (ledger down, malformed payload, missing
   * method on a test fake) are logged and swallowed; baseline stays
   * `null`.
   */
  async primeBaselineFromLedger(): Promise<void> {
    if (this.primingPromise) {
      return this.primingPromise;
    }
    const inFlight: Promise<void> = (async () => {
      try {
        await this.applyBaselineFromLedger();
      } finally {
        this.primingPromise = null;
      }
    })();
    this.primingPromise = inFlight;
    return inFlight;
  }

  private async applyBaselineFromLedger(): Promise<void> {
    if (!this.eventLedger) {
      // No EventLedger wired (legacy / test scenarios). Best-effort
      // priming falls through to a null baseline; the first
      // `resolve()` call still establishes the baseline locally so
      // the existing drift-detection tests pass unchanged.
      this.baseline = null;
      return;
    }
    try {
      const entry =
        await this.eventLedger.findLatestMemorySettingChangedByPayloadSource({
          source: DISTILLATION_THRESHOLD_EVENT_SOURCE,
        });
      this.baseline = entry ? this.buildBaselineFromEntry(entry.payload) : null;
    } catch (error) {
      // Covers real DB errors AND test fakes that don't implement
      // `findLatestMemorySettingChangedByPayloadSource` (the method
      // is undefined on those, calling it throws a TypeError which
      // we treat the same as a ledger outage — best-effort priming).
      this.logger.warn(
        `Failed to prime distillation threshold baseline from EventLedger: ${(error as Error).message}`,
      );
      this.baseline = null;
    }
  }

  /**
   * Convert a `MemorySettingChangedPayload` (the body of the latest
   * event we emitted) into the internal baseline shape. Returns
   * `null` when the persisted `newSource` is not one of the four
   * documented resolution tiers — schema drift / cross-producer
   * pollution must NOT seed a phantom baseline that would later
   * compare equal against a legitimate resolution.
   *
   * Numeric coercion uses {@link coerceMemoryDistillationThreshold}
   * which falls back to {@link MEMORY_DISTILLATION_THRESHOLD_DEFAULT}
   * for non-numeric / null input. The fallback matches what the live
   * resolver would have cached had it processed the same payload
   * originally, so the primed baseline stays consistent with the
   * runtime resolver.
   */
  private buildBaselineFromEntry(
    payload: MemorySettingChangedPayload,
  ): DistillationThresholdBaseline | null {
    const sourceTier = this.parseSourceTier(payload.newSource);
    if (sourceTier === null) {
      return null;
    }
    const value = coerceMemoryDistillationThreshold(payload.newValue);
    return { value, source: sourceTier };
  }

  /**
   * Narrow the persisted `newSource` (string | undefined) into one
   * of the four documented resolution tiers. Returns `null` for any
   * unknown or missing value so the caller can fall through to a null
   * baseline rather than seed an invalid drift-detection starting
   * point.
   */
  private parseSourceTier(
    raw: MemorySettingChangedPayload['newSource'],
  ): DistillationThresholdSource | null {
    if (
      raw === 'project-system-setting' ||
      raw === 'global-system-setting' ||
      raw === 'project-goal-metadata' ||
      raw === 'default'
    ) {
      return raw;
    }
    return null;
  }

  /**
   * Lazy / first-call priming gate. Awaits the in-flight priming
   * promise (if any) before the resolver reads `this.baseline`. No-op
   * when priming was never triggered OR has already completed —
   * production traffic will hit `onApplicationBootstrap` first; test
   * paths may pre-seed via {@link primeBaselineFromLedger} or skip
   * priming entirely and observe the legacy first-call behaviour.
   */
  private async ensureBaselinePrimed(): Promise<void> {
    if (this.primingPromise) {
      await this.primingPromise;
    }
  }

  /**
   * Resolve the live threshold for the given resource context.
   *
   * @param resourceId - Optional resource id. When a non-empty string is
   *   supplied, the per-resource SystemSetting key is consulted first
   *   and the ProjectGoal-override layer is queried via the
   *   {@link IProjectGoalOverrideAccessor} (which translates the
   *   resourceId to the upstream scope lookup). When the value is
   *   null/undefined/empty the resolver skips the per-resource
   *   SystemSetting step and the ProjectGoal lookup, and falls
   *   straight through to the global key.
   * @returns A `DistillationThresholdResolution` describing the
   *   resolved threshold, the source layer, and whether the
   *   resolution drifted from the previous call. The first call has
   *   `changed: false, previousValue: null, previousSource: null`.
   */
  async resolve(
    resourceId: string | null | undefined,
  ): Promise<DistillationThresholdResolution> {
    await this.ensureBaselinePrimed();

    const previous = this.baseline;
    const previousValue = previous?.value ?? null;
    const previousSource = previous?.source ?? null;

    if (typeof resourceId === 'string' && resourceId.length > 0) {
      const resourceOverride = await this.settings.get<unknown>(
        memoryDistillationThresholdKey(resourceId),
        undefined,
      );
      const resourceValue = this.tryCoerce(resourceOverride);
      if (resourceValue !== null) {
        return this.publishAndCache({
          value: resourceValue,
          source: 'project-system-setting',
          previousValue,
          previousSource,
        });
      }
    }

    const globalOverride = await this.settings.get<unknown>(
      MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
      undefined,
    );
    const globalValue = this.tryCoerce(globalOverride);
    if (globalValue !== null) {
      return this.publishAndCache({
        value: globalValue,
        source: 'global-system-setting',
        previousValue,
        previousSource,
      });
    }

    if (typeof resourceId === 'string' && resourceId.length > 0) {
      const projectGoalValue = await this.readProjectGoalOverride(resourceId);
      if (projectGoalValue !== null) {
        return this.publishAndCache({
          value: projectGoalValue,
          source: 'project-goal-metadata',
          previousValue,
          previousSource,
        });
      }
    }

    return this.publishAndCache({
      value: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
      source: 'default',
      previousValue,
      previousSource,
    });
  }

  /**
   * Read the ProjectGoal-override metadata for `resourceId` and coerce
   * the well-known {@link PROJECT_GOAL_OVERRIDE_METADATA_KEY} value.
   * Returns `null` when the accessor finds no goal, when the metadata
   * is missing, or when the value is non-numeric / out of range.
   */
  private async readProjectGoalOverride(
    resourceId: string,
  ): Promise<number | null> {
    try {
      const record =
        await this.projectGoalAccessor.getOverrideByResourceId(resourceId);
      return extractProjectGoalThreshold(record);
    } catch (error) {
      // The accessor is provided by the upstream bridge and may fail
      // (network, missing goal, schema drift). Log and treat as "no
      // override" so the resolver still resolves to a stable value.
      this.logger.warn(
        `ProjectGoal override lookup failed for ${resourceId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Compare the freshly resolved `(value, source)` against the
   * previous cached resolution, emit a `MemorySettingChanged` event on
   * drift, update the cache, and return the resolution tuple.
   *
   * The first call always reports `changed: false` (no prior
   * resolution). This matches the `setAndEmit` semantics in
   * `SystemSettingsService`: a write that establishes the baseline
   * is not a "change".
   */
  private async publishAndCache(params: {
    value: number;
    source: DistillationThresholdResolution['source'];
    previousValue: number | null;
    previousSource: DistillationThresholdResolution['source'] | null;
  }): Promise<DistillationThresholdResolution> {
    const { value, source, previousValue, previousSource } = params;
    const changed = this.detectChange(
      value,
      source,
      previousValue,
      previousSource,
    );

    this.baseline = { value, source };

    if (changed && previousValue !== null && previousSource !== null) {
      await this.emitSettingChanged({
        value,
        source,
        previousValue,
        previousSource,
      });
    }

    return {
      value,
      source,
      changed,
      previousValue,
      previousSource,
    };
  }

  /**
   * Pure change-detection helper. Returns `true` exactly when the
   * `(value, source)` tuple differs from the previous one. Returns
   * `false` for the first call (no previous tuple).
   */
  private detectChange(
    value: number,
    source: DistillationThresholdResolution['source'],
    previousValue: number | null,
    previousSource: DistillationThresholdResolution['source'] | null,
  ): boolean {
    if (previousValue === null || previousSource === null) {
      return false;
    }
    return value !== previousValue || source !== previousSource;
  }

  /**
   * Best-effort emit of the `MemorySettingChanged` event. Failures are
   * logged but never thrown — distillation scheduling must continue
   * even when the EventLedger is unavailable. Mirrors the
   * `emitBestEffort` audit hook in `SystemSettingsService.setAndEmit`.
   */
  private async emitSettingChanged(params: {
    value: number;
    source: DistillationThresholdResolution['source'];
    previousValue: number;
    previousSource: DistillationThresholdResolution['source'];
  }): Promise<void> {
    if (!this.eventLedger) {
      return;
    }
    try {
      await this.eventLedger.emitBestEffort({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.memorySettingChanged,
        outcome: 'success',
        payload: {
          key: 'memoryDistillationThreshold',
          previousValue: params.previousValue,
          previousSource: params.previousSource,
          newValue: params.value,
          newSource: params.source,
          source: DISTILLATION_THRESHOLD_EVENT_SOURCE,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit MemorySettingChanged event: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Apply {@link coerceMemoryDistillationThreshold} but return `null` when
   * the supplied value is undefined (the SystemSettingsService "missing"
   * signal) so the caller can keep walking the precedence chain. When the
   * stored value is out of range / non-numeric the helper coerces to the
   * default which is also returned as a valid resolution rather than null,
   * so the consumer sees a stable threshold even when an operator has
   * stored garbage.
   */
  private tryCoerce(raw: unknown): number | null {
    if (raw === undefined) {
      return null;
    }
    return coerceMemoryDistillationThreshold(
      raw,
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
  }
}

/**
 * Pull the well-known override key out of a ProjectGoal record and
 * coerce it via {@link coerceMemoryDistillationThreshold}. Returns
 * `null` for every non-numeric / out-of-range / missing case so the
 * resolver can keep walking the chain.
 */
function extractProjectGoalThreshold(
  record: ProjectGoalOverrideRecord | null,
): number | null {
  if (!record) {
    return null;
  }
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const raw = metadata[PROJECT_GOAL_OVERRIDE_METADATA_KEY];
  if (raw === undefined) {
    return null;
  }
  return coerceMemoryDistillationThreshold(
    raw,
    MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
  );
}
