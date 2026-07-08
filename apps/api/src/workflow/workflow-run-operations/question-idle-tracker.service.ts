import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { SystemSettingsService } from '../../settings/system-settings.service';

export type { IdleCallbacks } from './question-idle-tracker.service.types';
import type { IdleCallbacks } from './question-idle-tracker.service.types';

interface TrackedEntry {
  containerId: string;
  stopTimer: ReturnType<typeof setTimeout> | null;
  removeTimer: ReturnType<typeof setTimeout> | null;
}

@Injectable()
export class QuestionIdleTrackerService implements OnModuleDestroy {
  private readonly logger = new Logger(QuestionIdleTrackerService.name);
  private readonly tracked = new Map<string, TrackedEntry>();
  private callbacks: IdleCallbacks | null = null;

  constructor(private readonly settings: SystemSettingsService) {}

  /**
   * Register the callbacks invoked when idle thresholds are exceeded.
   * Must be called once during module init (from the telemetry gateway or workflow module).
   */
  registerCallbacks(callbacks: IdleCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Begin tracking a workflow run whose agent is waiting for user input.
   * Starts two timers:
   * - stop timer: dehydrate/stop the container after `question_idle_stop_seconds`
   * - remove timer: remove the container after `question_idle_remove_seconds`
   */
  async trackQuestionsPosed(
    workflowRunId: string,
    containerId: string,
  ): Promise<void> {
    this.clearTracking(workflowRunId);

    const stopSeconds = await this.settings.get(
      'question_idle_stop_seconds',
      300,
    );
    const removeSeconds = await this.settings.get(
      'question_idle_remove_seconds',
      3600,
    );

    const entry: TrackedEntry = {
      containerId,
      stopTimer: null,
      removeTimer: null,
    };

    if (stopSeconds > 0) {
      entry.stopTimer = setTimeout(() => {
        this.logger.log(
          `Idle stop threshold (${stopSeconds}s) reached for run ${workflowRunId}, container ${containerId}`,
        );
        void this.callbacks?.onStop(workflowRunId, containerId);
      }, stopSeconds * 1000);
    }

    if (removeSeconds > 0) {
      entry.removeTimer = setTimeout(() => {
        this.logger.log(
          `Idle remove threshold (${removeSeconds}s) reached for run ${workflowRunId}, container ${containerId}`,
        );
        void this.callbacks?.onRemove(workflowRunId, containerId);
      }, removeSeconds * 1000);
    }

    this.tracked.set(workflowRunId, entry);
  }

  /**
   * Cancel all idle timers for a workflow run (e.g. user answered, or container disconnected).
   */
  clearTracking(workflowRunId: string): void {
    const entry = this.tracked.get(workflowRunId);
    if (!entry) return;

    if (entry.stopTimer) clearTimeout(entry.stopTimer);
    if (entry.removeTimer) clearTimeout(entry.removeTimer);
    this.tracked.delete(workflowRunId);
  }

  /** Returns true if the given workflow run is currently being tracked. */
  isTracking(workflowRunId: string): boolean {
    return this.tracked.has(workflowRunId);
  }

  onModuleDestroy(): void {
    for (const [runId] of this.tracked) {
      this.clearTracking(runId);
    }
  }
}
