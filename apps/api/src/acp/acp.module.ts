import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { SecurityModule } from '../security/security.module';
import { AcpController } from './acp.controller';
import { AcpRuntimeManagerService } from './acp-runtime-manager.service';
import { AcpService } from './acp.service';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    ObservabilityModule,
    SecurityModule,
    ToolRegistryModule,
  ],
  controllers: [AcpController],
  providers: [AcpService, AcpRuntimeManagerService],
  exports: [AcpService, AcpRuntimeManagerService],
})
export class AcpModule {
  protected readonly _moduleName = 'AcpModule';
}
