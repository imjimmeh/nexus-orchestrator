import { Injectable } from '@nestjs/common';
import { CapabilityRegistryService } from '../capability-infra/capability-registry.service';
import type { CapabilityManifestEntry } from '../capability-infra/capability-manifest.types';

@Injectable()
export class ToolCatalogService {
  constructor(private readonly capabilityRegistry: CapabilityRegistryService) {}

  getBuiltInCapabilityEntries(): CapabilityManifestEntry[] {
    return this.capabilityRegistry.getDiscoveredEntries();
  }
}
