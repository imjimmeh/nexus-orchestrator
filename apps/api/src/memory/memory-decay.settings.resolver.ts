import { Injectable, Logger, Optional } from '@nestjs/common';
import { SystemSettingsService } from '../settings/system-settings.service';
import { MemoryRetentionPolicyRepository } from './learning/learning-convergence/database/repositories/memory-retention-policy.repository';
import {
  MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT,
  MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
  coerceMemoryDecayUsefulnessThreshold,
} from '../settings/memory-decay-value.settings.constants';

/**
 * In-memory cache TTL for the resolved usefulness threshold.
 *
 * The nightly `MemoryDecayReaperService.runDecayPass()` is
 * triggered from a BullMQ cron tick — at most a handful of times
 * per hour — so the cache exists to short-circuit a hot unit
 * test, not a hot production path. 1 second is long enough to
 * dedupe multiple resolves inside one tick (the recorder pass +
 * a shadow-comparison probe + the reaper pass all share the
 * resolver in a single boot) and short enough that an
 * operator-driven `setAndEmit(...)` of the underlying setting
 * is observed on the very next tick after a 1-second pause.
 */
const RESOLVER_CACHE_TTL_MS = 1000;

/**
 * Resolves the `memory_decay_usefulness_threshold` value the
 * `MemoryDecayReaperService` should use on the next pass.
 *
 * Work item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 4.
 * Three-branch priority chain:
 *
 *   1. `MemoryRetentionPolicyRepository.getCurrent()` returns
 *      a row with a non-null `usefulness_threshold` → use it
 *      (the daily `ConvergenceRecorderService` writes the
 *      recorder-calibrated threshold here on every pass).
 *   2. `SystemSettingsService` key
 *      `memory_decay_usefulness_threshold` is present → use it
 *      (the operator-tunable override that seeds the global
 *      `SYSTEM_SETTING_DEFAULTS` fragment).
 *   3. Hardcoded `MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT`
 *      (currently `0.6`).
 *
 * Each branch is wrapped in a try/catch so a transient DB blip
 * (e.g. the recorder's repository throwing) never aborts the
 * reaper pass — the resolver fails *soft* down to the next
 * branch, mirroring the fail-soft posture of the
 * `MemorySegmentFeedbackService` resolver inside the reaper.
 *
 * The `MemoryRetentionPolicyRepository` dependency is
 * `@Optional()` so a host application that does not register
 * the recorder (e.g. an app slice that uses only the
 * `MemoryDecayReaperService` standalone) still resolves the
 * threshold via branches 2 and 3 without a wiring error.
 */
@Injectable()
export class MemoryDecaySettingsResolver {
  private readonly logger = new Logger(MemoryDecaySettingsResolver.name);
  private cachedThreshold: number | null = null;
  private cachedAt = 0;

  constructor(
    private readonly settings: SystemSettingsService,
    @Optional()
    private readonly policyRepo?: MemoryRetentionPolicyRepository,
  ) {}

  /**
   * Resolve the next-pass `usefulnessThreshold`. Reads happen
   * fresh on every call unless the 1-second in-memory cache is
   * still warm; cache misses walk the 3-branch priority chain
   * and the result is cached for `RESOLVER_CACHE_TTL_MS`.
   */
  async resolveUsefulnessThreshold(): Promise<number> {
    const now = Date.now();
    if (
      this.cachedThreshold !== null &&
      now - this.cachedAt < RESOLVER_CACHE_TTL_MS
    ) {
      return this.cachedThreshold;
    }
    const resolved = await this.resolve();
    this.cachedThreshold = resolved;
    this.cachedAt = now;
    return resolved;
  }

  /**
   * Walk the 3-branch priority chain. Each branch is wrapped in
   * a try/catch so a thrown error (DB blip, settings outage)
   * degrades to the next branch instead of bubbling out of the
   * reaper pass.
   */
  private async resolve(): Promise<number> {
    // Branch 1: recorder-calibrated threshold on the singleton
    // `memory_retention_policy` row.
    try {
      const row = await this.policyRepo?.getCurrent();
      if (row?.usefulness_threshold != null) {
        return coerceMemoryDecayUsefulnessThreshold(row.usefulness_threshold);
      }
    } catch (error) {
      this.logger.debug(
        `MemoryDecaySettingsResolver: MemoryRetentionPolicyRepository.getCurrent() failed; falling back to SystemSettings: ${(error as Error).message}`,
      );
    }

    // Branch 2: operator-tunable SystemSettings key. The
    // `null` sentinel default lets the resolver treat
    // "setting is absent" as "fall through to the hardcoded
    // default" without coupling to the
    // `SystemSettingsService.get(...)` overload set.
    try {
      const raw = await this.settings.get<unknown>(
        MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
        null,
      );
      if (raw != null) {
        return coerceMemoryDecayUsefulnessThreshold(raw);
      }
    } catch (error) {
      this.logger.debug(
        `MemoryDecaySettingsResolver: SystemSettingsService.get(${MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING}) failed; falling back to default: ${(error as Error).message}`,
      );
    }

    // Branch 3: hardcoded default. The same constant the
    // reaper's pre-resolver code path used.
    return MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT;
  }
}
