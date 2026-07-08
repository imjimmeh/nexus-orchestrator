/**
 * Re-export the Kanban-neutral {@link FailureClass} discriminator
 * (and its helpers) from `@nexus/core` so kanban call sites can
 * import everything they need for the failure-threshold trigger from
 * this single file. The enum is defined in `packages/core` because the
 * project boundary rules require API / core to remain Kanban-neutral.
 *
 * Work item: 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062)
 * Closes OPEN_QUESTIONS K1.
 */
export {
  FAILURE_CLASSES_THAT_COUNT,
  FailureClass,
  shouldCountFailure,
} from "@nexus/core";

/**
 * Injection token for the kanban retrospective failure-threshold service.
 *
 * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35
 * EPIC-117 (Retrospective Checkpoints & Continuous Learning Cadence)
 * EPIC-202 (Close AI Self-Improvement Loop)
 */
export const KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE =
  "KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE";

/**
 * Owns the consecutive workflow-failure counter for a kanban project
 * and fires a `failure_threshold` retrospective when the configurable
 * `FAILURE_THRESHOLD_COUNT` is met or exceeded.
 *
 * Decoupled from `IKanbanRetrospectiveService` so cross-module callers
 * (currently `OrchestrationCycleDecisionService`) can depend on a narrow
 * interface that does not pull in the full retrospective runner.
 */
export interface IKanbanRetrospectiveFailureThresholdService {
  /**
   * Records a consecutive workflow failure for the project and, if the
   * resulting count meets or exceeds the configured threshold, fires a
   * `failure_threshold` retrospective run. The trigger fires
   * synchronously so the retrospective lands BEFORE the next
   * orchestration cycle completes.
   *
   * The optional `failureClass` discriminator lets the caller classify
   * the failure (e.g. `QaRejection` vs `SystemFailure`); only the
   * classes that count toward the threshold (see
   * {@link FAILURE_CLASSES_THAT_COUNT}) actually increment the
   * counter. Every invocation emits a `kanban.retrospective.failure_observed`
   * diagnostic event so operators can audit the full surface — both
   * counted and non-counted observations.
   *
   * No-op when no orchestration exists for the project.
   */
  checkFailureThreshold(
    projectId: string,
    failureClass?: import("@nexus/core").FailureClass,
  ): Promise<void>;

  /**
   * Resets the consecutive failure counter for a project back to 0.
   * Called when an orchestration cycle completes successfully so the
   * next failure starts a fresh streak.
   *
   * No-op when no orchestration exists for the project.
   */
  resetConsecutiveFailureCount(projectId: string): Promise<void>;
}

/**
 * Narrow dependency-inversion contract for the API's
 * `SystemSettingsService`. The implementing service
 * (apps/api/src/settings/system-settings.service.ts) exposes a
 * superset of this contract; the kanban app stays decoupled from the
 * API package and only depends on the `get<T>(key, defaultValue)`
 * surface used by the failure-threshold service. Matches the
 * project's `nestjs-interface-extraction` pattern.
 *
 * Work item: 2ec2799b-b003-4f5d-bca4-d56d3ef601dd (WI-2026-063).
 */
export interface ISystemSettingsReader {
  get<T>(key: string, defaultValue: T): Promise<T>;
}
