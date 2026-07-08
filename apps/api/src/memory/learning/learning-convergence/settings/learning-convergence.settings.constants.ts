/**
 * System-setting keys, hardcoded defaults, and pure coercers for
 * the daily convergence recorder (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2, AC-3 +
 * AC-4).
 *
 * The recorder is the daily cron-driven service that:
 *
 *   - reads the per-scope convergence snapshots from
 *     {@link MemoryMetricsService.getConvergenceSnapshots},
 *   - aggregates them into a per-window
 *     `promoted_to_bound_score` / `bound_to_reused_score`
 *     pair,
 *   - persists the snapshot row via
 *     {@link LearningMeasurementSnapshotRepository.insertSnapshot},
 *   - recomputes the {@link decideMemoryRetentionKeep}
 *     usefulness threshold and upserts the
 *     `memory_retention_policy` singleton row, and
 *   - emits best-effort metrics + audit events.
 *
 * All knobs the recorder consults at runtime live here so the
 * registry module stays under the project's `max-lines` lint cap
 * while the operator-tunable surface continues to grow. Mirrors
 * the fragment-file convention in
 * `apps/api/src/settings/system-settings.defaults.ts` (each
 * domain-local fragment exports a
 * `*_SYSTEM_SETTING_DEFAULTS: Record<string, { value, description }>`
 * literal that the central registry spreads).
 *
 * The cron key (`learning_convergence_cron`) is also wired into
 * the global defaults registry so the API's
 * `SystemSettingsService.seedDefaults()` seeds it on a fresh
 * database; see the spread site at the bottom of
 * `system-settings.defaults.ts`.
 *
 * `LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON` is the
 * recorder's ε-comparison constant for "did the threshold move
 * enough to justify a `recalibrated_at` bump?" — mirrors the
 * `Math.abs(new − current) < ε` pattern in
 * `MemoryRetentionPolicyRepository.upsertIfChanged`. The
 * repository takes the epsilon as a parameter so the constant
 * lives next to the other recorder knobs and the call site stays
 * self-documenting.
 */

/** Cron expression (UTC) for the daily convergence recorder pass. */
export const LEARNING_CONVERGENCE_CRON_SETTING =
  'learning_convergence_cron' as const;

/** Default cron — daily at 02:00 UTC. */
export const LEARNING_CONVERGENCE_CRON_DEFAULT = '0 2 * * *';

/** Rolling window (in days) the recorder uses to aggregate convergence snapshots. */
export const LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING =
  'learning_convergence_window_days' as const;

/** Default window — 1 day (matches the recorder's default operating window). */
export const LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT = 1;

/** Minimum samples the recorder requires before recalibrating the usefulness threshold. */
export const LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_SETTING =
  'learning_convergence_usefulness_min_samples' as const;

/** Default min-samples — 10 (matches the memory-decay reaper's default). */
export const LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_DEFAULT = 10;

/**
 * Absolute `Math.abs(new − current) < ε` cut-off the recorder
 * uses to skip a `memory_retention_policy` upsert when the
 * proposed threshold has not moved enough to justify a
 * `recalibrated_at` bump. Mirrors the inline ε in
 * `MemoryRetentionPolicyRepository.upsertIfChanged`; the
 * recorder reads this constant so the comparison is
 * self-documenting at the call site.
 *
 * Sized at `1e-6` — small enough that a recorder pass that
 * proposes the same threshold twice (or a one-bit float-drift
 * variant of the same number) always falls in the
 * `no_change` branch and the operator UI does not show a
 * phantom "just recalibrated" event, but large enough that a
 * legitimate re-calibration (the recorder finding a new
 * threshold after re-computing against a wider window) is
 * never collapsed into a no-op.
 */
export const LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON = 1e-6;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the daily convergence
 * recorder's CRON key only (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2). Spread
 * into the global registry in
 * `apps/api/src/settings/system-settings.defaults.ts` so the
 * recorder's `learning_convergence_cron` knob seeds on a fresh
 * database with its canonical default (`'0 2 * * *'`) and
 * operator-facing description.
 *
 * NOTE: only the `learning_convergence_cron` key is registered
 * here. The sibling `learning_convergence_window_days` key is
 * already seeded (with default `7`) by the older
 * `apps/api/src/settings/learning-convergence-settings.constants.ts`
 * fragment under the same string — registering a second
 * `learning_convergence_window_days` entry under the recorder
 * (with default `1`) would shadow the gauge's canonical
 * default and break the existing
 * `system-settings.service.spec.ts` registry assertion.
 * The recorder reads its own knob via the constants exported
 * in this file (`LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT`)
 * and falls back to the registry value at runtime, so the
 * recorder's semantic default is preserved without colliding
 * with the gauge's.
 */
export const LEARNING_CONVERGENCE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [LEARNING_CONVERGENCE_CRON_SETTING]: {
    value: LEARNING_CONVERGENCE_CRON_DEFAULT,
    description:
      "Cron expression (UTC) for the daily ConvergenceRecorderService pass (work item 946a3c8b-5814-4e76-a804-b557e589600b). The recorder reads the per-scope convergence snapshots from MemoryMetricsService, aggregates them across the configured window, and persists a learning_measurement_snapshots row + an upserted memory_retention_policy singleton row. Defaults to '0 2 * * *' (daily at 02:00 UTC) so the recorder runs in the maintenance window alongside the memory-decay reaper. Operators can tune the cadence without restarting the API; the next process bootstrap re-registers the BullMQ repeatable job with the new pattern.",
  },
};
