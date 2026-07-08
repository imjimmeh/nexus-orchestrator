import type { IToolRegistry, ToolRegistrySource } from '@nexus/core';
import type { CapabilityManifestEntry } from './capability-manifest.types';

export type CanonicalCapabilitySource = ToolRegistrySource;

export interface CanonicalCapabilityDefinition extends CapabilityManifestEntry {
  source: CanonicalCapabilitySource;
  sourceMetadata?: Record<string, unknown>;
}

export interface CanonicalCapabilityRegistrationSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  conflicts: string[];
}

export interface ToolProjectionRegistrationRequest {
  tool: Partial<IToolRegistry>;
  source: CanonicalCapabilitySource;
  sourceMetadata?: Record<string, unknown>;
}
