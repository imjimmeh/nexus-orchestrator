import { Injectable } from '@nestjs/common';
import { PluginLifecycleService } from '../plugin-lifecycle.service';
import type {
  PluginRuntimeCrashEvent,
  PluginRuntimeCrashRecordResult,
  PluginRuntimeIdentity,
} from './plugin-runtime-supervisor.types';

const CRASH_LOOP_THRESHOLD = 3;
const CRASH_LOOP_WINDOW_MS = 10 * 60 * 1000;
const SUPERVISOR_ACTOR_ID = 'plugin-runtime-supervisor';

type CrashWindow = {
  readonly crashes: Date[];
  quarantined: boolean;
};

@Injectable()
export class PluginRuntimeSupervisorService {
  private readonly crashWindows = new Map<string, CrashWindow>();

  constructor(private readonly pluginLifecycle: PluginLifecycleService) {}

  async recordRuntimeCrash(
    event: PluginRuntimeCrashEvent,
  ): Promise<PluginRuntimeCrashRecordResult> {
    void event.rawError;
    const occurredAt = event.occurredAt ?? new Date();
    this.pruneStaleCrashWindows(occurredAt);

    const key = this.runtimeKey(event);
    const crashWindow = this.crashWindows.get(key) ?? {
      crashes: [],
      quarantined: false,
    };
    this.crashWindows.set(key, crashWindow);

    crashWindow.crashes.push(occurredAt);
    const windowStart = occurredAt.getTime() - CRASH_LOOP_WINDOW_MS;
    const crashesInWindow = crashWindow.crashes.filter(
      (crashAt) => crashAt.getTime() >= windowStart,
    );
    crashWindow.crashes.splice(
      0,
      crashWindow.crashes.length,
      ...crashesInWindow,
    );

    if (
      !crashWindow.quarantined &&
      crashesInWindow.length >= CRASH_LOOP_THRESHOLD
    ) {
      await this.pluginLifecycle.quarantinePlugin({
        pluginId: event.pluginId,
        version: event.version,
        actorId: SUPERVISOR_ACTOR_ID,
        reason: `Plugin runtime entered a crash loop in ${event.mode} isolation mode.`,
      });
      crashWindow.quarantined = true;
    }

    return {
      quarantined: crashWindow.quarantined,
      crashCount: crashesInWindow.length,
    };
  }

  recordRuntimeHealthy(identity: PluginRuntimeIdentity): void {
    this.crashWindows.delete(this.runtimeKey(identity));
  }

  getTrackedRuntimeCount(): number {
    return this.crashWindows.size;
  }

  private pruneStaleCrashWindows(now: Date): void {
    const staleBefore = now.getTime() - CRASH_LOOP_WINDOW_MS;

    for (const [key, crashWindow] of this.crashWindows.entries()) {
      const newestCrashAt = crashWindow.crashes.at(-1);
      if (!newestCrashAt || newestCrashAt.getTime() < staleBefore) {
        this.crashWindows.delete(key);
      }
    }
  }

  private runtimeKey(identity: PluginRuntimeIdentity): string {
    return `${identity.pluginId}\0${identity.version}\0${identity.mode}`;
  }
}
