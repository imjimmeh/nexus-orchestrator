import { Injectable, Optional } from '@nestjs/common';
import { SystemSettingsRepository } from './system-settings.repository';
import { SystemSetting } from '../system/database/entities/system-setting.entity';
import {
  MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
  MEMORY_DISTILLATION_THRESHOLD_KEY_PREFIX,
} from './distillation-threshold.constants';
import { LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING } from './learning-convergence-settings.constants';
import { MEMORY_FEEDBACK_WINDOW_DAYS_SETTING } from './memory-feedback-window-days.constants';
import {
  MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING,
} from './memory-metrics-settings.constants';
import { MEMORY_DECAY_SETTING_KEYS } from '../memory/memory-decay.constants';
import { MEMORY_DRIFT_SETTING_KEYS } from '../memory/memory-drift.constants';
import { SYSTEM_SETTING_DEFAULTS } from './system-settings.defaults';
import { EventLedgerService } from '../observability/event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from '../observability/autonomy-observability.types';

/**
 * Re-export the default-setting registry from this module so the
 * existing test surface
 * (`system-settings.service.spec.ts`) keeps its
 * `import { SYSTEM_SETTING_DEFAULTS } from './system-settings.service'`
 * contract. The canonical storage lives in
 * `system-settings.defaults.ts` so the service file stays under
 * the project's `max-lines` lint cap while the registry continues
 * to grow as new operator-tunable knobs land (e.g. the
 * memory-drift detector's cron / kill switch / confidence-penalty
 * settings in work item 0cead042-e823-4e26-9386-02042252ffb0).
 */
export { SYSTEM_SETTING_DEFAULTS };

@Injectable()
export class SystemSettingsService {
  constructor(
    private readonly repository: SystemSettingsRepository,
    @Optional() private readonly eventLedger?: EventLedgerService,
  ) {}

  /**
   * Get a setting value. Returns the stored JSON value cast to T,
   * or the provided (or built-in) default if the key is absent.
   */
  async get<T>(key: string, defaultValue: T): Promise<T> {
    const setting = await this.repository.findByKey(key);
    if (setting === null) {
      return defaultValue;
    }
    return setting.value as T;
  }

  async set(
    key: string,
    value: unknown,
    description?: string,
  ): Promise<SystemSetting> {
    return this.repository.upsert(key, value, description);
  }

  /**
   * Upsert a setting and emit a `memorySettingChanged` event for keys in
   * the memory settings allowlist. Used by the controller's PUT handler
   * so operator-driven changes surface in the EventLedger without
   * requiring every internal caller to wire up the event manually.
   *
   * Allowlist: keys whose primary segment equals
   * {@link MEMORY_DISTILLATION_THRESHOLD_KEY_PREFIX}. Add more memory:*
   * keys here as the surface area grows. The allowlist is intentionally
   * narrow so the EventLedger is not flooded with non-memory setting
   * changes (e.g. RBAC, telegram, retry policy).
   *
   * The `set()` method is preserved for callers that should not emit
   * (internal tests, programmatic seeds). Tests and consumers that
   * require audit-level event emission should use this method.
   */
  async setAndEmit(
    key: string,
    value: unknown,
    description?: string,
    actorId?: string,
  ): Promise<SystemSetting> {
    const previous = await this.repository.findByKey(key);
    const previousValue = previous ? previous.value : null;
    const saved = await this.repository.upsert(key, value, description);

    if (
      this.eventLedger &&
      this.isMemorySetting(key) &&
      !isStructurallyEqual(previousValue, value)
    ) {
      await this.eventLedger.emitBestEffort({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.memorySettingChanged,
        outcome: 'success',
        actorId,
        payload: {
          key,
          previousValue: previousValue ?? null,
          newValue: value,
          source: 'system-settings.setAndEmit',
        },
      });
    }

    return saved;
  }

  async getAll(): Promise<SystemSetting[]> {
    return this.repository.findAll();
  }

  /**
   * Seed all known defaults that do not already exist.
   * Called during module init.
   */
  async seedDefaults(): Promise<void> {
    for (const [key, def] of Object.entries(SYSTEM_SETTING_DEFAULTS)) {
      const existing = await this.repository.findByKey(key);
      if (!existing) {
        await this.repository.upsert(key, def.value, def.description);
      }
    }
  }

  /**
   * Allowlist predicate for keys that participate in the
   * `MemorySettingChanged` event surface. Keeps the EventLedger signal
   * noise down — only the memory distillation threshold family and the
   * memory-metrics refresh knobs are audited today.
   */
  private isMemorySetting(key: string): boolean {
    if (key === LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING) {
      return true;
    }
    if (key === MEMORY_FEEDBACK_WINDOW_DAYS_SETTING) {
      return true;
    }
    if (key.startsWith('workflow_postmortem_')) {
      return true;
    }
    return this.isMemorySettingCore(key);
  }

  /**
   * The non-convergence / non-postmortem half of the
   * `isMemorySetting` allowlist. Split out so each method
   * stays under the project's `complexity` lint cap.
   */
  private isMemorySettingCore(key: string): boolean {
    return (
      key === MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY ||
      key === MEMORY_DISTILLATION_THRESHOLD_KEY_PREFIX ||
      key.startsWith(`${MEMORY_DISTILLATION_THRESHOLD_KEY_PREFIX}.`) ||
      key === MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING ||
      key === MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING ||
      key === MEMORY_DECAY_SETTING_KEYS.enabled ||
      key === MEMORY_DECAY_SETTING_KEYS.cron ||
      key === MEMORY_DECAY_SETTING_KEYS.graceDays ||
      key === MEMORY_DECAY_SETTING_KEYS.dailyRate ||
      key === MEMORY_DECAY_SETTING_KEYS.floor ||
      key === MEMORY_DRIFT_SETTING_KEYS.enabled ||
      key === MEMORY_DRIFT_SETTING_KEYS.cron ||
      key === MEMORY_DRIFT_SETTING_KEYS.confidencePenalty
    );
  }
}

function isStructurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}
