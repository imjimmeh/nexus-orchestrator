import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  FailureClass,
  RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS,
  shouldCountFailure,
  type FailureClass as FailureClassType,
  type RetrospectiveFailureThresholdSettingKey,
} from "@nexus/core";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import { safeEmitKanbanEvent } from "./kanban-retrospective-event-emitter.helpers";
import { formatUnknownErrorMessage } from "./kanban-retrospective-error.helpers";
import { narrowMetadataRecord } from "./kanban-retrospective-metadata.helpers";
import {
  FAILURE_TIMESTAMPS_METADATA_KEY,
  LAST_EMITTED_AT_METADATA_KEY,
  LAST_EMITTED_WINDOW_METADATA_KEY,
  computeWindowStartEpochSeconds,
  getFailureTimestamps,
  isCooldownActive,
  pruneAndAppendFailureTimestamp,
  wasWindowAlreadyEmitted,
} from "./kanban-retrospective-failure-threshold.helpers";
import { KanbanRetrospectiveService } from "./kanban-retrospective.service";
import {
  readBypassCooldownEnv,
  readCooldownSecondsEnv,
  readEnabledEnv,
  readFailureThresholdCountEnv,
  readWindowSecondsEnv,
  readWindowStrategyEnv,
} from "./kanban-retrospective-failure-threshold.env";
import type { IKanbanRetrospectiveFailureThresholdService, ISystemSettingsReader } from "./kanban-retrospective-failure-threshold.types";

/**
 * Diagnostic event name. Emitted on every call to
 * {@link KanbanRetrospectiveFailureThresholdService.checkFailureThreshold}
 * so operators can audit the full failure surface — both counted and
 * non-counted observations.
 */
export const KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT =
  "kanban.retrospective.failure_observed";

// Shape of the resolved failure-threshold settings.
type FailureThresholdSettings = {
  enabled: boolean;
  count: number;
  windowSeconds: number;
  cooldownSeconds: number;
  bypassCooldown: boolean;
  windowStrategy: "sliding" | "fixed";
};

// Per-key spec consumed by the data-driven settings loop. Iteration
// produces the resolved settings object so adding a new knob only
// requires extending the list.
const FAILURE_THRESHOLD_SETTINGS_SPECS: ReadonlyArray<{
  destination: keyof FailureThresholdSettings;
  key: RetrospectiveFailureThresholdSettingKey;
  envDefault: () => boolean | number | "sliding" | "fixed";
}> = [
  { destination: "enabled", key: RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.Enabled, envDefault: readEnabledEnv },
  { destination: "count", key: RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.Count, envDefault: readFailureThresholdCountEnv },
  { destination: "windowSeconds", key: RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.WindowSeconds, envDefault: readWindowSecondsEnv },
  { destination: "cooldownSeconds", key: RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.CooldownSeconds, envDefault: readCooldownSecondsEnv },
  { destination: "bypassCooldown", key: RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.BypassCooldown, envDefault: readBypassCooldownEnv },
  { destination: "windowStrategy", key: RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.WindowStrategy, envDefault: readWindowStrategyEnv },
];

/**
 * Failure-threshold retrospective trigger.
 *
 * Work items:
 *  - 2b8d0c51-ad27-4f10-9448-38502c8bbf35 (EPIC-117 / EPIC-202)
 *  - 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062, failure classes)
 *  - 2ec2799b-b003-4f5d-bca4-d56d3ef601dd (WI-2026-063, OPEN_QUESTIONS
 *    K2 + K4 + K5 — settings schema + deterministic revision marker +
 *    cooldown-bypass knob)
 *
 * ## Settings sourcing (design decision, work item 2ec2799b-…)
 *
 * The constructor accepts an optional `ISystemSettingsReader` (the
 * API's `SystemSettingsService` exposed via the narrow contract in
 * `./kanban-retrospective-failure-threshold.types`). It is registered
 * as `@Optional()` so the production kanban app can run with two
 * configurations:
 *
 *   1. **No DI wiring (current default).** The kanban app's
 *      `RetrospectivesModule` does NOT import `SystemSettingsModule`
 *      (that would be a cross-app dependency and is forbidden by the
 *      AGENTS.md apps/packages boundary policy). In this mode the
 *      `systemSettings` field is `undefined` and `resolveSettings()`
 *      falls through to the env-var helpers in
 *      `./kanban-retrospective-failure-threshold.env`. Operators tune
 *      the knobs at deploy time via
 *      `RETROSPECTIVE_FAILURE_THRESHOLD_ENABLED`,
 *      `RETROSPECTIVE_FAILURE_THRESHOLD_COUNT` (legacy alias
 *      `FAILURE_THRESHOLD_COUNT`), `…_WINDOW_SECONDS`,
 *      `…_COOLDOWN_SECONDS`, `…_BYPASS_COOLDOWN`,
 *      `…_WINDOW_STRATEGY`.
 *   2. **DI wiring (future).** A production deployment that wants
 *      runtime-tunable operator settings (via the API's
 *      `system-settings` REST surface, no restart required) would add
 *      an adapter provider to `RetrospectivesModule.imports` that
 *      maps the API's `SystemSettingService` onto the local
 *      `ISystemSettingsReader` token. The constructor accepts the
 *      injection transparently; `resolveSettings()` will use it on
 *      every `checkFailureThreshold()` call.
 *
 * Both paths converge on the same six key strings (imported from
 * `@nexus/core`) and the same hardcoded defaults, so the operator
 * surface (REST PUT or env-var at deploy time) is identical from
 * the trigger's perspective. The integration spec exercises option 1
 * (env-var fallback) by constructing the service with two arguments
 * and relying on the env defaults.
 *
 * @nexus/core hosts the shared `RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS`
 * contract because the API (which owns persistence + Zod validation)
 * and the implementing service (which reads the keys on every call)
 * must agree on the same six strings and defaults; a duplicate
 * registry would let the two surfaces drift silently. The
 * `@nexus/core` home is preferred over `@nexus/kanban-contracts`
 * because the API's `no-restricted-imports` ESLint rule forbids
 * `@nexus/kanban-contracts` from API source files.
 */
@Injectable()
export class KanbanRetrospectiveFailureThresholdService
  implements IKanbanRetrospectiveFailureThresholdService
{
  private readonly logger = new Logger(
    KanbanRetrospectiveFailureThresholdService.name,
  );

  constructor(
    @Inject(KanbanOrchestrationRepository)
    private readonly orchestrations: KanbanOrchestrationRepository,
    @Inject(KanbanRetrospectiveService)
    private readonly retrospectives: KanbanRetrospectiveService,
    @Optional()
    private readonly systemSettings?: ISystemSettingsReader,
  ) {}

  /**
   * Records a consecutive workflow failure for the project and, if the
   * resulting count meets or exceeds the configurable
   * `retrospective_failure_threshold_count` setting, fires a
   * retrospective run with `trigger_type='failure_threshold'`.
   *
   * The optional `failureClass` parameter classifies the failure
   * (e.g. `QaRejection`, `SystemFailure`). Only the classes that
   * count toward the threshold actually increment the
   * `consecutive_failure_count` counter. Every call — counted or not
   * — emits a `kanban.retrospective.failure_observed` diagnostic
   * event.
   *
   * Best-effort: counter persistence failures are logged and swallowed
   * so a DB hiccup cannot break the orchestration cycle decision path.
   */
  async checkFailureThreshold(
    projectId: string,
    failureClass?: FailureClassType,
  ): Promise<void> {
    const settings = await this.resolveSettings();

    if (!settings.enabled) {
      this.emitDisabledObservation(projectId, failureClass);
      return;
    }

    const orchestration =
      await this.orchestrations.findByproject_id(projectId);
    if (!orchestration) {
      this.emitNoOrchestrationObservation(projectId, failureClass);
      return;
    }

    const metadata = narrowMetadataRecord(orchestration.metadata);
    const previousCount =
      typeof metadata.consecutive_failure_count === "number"
        ? metadata.consecutive_failure_count
        : 0;
    const counted = shouldCountFailure(failureClass);

    if (!counted) {
      this.emitNotCountedObservation(
        projectId,
        failureClass,
        previousCount,
      );
      return;
    }

    const updateResult = await this.recordFailureObservation({
      projectId,
      failureClass,
      orchestration,
      metadata,
      previousCount,
      settings,
    });
    if (updateResult === null) {
      return;
    }

    if (updateResult.failureCountInWindow < settings.count) {
      this.logger.debug(
        `Project ${projectId} has ${updateResult.failureCountInWindow} failure(s) in window; threshold is ${settings.count} — skipping`,
      );
      return;
    }

    await this.maybeFireRetrospective({
      projectId,
      failureClass,
      orchestration,
      metadata,
      settings,
      failureCountInWindow: updateResult.failureCountInWindow,
      windowStartEpochSeconds: updateResult.windowStartEpochSeconds,
      newCount: updateResult.newCount,
    });
  }

  /**
   * Increment the consecutive-failure counter, prune / append the
   * failure-window timestamp list, and persist the orchestration
   * metadata. Returns the new count + window info on success, or
   * `null` on persistence failure (the caller emits the diagnostic
   * observation and bails out).
   */
  private async recordFailureObservation(params: {
    projectId: string;
    failureClass: FailureClassType | undefined;
    orchestration: {
      project_id: string;
      goals: string;
      mode: string;
      status: string;
      linked_run_id: string | null;
      decision_log: unknown;
      action_requests: unknown;
    };
    metadata: Record<string, unknown>;
    previousCount: number;
    settings: {
      count: number;
      windowSeconds: number;
      windowStrategy: "sliding" | "fixed";
    };
  }): Promise<{
    newCount: number;
    failureCountInWindow: number;
    windowStartEpochSeconds: number;
  } | null> {
    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    const windowStartEpochSeconds = computeWindowStartEpochSeconds(
      nowEpochSeconds,
      params.settings.windowSeconds,
      params.settings.windowStrategy,
    );
    const windowTimestamps = pruneAndAppendFailureTimestamp(
      getFailureTimestamps(params.metadata),
      nowEpochSeconds,
      params.settings.windowSeconds,
      params.settings.windowStrategy,
      windowStartEpochSeconds,
    );
    const failureCountInWindow = windowTimestamps.length;
    const newCount = params.previousCount + 1;

    params.metadata.consecutive_failure_count = newCount;
    params.metadata[FAILURE_TIMESTAMPS_METADATA_KEY] = windowTimestamps;

    if (!(await this.persistMetadata(params.orchestration, params.metadata))) {
      this.emitFailureObserved({
        projectId: params.projectId,
        failureClass: params.failureClass,
        counted: false,
        observationReason: "persistence_failed",
        consecutiveFailureCount: params.previousCount,
      });
      return null;
    }

    this.logger.debug(
      `Project ${params.projectId} consecutive_failure_count incremented from ${params.previousCount} to ${newCount} (windowCount=${failureCountInWindow})`,
    );
    this.emitFailureObserved({
      projectId: params.projectId,
      failureClass: params.failureClass,
      counted: true,
      observationReason: "counted",
      consecutiveFailureCount: newCount,
      threshold: params.settings.count,
    });
    return { newCount, failureCountInWindow, windowStartEpochSeconds };
  }

  /**
   * Apply the dedupe + cooldown suppression gates, persist the
   * last-emitted marker on fire, and delegate to
   * {@link KanbanRetrospectiveService.runForFailureThreshold}.
   */
  private async maybeFireRetrospective(params: {
    projectId: string;
    failureClass: FailureClassType | undefined;
    orchestration: {
      project_id: string;
      goals: string;
      mode: string;
      status: string;
      linked_run_id: string | null;
      decision_log: unknown;
      action_requests: unknown;
    };
    metadata: Record<string, unknown>;
    settings: {
      count: number;
      windowSeconds: number;
      cooldownSeconds: number;
      bypassCooldown: boolean;
      windowStrategy: "sliding" | "fixed";
    };
    failureCountInWindow: number;
    windowStartEpochSeconds: number;
    newCount: number;
  }): Promise<void> {
    const { projectId, metadata, settings } = params;
    const triggerRevisionMarker = `failure-threshold:${projectId}:${params.windowStartEpochSeconds}`;

    if (wasWindowAlreadyEmitted(metadata, projectId, params.windowStartEpochSeconds)) {
      this.logger.debug(
        `Project ${projectId} already emitted failure-threshold retrospective for window ${params.windowStartEpochSeconds}; skipping duplicate`,
      );
      return;
    }

    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    if (
      !settings.bypassCooldown &&
      isCooldownActive(metadata, settings.cooldownSeconds, nowEpochSeconds)
    ) {
      this.logger.debug(
        `Project ${projectId} failure-threshold cooldown active; skipping retrospective`,
      );
      return;
    }

    metadata[LAST_EMITTED_WINDOW_METADATA_KEY] = `${projectId}:${params.windowStartEpochSeconds}`;
    metadata[LAST_EMITTED_AT_METADATA_KEY] = nowEpochSeconds;
    await this.persistMetadata(params.orchestration, metadata);

    this.logger.log(
      `Project ${projectId} hit failure threshold (${params.failureCountInWindow} >= ${settings.count}) — triggering retrospective`,
    );

    await this.retrospectives.runForFailureThreshold({
      projectId,
      triggerRevisionMarker,
      idempotencyKey: triggerRevisionMarker,
      ...(settings.bypassCooldown
        ? {
            bypassCooldown: true,
            windowStartEpochSeconds: params.windowStartEpochSeconds,
          }
        : {}),
    });
  }

  private emitDisabledObservation(
    projectId: string,
    failureClass: FailureClassType | undefined,
  ): void {
    this.logger.debug(
      `Project ${projectId} failure-threshold trigger disabled (Enabled=false); skipping`,
    );
    this.emitFailureObserved({
      projectId,
      failureClass,
      counted: false,
      observationReason: "disabled",
      consecutiveFailureCount: 0,
    });
  }

  private emitNoOrchestrationObservation(
    projectId: string,
    failureClass: FailureClassType | undefined,
  ): void {
    this.logger.debug(
      `No orchestration exists for project ${projectId}; cannot evaluate failure threshold`,
    );
    this.emitFailureObserved({
      projectId,
      failureClass,
      counted: false,
      observationReason: "no_orchestration",
      consecutiveFailureCount: 0,
    });
  }

  private emitNotCountedObservation(
    projectId: string,
    failureClass: FailureClassType | undefined,
    previousCount: number,
  ): void {
    this.emitFailureObserved({
      projectId,
      failureClass,
      counted: false,
      observationReason: "intentional_class",
      consecutiveFailureCount: previousCount,
    });
    this.logger.debug(
      `Project ${projectId} observed ${failureClass ?? "uncategorised"} failure; not counting toward threshold (previousCount=${previousCount})`,
    );
  }

  /**
   * Resets the consecutive failure counter for a project back to 0.
   * Best-effort: persistence failures are logged and swallowed.
   */
  async resetConsecutiveFailureCount(projectId: string): Promise<void> {
    const orchestration =
      await this.orchestrations.findByproject_id(projectId);
    if (!orchestration) {
      return;
    }

    const metadata = narrowMetadataRecord(orchestration.metadata);
    if (metadata.consecutive_failure_count === 0) {
      return;
    }

    metadata.consecutive_failure_count = 0;
    metadata[FAILURE_TIMESTAMPS_METADATA_KEY] = undefined;
    metadata[LAST_EMITTED_WINDOW_METADATA_KEY] = undefined;
    metadata[LAST_EMITTED_AT_METADATA_KEY] = undefined;

    if (!(await this.persistMetadata(orchestration, metadata))) {
      this.logger.warn(
        `Failed to reset consecutive_failure_count for project ${projectId}: persistence failed`,
      );
      return;
    }
    this.logger.debug(
      `Project ${projectId} consecutive_failure_count reset to 0`,
    );
  }

  /**
   * Resolve the 6 failure-threshold settings with the documented
   * precedence chain (SystemSetting > env var > schema default).
   * SystemSettingsService is optional so legacy unit tests that
   * construct the service without a third argument still compile
   * and exercise the env-var / schema-default fallback chain.
   */
  private async resolveSettings(): Promise<FailureThresholdSettings> {
    const settings = {} as Record<keyof FailureThresholdSettings, FailureThresholdSettings[keyof FailureThresholdSettings]>;
    for (const spec of FAILURE_THRESHOLD_SETTINGS_SPECS) {
      settings[spec.destination] = await this.readSetting(spec.key, spec.envDefault());
    }
    return settings as FailureThresholdSettings;
  }

  private async readSetting<T>(
    key: RetrospectiveFailureThresholdSettingKey,
    envDefault: T,
  ): Promise<T> {
    if (!this.systemSettings) {
      return envDefault;
    }
    return this.systemSettings.get<T>(key, envDefault);
  }

  /**
   * Persist the orchestration metadata record. Returns `true` on
   * success, `false` on persistence failure (logged and swallowed
   * so a DB hiccup cannot break the orchestration cycle decision
   * path).
   */
  private async persistMetadata(
    orchestration: {
      project_id: string;
      goals: string;
      mode: string;
      status: string;
      linked_run_id: string | null;
      decision_log: unknown;
      action_requests: unknown;
    },
    metadata: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.orchestrations.save({
        project_id: orchestration.project_id,
        goals: orchestration.goals,
        mode: orchestration.mode,
        status: orchestration.status,
        linked_run_id: orchestration.linked_run_id,
        decision_log: orchestration.decision_log as never,
        action_requests: orchestration.action_requests as never,
        metadata,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to persist failure-threshold metadata for project ${orchestration.project_id}: ${formatUnknownErrorMessage(error)}`,
      );
      return false;
    }
  }

  /**
   * Emits a `kanban.retrospective.failure_observed` diagnostic event
   * via the in-process kanban event emitter. Best-effort.
   */
  private emitFailureObserved(payload: {
    readonly projectId: string;
    readonly failureClass: FailureClassType | undefined;
    readonly counted: boolean;
    readonly observationReason: string;
    readonly consecutiveFailureCount: number;
    readonly threshold?: number;
  }): void {
    const event = {
      event_name: KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT,
      scope_id: payload.projectId,
      failure_class: payload.failureClass ?? null,
      counted: payload.counted,
      observation_reason: payload.observationReason,
      consecutive_failure_count: payload.consecutiveFailureCount,
      ...(payload.threshold === undefined
        ? {}
        : { threshold: payload.threshold }),
      observed_at: new Date().toISOString(),
    };
    safeEmitKanbanEvent(
      KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT,
      event,
      this.logger,
    );
  }
}

/**
 * Type alias preserved for back-compat with any external consumer
 * that imported `FailureClass` from this module before the enum was
 * re-exported from `@nexus/core`. New code should import
 * `FailureClass` directly from `@nexus/core`.
 */
export { FailureClass };
