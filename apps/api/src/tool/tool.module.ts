import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { CapabilityGovernanceModule } from '../capability-governance/capability-governance.module';
import { CapabilityInfraModule } from '../capability-infra/capability-infra.module';
import { DatabaseModule } from '../database/database.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { ToolRuntimeModule } from '../tool-runtime/tool-runtime.module';
import { ToolController } from './tool.controller';
import { ToolSeederService } from './tool-seeder.service';
import { CapabilityContractValidatorService } from './capability-contract-validator.service';
import { ArtifactCapabilityProvider } from './providers/artifact-capability.provider';
import { SkillLifecycleCapabilityProvider } from './providers/skill-lifecycle-capability.provider';
import { ToolLifecycleCapabilityProvider } from './providers/tool-lifecycle-capability.provider';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    CapabilityInfraModule,
    CapabilityGovernanceModule,
    DatabaseModule,
    ToolRegistryModule,
    ToolRuntimeModule,
  ],
  providers: [
    ToolSeederService,
    CapabilityContractValidatorService,
    ArtifactCapabilityProvider,
    SkillLifecycleCapabilityProvider,
    ToolLifecycleCapabilityProvider,
  ],
  controllers: [ToolController],
  exports: [CapabilityContractValidatorService],
})
export class ToolModule {
  /** AI Tool registration and validation module */
  protected readonly _moduleName = 'ToolModule';
}
