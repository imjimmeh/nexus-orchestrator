import { describe, expect, it } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ToolRegistryModule } from './tool-registry.module';
import { ToolRegistryService } from './tool-registry.service';
import { ToolValidationService } from './tool-validation.service';
import { ToolPayloadMapper } from './tool-payload.mapper';
import { ToolCatalogService } from './tool-catalog.service';
import { CapabilityRegistrarService } from './capability-registrar.service';
import { ToolTierPolicyService } from './tool-tier-policy.service';

describe('ToolRegistryModule', () => {
  it('owns registry providers and exports', () => {
    const providers =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ToolRegistryModule) ?? [];
    const exportsList =
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, ToolRegistryModule) ?? [];

    expect(providers).toEqual(
      expect.arrayContaining([
        ToolRegistryService,
        ToolValidationService,
        ToolPayloadMapper,
        ToolCatalogService,
        CapabilityRegistrarService,
        ToolTierPolicyService,
      ]),
    );
    expect(exportsList).toEqual(
      expect.arrayContaining([
        ToolRegistryService,
        ToolValidationService,
        ToolPayloadMapper,
        ToolCatalogService,
        CapabilityRegistrarService,
        ToolTierPolicyService,
      ]),
    );
  });
});
