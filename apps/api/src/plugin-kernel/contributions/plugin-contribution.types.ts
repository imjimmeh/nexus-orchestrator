import type {
  PluginContribution,
  PluginContributionType,
  PluginIsolationMode,
} from '@nexus/plugin-sdk';

export type PluginContributionProjectionStatus = 'pending';

export interface PluginContributionValidationResult {
  status: 'valid';
}

export interface PluginContributionRuntimeTarget {
  pluginId: string;
  version: string;
  contributionId: string;
  operation: string;
}

export interface PluginContributionInventoryEntry {
  pluginId: string;
  version: string;
  contributionId: string;
  type: PluginContributionType;
  displayName: string;
  contribution: PluginContribution;
  runtimeTarget: PluginContributionRuntimeTarget;
  isolationMode: PluginIsolationMode;
  permissions: Array<Record<string, unknown>>;
  projectionStatus: PluginContributionProjectionStatus;
  lastValidationResult: PluginContributionValidationResult;
  globalCapabilityName: string;
}

export interface InvalidPluginContributionInventoryEntry {
  pluginId: string;
  version: string;
  contributionId: string;
  type: PluginContributionType | 'invalid';
  displayName: string;
  contribution: unknown;
  runtimeTarget: PluginContributionRuntimeTarget;
  isolationMode: PluginIsolationMode;
  permissions: Array<Record<string, unknown>>;
  projectionStatus: PluginContributionProjectionStatus;
  lastValidationResult: {
    status: 'invalid';
    errorMessage: string;
  };
  globalCapabilityName: string;
}

export type PluginContributionProjectionInventoryEntry =
  | PluginContributionInventoryEntry
  | InvalidPluginContributionInventoryEntry;

export interface PluginContributionCleanupRequest {
  pluginId: string;
  version?: string;
}

export interface PluginContributionCleanupCandidate {
  pluginId: string;
  version: string;
  contributionId: string;
  type: PluginContributionType;
  globalCapabilityName: string;
  projectionStatus: PluginContributionProjectionStatus;
}
