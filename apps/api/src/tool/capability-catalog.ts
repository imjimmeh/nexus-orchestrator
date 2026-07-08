import { Injectable } from '@nestjs/common';
import { IToolRegistry } from '@nexus/core';
import { CapabilityManifestEntry } from '../capability-infra/capability-manifest.types';
import { CapabilityRegistryService } from '../capability-infra/capability-registry.service';

@Injectable()
export class CapabilityCatalogService {
  constructor(private readonly registry: CapabilityRegistryService) {}

  getCapabilityManifest(): ReadonlyArray<CapabilityManifestEntry> {
    return this.registry.getDiscoveredEntries();
  }

  getCapabilityByName(name: string): CapabilityManifestEntry | undefined {
    return this.getCapabilityManifest().find((entry) => entry.name === name);
  }

  getSeededCapabilityEntries(): CapabilityManifestEntry[] {
    return this.getCapabilityManifest().filter(
      (entry) => entry.seedInRegistry !== false,
    );
  }

  getRunnerRuntimeCapabilityNames(): string[] {
    return this.registry
      .getDiscoveredEntries()
      .filter((entry) => entry.runtimeOwner === 'runner')
      .map((entry) => entry.name);
  }

  toToolRegistryPayloads(): Partial<IToolRegistry>[] {
    return this.getSeededCapabilityEntries().map((entry) => ({
      name: entry.name,
      tier_restriction: entry.tierRestriction,
      schema: entry.schema,
      typescript_code: entry.typescriptCode,
      runtime_owner: entry.runtimeOwner,
      transport: entry.transport,
      api_callback: entry.apiCallback
        ? {
            method: entry.apiCallback.method,
            path_template: entry.apiCallback.pathTemplate,
            body_mapping: entry.apiCallback.bodyMapping,
          }
        : undefined,
    }));
  }
}
