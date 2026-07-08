import type { PluginIsolationMode } from '@nexus/plugin-sdk';

export type PluginRuntimeHealthStatus =
  | 'starting'
  | 'healthy'
  | 'unhealthy'
  | 'crashed'
  | 'stopped';

export interface PluginRuntimeHealthIdentity {
  readonly pluginId: string;
  readonly version: string;
  readonly mode: PluginIsolationMode;
}

export interface PluginRuntimeHealthSummary extends PluginRuntimeHealthIdentity {
  readonly status: PluginRuntimeHealthStatus;
  readonly lastHealthCheckAt?: Date;
  readonly lastError?: {
    readonly code: string;
    readonly message: string;
    readonly occurredAt: Date;
  };
  readonly pendingRequests: number;
  readonly crashLooping: boolean;
  readonly crashCount?: number;
  readonly quarantined?: boolean;
}

export interface PluginRuntimeHealthEvent extends PluginRuntimeHealthIdentity {
  readonly occurredAt?: Date;
}

export interface PluginRuntimeHealthCheckEvent extends PluginRuntimeHealthEvent {
  readonly healthy: boolean;
  readonly details?: Record<string, unknown>;
}

export interface PluginRuntimeErrorHealthEvent extends PluginRuntimeHealthEvent {
  readonly code: string;
  readonly message: string;
}

export interface PluginRuntimeCrashLoopHealthEvent extends PluginRuntimeHealthIdentity {
  readonly crashCount: number;
  readonly quarantined: boolean;
}
