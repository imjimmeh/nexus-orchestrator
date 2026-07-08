import { Module } from '@nestjs/common';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { DockerModule } from '../../docker/docker.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { HostMountAuditService } from './host-mount-audit.service';
import { HostMountResolutionService } from './host-mount-resolution.service';
import { HostMountStartupValidationService } from './host-mount-startup-validation.service';
import { WorkflowHostMountRuntimeDiagnosticsService } from './workflow-host-mount-runtime-diagnostics.service';

@Module({
  imports: [
    AiConfigModule,
    DockerModule,
    ObservabilityModule,
    SystemSettingsModule,
  ],
  providers: [
    HostMountAuditService,
    HostMountResolutionService,
    HostMountStartupValidationService,
    WorkflowHostMountRuntimeDiagnosticsService,
  ],
  exports: [
    HostMountAuditService,
    HostMountResolutionService,
    HostMountStartupValidationService,
    WorkflowHostMountRuntimeDiagnosticsService,
  ],
})
export class WorkflowHostMountModule {}
