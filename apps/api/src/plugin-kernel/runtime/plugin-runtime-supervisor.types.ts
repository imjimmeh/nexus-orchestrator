import type { PluginIsolationMode } from '@nexus/plugin-sdk';

export interface PluginRuntimeCrashEvent {
  readonly pluginId: string;
  readonly version: string;
  readonly mode: PluginIsolationMode;
  readonly occurredAt?: Date;
  readonly rawError?: unknown;
}

export interface PluginRuntimeIdentity {
  readonly pluginId: string;
  readonly version: string;
  readonly mode: PluginIsolationMode;
}

export interface PluginRuntimeCrashRecordResult {
  readonly quarantined: boolean;
  readonly crashCount: number;
}
