/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the nightly memory-decay
 * reaper + memory-drift detector operator-tunable knobs
 * (work item 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 4).
 *
 * The fragment consolidates the eight keyed defaults that drive
 * the two nightly reapers in `apps/api/src/memory/`:
 *
 *   - `MemoryDecayReaperService` (work item
 *     3d7fb798-f54d-40ff-a803-438224474912) — confidence decay
 *     over time, with a kill switch, cron, grace days, daily rate,
 *     and confidence floor.
 *   - `MemoryDriftDetectionService` (work item
 *     0cead042-e823-4e26-9386-02042252ffb0) — drift detection
 *     against repo paths / schema columns / API endpoints, with a
 *     kill switch, cron, and confidence-penalty magnitude.
 *
 * The keys (`MEMORY_DECAY_SETTING_KEYS` /
 * `MEMORY_DRIFT_SETTING_KEYS`) and the hardcoded defaults
 * (`MEMORY_DECAY_DEFAULT_*` / `MEMORY_DRIFT_DEFAULT_*`) live in
 * the source-of-truth files
 * `apps/api/src/memory/memory-decay.constants.ts` /
 * `apps/api/src/memory/memory-drift.constants.ts` — splitting the
 * runtime constants out of the settings module is the canonical
 * pattern (mirrored by every other settings constants file)
 * because the reaper / detector services live under
 * `apps/api/src/memory/` and would otherwise pull the entire
 * settings module surface area into the memory code path. The
 * fragment imports the keys + defaults directly so the seeded
 * values stay byte-identical to the runtime constants and the
 * `SystemSettingsService.seedDefaults()` registration never
 * drifts from the reaper / detector service fallback values.
 *
 * The descriptions reference the runtime constants (cron,
 * defaults, exempt sources) verbatim so the operator-facing UI
 * text and the implementing service stay aligned.
 *
 * Extracted out of `system-settings.defaults.ts` so that file
 * stays under the project's `max-lines` lint cap while the
 * operator-tunable knob surface continues to grow across
 * milestones. The spread keeps the seeded defaults byte-identical
 * to the pre-refactor inline registry.
 */
import {
  MEMORY_DECAY_DEFAULT_CRON,
  MEMORY_DECAY_DEFAULT_DAILY_RATE,
  MEMORY_DECAY_DEFAULT_ENABLED,
  MEMORY_DECAY_DEFAULT_FLOOR,
  MEMORY_DECAY_DEFAULT_GRACE_DAYS,
  MEMORY_DECAY_SETTING_KEYS,
} from '../memory/memory-decay.constants';
import {
  MEMORY_DRIFT_DEFAULT_CONFIDENCE_PENALTY,
  MEMORY_DRIFT_DEFAULT_CRON,
  MEMORY_DRIFT_DEFAULT_ENABLED,
  MEMORY_DRIFT_SETTING_KEYS,
} from '../memory/memory-drift.constants';

export const MEMORY_DECAY_DRIFT_DEFAULTS_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [MEMORY_DECAY_SETTING_KEYS.enabled]: {
    value: MEMORY_DECAY_DEFAULT_ENABLED,
    description:
      'Kill switch for the nightly MemoryDecayReaperService pass. When false the reaper logs and returns early without scanning any rows (the last-run timestamp is still updated so the snapshot reflects "the reaper was awake").',
  },
  [MEMORY_DECAY_SETTING_KEYS.cron]: {
    value: MEMORY_DECAY_DEFAULT_CRON,
    description:
      'Cron expression (UTC) that drives the nightly MemoryDecayReaper tick. The BullMQ scheduler registration reads this value on startup and re-registers the repeatable job when an operator updates the setting. Default `30 3 * * *` runs at 03:30 UTC every day, intentionally off-peak for the orchestration cycles and offset by 30 minutes from the eviction reaper. Standard 5-field cron syntax is required.',
  },
  [MEMORY_DECAY_SETTING_KEYS.graceDays]: {
    value: MEMORY_DECAY_DEFAULT_GRACE_DAYS,
    description:
      'Grace period in days before a memory segment becomes eligible for confidence decay by the nightly MemoryDecayReaper. Segments whose effective last touch (max(last_accessed_at, last_reinforced_at)) is older than this many days — and whose source is not in the decay exempt allowlist — are decayed at the daily_rate. A row whose last_reinforced_at is within the window is always preserved (the reinforcement resets decay).',
  },
  [MEMORY_DECAY_SETTING_KEYS.dailyRate]: {
    value: MEMORY_DECAY_DEFAULT_DAILY_RATE,
    description:
      'Per-day confidence decay rate applied by the nightly MemoryDecayReaper. The math is `new_confidence = max(0, floor((confidence - daily_rate * days_overdue) * 100) / 100)`. Default 0.01 = 1% per day past the grace period.',
  },
  [MEMORY_DECAY_SETTING_KEYS.floor]: {
    value: MEMORY_DECAY_DEFAULT_FLOOR,
    description:
      'Confidence floor (0–1) below which a decayed memory segment is archived (archived_at set) rather than further decayed by the nightly MemoryDecayReaper. Archived rows are preserved for auditability and excluded from the candidate set on subsequent runs.',
  },
  [MEMORY_DRIFT_SETTING_KEYS.enabled]: {
    value: MEMORY_DRIFT_DEFAULT_ENABLED,
    description:
      'Kill switch for the nightly MemoryDriftDetectionService pass (work item 0cead042-e823-4e26-9386-02042252ffb0). When false the detector logs and returns early without scanning any rows (the run summary still reports `skipped: true` with `reason: disabled` so the snapshot reflects "the detector was awake").',
  },
  [MEMORY_DRIFT_SETTING_KEYS.cron]: {
    value: MEMORY_DRIFT_DEFAULT_CRON,
    description:
      'Cron expression (UTC) that drives the nightly MemoryDriftDetectionService tick. The BullMQ scheduler registration reads this value on startup and re-registers the repeatable job when an operator updates the setting. Default `0 4 * * *` runs at 04:00 UTC every day, intentionally offset 60 minutes from the decay reaper (`30 3 * * *`) and the eviction reaper (`0 3 * * *`) so the three nightly passes do not race for the same DB connection budget. Standard 5-field cron syntax is required.',
  },
  [MEMORY_DRIFT_SETTING_KEYS.confidencePenalty]: {
    value: MEMORY_DRIFT_DEFAULT_CONFIDENCE_PENALTY,
    description:
      'Magnitude of the confidence penalty (0–1) subtracted from a memory segment on drift detection by the nightly MemoryDriftDetectionService. The post-penalty confidence is clamped to [0, 1]. A value of 0 disables the penalty without flipping the kill switch. Negative values fall back to the default so a UI typo cannot invert the detector.',
  },
};
