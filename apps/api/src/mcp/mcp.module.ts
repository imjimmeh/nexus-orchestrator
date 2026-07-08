import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SecurityModule } from '../security/security.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { McpController } from './mcp.controller';
import { McpRuntimeManagerService } from './mcp-runtime-manager.service';
import { McpService } from './mcp.service';
import { McpTransportFactory } from './mcp-transport.factory';
import { McpHttpTransportClient } from './mcp-transport-http.client';
import { McpStdioTransportClient } from './mcp-transport-stdio.client';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    ObservabilityModule,
    SecurityModule,
    ToolRegistryModule,
  ],
  controllers: [McpController],
  providers: [
    McpService,
    McpRuntimeManagerService,
    McpTransportFactory,
    McpHttpTransportClient,
    McpStdioTransportClient,
  ],
  exports: [McpService, McpRuntimeManagerService],
})
export class McpModule {
  protected readonly _moduleName = 'McpModule';
}
