import { MODULE_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { CapabilityInfraModule } from './capability-infra.module';
import { CapabilityRegistryService } from './capability-registry.service';

describe('CapabilityInfraModule', () => {
  it('owns capability discovery and registry infrastructure', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      CapabilityInfraModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      CapabilityInfraModule,
    ) as unknown[];
    const exportsMetadata = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      CapabilityInfraModule,
    ) as unknown[];

    expect(imports).toContain(DiscoveryModule);
    expect(providers).toContain(CapabilityRegistryService);
    expect(exportsMetadata).toContain(CapabilityRegistryService);
  });
});
