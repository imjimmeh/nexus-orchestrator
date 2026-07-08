/**
 * Type definitions for the memory distillation threshold resolver.
 *
 * Kept in a dedicated `*.types.ts` file to satisfy the api eslint
 * convention of moving exported types/interfaces out of runtime modules.
 */

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
 * Distinguish where a resolved distillation threshold originated from.
 * Used for observability and to allow callers to log the active source
 * without re-implementing the precedence chain.
 *
 * The chain (highest precedence first) is:
 *   1. `project-system-setting` — per-resource SystemSetting
 *      `memoryDistillationThreshold.${resourceId}`.
 *   2. `global-system-setting` — global SystemSetting
 *      `memoryDistillationThreshold.__global__`.
 *   3. `project-goal-metadata` — `ProjectGoal.metadata.memoryDistillationThreshold`
 *      surfaced via `IProjectGoalOverrideAccessor`.
 *   4. `default` — hardcoded `MEMORY_DISTILLATION_THRESHOLD_DEFAULT` (0.8).
 *
 * Tiers 1 + 2 are both "SystemSetting" tiers (the AC describes them as
 * a single tier). Tier 3 is the ProjectGoal override metadata layer.
 * Tier 4 is the global default. The 3-tier AC view (SystemSetting >
 * ProjectGoal override metadata > global default) maps onto this
 * 4-step walk as: {1, 2} > 3 > 4.
 */
export type DistillationThresholdSource =
  | 'project-system-setting'
  | 'global-system-setting'
  | 'project-goal-metadata'
  | 'default';

/**
 * The resolved threshold plus enough context to detect drift between
 * consecutive calls. The `changed` flag is `true` exactly when the
 * `value` or `source` differs from the previous resolution — same
 * semantics as the `setAndEmit` audit hook in `SystemSettingsService`.
 *
 * `previousValue` and `previousSource` are `null` on the first call
 * (no prior resolution to compare against).
 */
export interface DistillationThresholdResolution {
  value: number;
  source: DistillationThresholdSource;
  changed: boolean;
  previousValue: number | null;
  previousSource: DistillationThresholdSource | null;
}
