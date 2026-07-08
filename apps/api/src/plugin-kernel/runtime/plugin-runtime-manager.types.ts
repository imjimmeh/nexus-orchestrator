import type { PluginIsolationMode } from '@nexus/plugin-sdk';

export type RuntimeIdentity = {
  readonly pluginId: string;
  readonly version: string;
  readonly mode: PluginIsolationMode;
};
