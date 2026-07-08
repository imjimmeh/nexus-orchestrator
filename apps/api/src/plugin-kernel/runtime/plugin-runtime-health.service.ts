import { Injectable } from '@nestjs/common';
import type {
  PluginRuntimeCrashLoopHealthEvent,
  PluginRuntimeErrorHealthEvent,
  PluginRuntimeHealthCheckEvent,
  PluginRuntimeHealthEvent,
  PluginRuntimeHealthIdentity,
  PluginRuntimeHealthStatus,
  PluginRuntimeHealthSummary,
} from './plugin-runtime-health.types';

const SAFE_RUNTIME_ERROR_MESSAGE = 'Plugin runtime call failed.';

type RuntimeHealthRecord = {
  status: PluginRuntimeHealthStatus;
  lastHealthCheckAt?: Date;
  lastError?: PluginRuntimeHealthSummary['lastError'];
  pendingRequests: number;
  crashLooping: boolean;
  crashCount?: number;
  quarantined?: boolean;
};

@Injectable()
export class PluginRuntimeHealthService {
  private readonly records = new Map<string, RuntimeHealthRecord>();

  recordStartup(event: PluginRuntimeHealthEvent): void {
    const record = this.getOrCreateRecord(event);
    record.status = 'starting';
    record.lastError = undefined;
  }

  recordRequestStarted(event: PluginRuntimeHealthIdentity): void {
    const record = this.getOrCreateRecord(event);
    record.pendingRequests += 1;
  }

  recordRequestFinished(event: PluginRuntimeHealthIdentity): void {
    const record = this.getOrCreateRecord(event);
    record.pendingRequests = Math.max(0, record.pendingRequests - 1);
  }

  recordHealthCheck(event: PluginRuntimeHealthCheckEvent): void {
    void event.details;
    const record = this.getOrCreateRecord(event);
    record.status = event.healthy ? 'healthy' : 'unhealthy';
    record.lastHealthCheckAt = event.occurredAt ?? new Date();
    if (event.healthy) {
      record.lastError = undefined;
      record.crashLooping = false;
      record.crashCount = undefined;
      record.quarantined = undefined;
    }
  }

  recordError(event: PluginRuntimeErrorHealthEvent): void {
    const record = this.getOrCreateRecord(event);
    record.status = 'crashed';
    record.lastError = {
      code: event.code,
      message: SAFE_RUNTIME_ERROR_MESSAGE,
      occurredAt: event.occurredAt ?? new Date(),
    };
  }

  recordCrashLoop(event: PluginRuntimeCrashLoopHealthEvent): void {
    const record = this.getOrCreateRecord(event);
    record.crashLooping = event.quarantined || event.crashCount >= 3;
    record.crashCount = event.crashCount;
    record.quarantined = event.quarantined;
  }

  recordShutdown(event: PluginRuntimeHealthIdentity): void {
    const record = this.getOrCreateRecord(event);
    record.status = 'stopped';
    record.pendingRequests = 0;
  }

  getRuntimeHealthSummary(
    identity: PluginRuntimeHealthIdentity,
  ): PluginRuntimeHealthSummary | undefined {
    const record = this.records.get(this.runtimeKey(identity));
    if (!record) return undefined;

    return {
      ...identity,
      status: record.status,
      ...(record.lastHealthCheckAt
        ? { lastHealthCheckAt: record.lastHealthCheckAt }
        : {}),
      ...(record.lastError ? { lastError: record.lastError } : {}),
      pendingRequests: record.pendingRequests,
      crashLooping: record.crashLooping,
      ...(record.crashCount === undefined
        ? {}
        : { crashCount: record.crashCount }),
      ...(record.quarantined === undefined
        ? {}
        : { quarantined: record.quarantined }),
    };
  }

  getAllRuntimeHealthSummaries(): readonly PluginRuntimeHealthSummary[] {
    return [...this.records.entries()].map(([key, record]) => {
      const [pluginId, version, mode] = key.split('\0');
      return {
        pluginId,
        version,
        mode: mode as PluginRuntimeHealthIdentity['mode'],
        status: record.status,
        ...(record.lastHealthCheckAt
          ? { lastHealthCheckAt: record.lastHealthCheckAt }
          : {}),
        ...(record.lastError ? { lastError: record.lastError } : {}),
        pendingRequests: record.pendingRequests,
        crashLooping: record.crashLooping,
        ...(record.crashCount === undefined
          ? {}
          : { crashCount: record.crashCount }),
        ...(record.quarantined === undefined
          ? {}
          : { quarantined: record.quarantined }),
      };
    });
  }

  private getOrCreateRecord(
    identity: PluginRuntimeHealthIdentity,
  ): RuntimeHealthRecord {
    const key = this.runtimeKey(identity);
    const existing = this.records.get(key);
    if (existing) return existing;

    const created: RuntimeHealthRecord = {
      status: 'starting',
      pendingRequests: 0,
      crashLooping: false,
    };
    this.records.set(key, created);
    return created;
  }

  private runtimeKey(identity: PluginRuntimeHealthIdentity): string {
    return `${identity.pluginId}\0${identity.version}\0${identity.mode}`;
  }
}
