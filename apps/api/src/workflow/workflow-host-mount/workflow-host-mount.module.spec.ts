import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { SecretVaultService } from '../../security/secret-vault.service';
import { SecretStoreRepository } from '../../security/database/repositories/secret-store.repository';
import { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { SystemSettingsRepository } from '../../settings/system-settings.repository';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { HostMountAuditService } from './host-mount-audit.service';
import { HostMountResolutionService } from './host-mount-resolution.service';
import { HostMountStartupValidationService } from './host-mount-startup-validation.service';
import { WorkflowHostMountRuntimeDiagnosticsService } from './workflow-host-mount-runtime-diagnostics.service';
import { WorkflowHostMountModule } from './workflow-host-mount.module';
import { AuthModule } from '../../auth/auth.module';
import { AuthorizationModule } from '../../auth/authorization/authorization.module';

@Module({})
class MockAuthorizationModule {}

@Module({})
class MockAuthModule {}

@Module({})
class MockSystemSettingsModule {}

@Module({})
class MockAiConfigModule {}

@Module({})
class MockDatabaseModule {}

@Global()
@Module({
  providers: [
    {
      provide: AiConfigurationService,
      useValue: { getAgentProfileByName: vi.fn() },
    },
    {
      provide: EventLedgerService,
      useValue: { emitBestEffort: vi.fn() },
    },
    {
      provide: ContainerOrchestratorService,
      useValue: { getContainerHostMountBindings: vi.fn() },
    },
    {
      provide: DOCKER_CLIENT,
      useValue: { listContainers: vi.fn(), getContainer: vi.fn() },
    },
    {
      provide: SecretStoreRepository,
      useValue: {},
    },
    {
      provide: SecretVaultService,
      useValue: {},
    },
    {
      provide: ConfigService,
      useValue: { get: vi.fn() },
    },
  ],
  exports: [
    AiConfigurationService,
    EventLedgerService,
    ContainerOrchestratorService,
    DOCKER_CLIENT,
    SecretStoreRepository,
    SecretVaultService,
    ConfigService,
  ],
})
class WorkflowHostMountTestDependenciesModule {}

describe('WorkflowHostMountModule', () => {
  it('compiles and resolves the public host mount services', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        WorkflowHostMountTestDependenciesModule,
        WorkflowHostMountModule,
      ],
    })
      .overrideModule(AiConfigModule)
      .useModule(MockAiConfigModule)
      .overrideModule(AuthModule)
      .useModule(MockAuthModule)
      .overrideModule(AuthorizationModule)
      .useModule(MockAuthorizationModule)
      .overrideModule(SystemSettingsModule)
      .useModule(MockSystemSettingsModule)
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .overrideProvider(SystemSettingsRepository)
      .useValue({ findAll: vi.fn(), findByKey: vi.fn(), upsert: vi.fn() })
      .overrideProvider(SystemSettingsService)
      .useValue({ get: vi.fn(), seedDefaults: vi.fn() })
      .useMocker(() => ({}))
      .compile();

    expect(moduleRef.get(HostMountResolutionService)).toBeInstanceOf(
      HostMountResolutionService,
    );
    expect(moduleRef.get(HostMountAuditService)).toBeInstanceOf(
      HostMountAuditService,
    );
    expect(moduleRef.get(HostMountStartupValidationService)).toBeInstanceOf(
      HostMountStartupValidationService,
    );
    expect(
      moduleRef.get(WorkflowHostMountRuntimeDiagnosticsService),
    ).toBeInstanceOf(WorkflowHostMountRuntimeDiagnosticsService);
  });
});
