import { Module } from '@nestjs/common';
import { CapabilityInfraModule } from '../capability-infra/capability-infra.module';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ToolRegistryService } from './tool-registry.service';
import { ToolValidationService } from './tool-validation.service';
import { ToolPayloadMapper } from './tool-payload.mapper';
import { ToolCatalogService } from './tool-catalog.service';
import { CapabilityRegistrarService } from './capability-registrar.service';
import { ToolTierPolicyService } from './tool-tier-policy.service';

@Module({
  imports: [CapabilityInfraModule, DatabaseModule, ObservabilityModule],
  providers: [
    ToolRegistryService,
    ToolValidationService,
    ToolPayloadMapper,
    ToolCatalogService,
    CapabilityRegistrarService,
    ToolTierPolicyService,
  ],
  exports: [
    ToolRegistryService,
    ToolValidationService,
    ToolPayloadMapper,
    ToolCatalogService,
    CapabilityRegistrarService,
    ToolTierPolicyService,
  ],
})
export class ToolRegistryModule {
  protected readonly _moduleName = 'ToolRegistryModule';
}
