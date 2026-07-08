import type {
  PluginLifecycleState,
  PluginIsolationMode,
  PluginManifest,
  PluginTrustLevel,
} from '@nexus/plugin-sdk';
import type { PluginSourceType } from './database/entities/plugin-registry-entry.types';

export interface DiscoveredPluginPackage {
  pluginId: string;
  version: string;
  source: string;
  sourceType: PluginSourceType;
  manifest: PluginManifest;
}

export interface DiscoverPackageOptions {
  source: string;
  sourceType?: PluginSourceType;
}

export interface InstallPluginOptions extends DiscoverPackageOptions {
  manifest: unknown;
  actorId: string;
  trustLevel?: PluginTrustLevel;
  isolationMode?: PluginIsolationMode;
}

export interface PluginIdentityOperationOptions {
  pluginId: string;
  version: string;
  actorId: string;
}

export interface ScanPluginOptions extends PluginIdentityOperationOptions {
  scanResult?: Record<string, unknown>;
  compatibilityResult?: Record<string, unknown>;
}

export interface QuarantinePluginOptions extends PluginIdentityOperationOptions {
  reason?: string;
}

export interface ListPluginFilters {
  state?: PluginLifecycleState;
  enabled?: boolean;
  trustLevel?: PluginTrustLevel;
}
