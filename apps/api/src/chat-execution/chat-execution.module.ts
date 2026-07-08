import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { DockerModule } from '../docker/docker.module';
import { DatabaseModule } from '../database/database.module';
import { DatabaseModule as ChatDatabaseModule } from '../chat/database/database.module';
import { ChatExecutionService } from './chat-execution.service';
import { ChatSessionConsumer } from './chat-session.consumer';
import { ChatSessionCleanupService } from './chat-session-cleanup.service';
import { WorkflowRunChatSessionCascadeListener } from './workflow-run-chat-session-cascade.listener';
import { ChatSessionTerminalRouter } from './chat-session-terminal.router';
import { AgentTokenService } from './agent-token.service';
import { ContainerConfigBuilderService } from './container-config-builder.service';
import { SessionModule } from '../session/session.module';
import { SystemSettingsModule } from '../settings/system-settings.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { ToolRuntimeModule } from '../tool-runtime/tool-runtime.module';
import { CostGovernanceModule } from '../cost-governance/cost-governance.module';
import { containerUrlsConfig } from '../config/container-urls.config';
import { ExecutionLifecycleModule } from '../execution-lifecycle/execution-lifecycle.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';

@Module({
  imports: [
    AiConfigModule,
    DatabaseModule,
    ChatDatabaseModule,
    DockerModule,
    ConfigModule.forFeature(containerUrlsConfig),
    CostGovernanceModule,
    DomainEventsModule,
    ExecutionLifecycleModule,
    SessionModule,
    SystemSettingsModule,
    ToolRegistryModule,
    ToolRuntimeModule,
    BullModule.registerQueue({
      name: 'chat-sessions',
    }),
  ],
  providers: [
    AgentTokenService,
    ContainerConfigBuilderService,
    ChatExecutionService,
    ChatSessionConsumer,
    ChatSessionCleanupService,
    WorkflowRunChatSessionCascadeListener,
    ChatSessionTerminalRouter,
  ],
  exports: [ChatExecutionService, ChatSessionCleanupService],
})
export class ChatExecutionModule {}
