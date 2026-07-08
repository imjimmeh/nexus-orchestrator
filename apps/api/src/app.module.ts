import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { CorrelationIdMiddleware } from '@nexus/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import path from 'node:path';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { DatabaseModule } from './database/database.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { RedisModule } from './redis/redis.module';
import { DockerModule } from './docker/docker.module';
import { ToolModule } from './tool/tool.module';
import { ChatModule } from './chat/chat.module';
import { WorkflowModule } from './workflow/workflow.module';
import { WorkflowRetrospectiveModule } from './workflow/workflow-retrospective/workflow-retrospective.module';
import { ImprovementModule } from './improvement/improvement.module';
import { SessionModule } from './session/session.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { MemoryModule } from './memory/memory.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AuthModule } from './auth/auth.module';
import { ObservabilityModule } from './observability/observability.module';
import { HealthModule } from './health/health.module';
import { AiConfigModule } from './ai-config/ai-config.module';
import { GitWorktreeModule } from './common/git/git-worktree.module';
import { SetupModule } from './setup/setup.module';
import { SystemSettingsModule } from './settings/system-settings.module';

import { AutomationModule } from './automation/automation.module';
import { McpModule } from './mcp/mcp.module';
import { AcpModule } from './acp/acp.module';
import { OperationsModule } from './operations/operations.module';
import { UsersModule } from './users/users.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ChatExecutionModule } from './chat-execution/chat-execution.module';
import { RuntimeFeedbackModule } from './runtime-feedback/runtime-feedback.module';
import { SelfImprovementModule } from './self-improvement/self-improvement.module';
import { PluginKernelModule } from './plugin-kernel/plugin-kernel.module';
import { CostGovernanceModule } from './cost-governance/cost-governance.module';
import { ScopeModule } from './scope/scope.module';
import { AuthorizationModule } from './auth/authorization/authorization.module';
import { InvitationModule } from './auth/invitations/invitation.module';
import { AuditModule } from './audit/audit.module';
import { ConfigResolutionModule } from './config-resolution/config-resolution.module';
import { GitOpsModule } from './gitops/gitops.module';
import { AppEventsModule } from './app-events/app-events.module';
import { DomainGatewayModule } from './domain-gateway/domain-gateway.module';
import { HarnessModule } from './harness/harness.module.js';
import { AttachmentsModule } from './attachments/attachments.module';
import { ExecutionLifecycleModule } from './execution-lifecycle/execution-lifecycle.module';
import { SystemPromptAssemblyModule } from './system-prompt/system-prompt-assembly.module';
import { ShutdownStateModule } from './shutdown/shutdown-state.module';
import { VariablesModule } from './variables/variables.module';
import { IntegrationEventsModule } from './integration-events/integration-events.module';
import { WorkflowRuntimeToolchainsModule } from './workflow/workflow-runtime-toolchains/workflow-runtime-toolchains.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/validation.schema';

const apiDir = path.resolve(__dirname, '..');
const repoRootDir = path.resolve(__dirname, '../../..');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: [
        path.join(apiDir, '.env.local'),
        path.join(apiDir, '.env'),
        path.join(repoRootDir, '.env.local'),
        path.join(repoRootDir, '.env'),
      ],
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 300,
      },
    ]),
    DatabaseModule,
    BootstrapModule,
    RedisModule,
    DockerModule,
    WorkflowRuntimeToolchainsModule,
    ToolModule,
    ChatModule,
    WorkflowModule,
    ImprovementModule,
    WorkflowRetrospectiveModule,
    SystemPromptAssemblyModule,
    SessionModule,
    TelemetryModule,
    MemoryModule,
    WebhooksModule,
    AuthModule,
    AiConfigModule,
    GitWorktreeModule,
    ObservabilityModule,
    HealthModule,
    SetupModule,
    SystemSettingsModule,
    AutomationModule,
    McpModule,
    AcpModule,
    OperationsModule,
    UsersModule,
    NotificationsModule,
    ChatExecutionModule,
    RuntimeFeedbackModule,
    SelfImprovementModule,
    PluginKernelModule,
    CostGovernanceModule,
    ScopeModule,
    AuthorizationModule,
    InvitationModule,
    AuditModule,
    ConfigResolutionModule,
    GitOpsModule,
    AppEventsModule,
    DomainGatewayModule,
    HarnessModule,
    AttachmentsModule,
    ExecutionLifecycleModule,
    ShutdownStateModule,
    VariablesModule,
    IntegrationEventsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  /** Main application module */
  protected readonly _moduleName = 'AppModule';

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
