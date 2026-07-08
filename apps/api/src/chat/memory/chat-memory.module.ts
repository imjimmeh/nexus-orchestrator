import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseModule as CoreDatabaseModule } from '../../database/database.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { WorkflowRetrospectiveModule } from '../../workflow/workflow-retrospective/workflow-retrospective.module';
import { ChatMemoryContextAssemblerService } from './chat-memory-context-assembler.service';
import { ChatMemoryDistillationService } from './chat-memory-distillation.service';
import { ChatMemoryEventPublisherService } from './chat-memory-event-publisher.service';
import { ChatMemoryJobService } from './chat-memory-job.service';
import { ChatMemoryLifecycleService } from './chat-memory-lifecycle.service';
import { ChatMemoryMetricsService } from './chat-memory-metrics.service';
import { ChatMemoryObservabilityController } from './chat-memory-observability.controller';
import { ChatMemorySchemaBootstrapService } from './chat-memory-schema-bootstrap.service';
import { ChatSessionLearningFlushListener } from './chat-session-learning-flush.listener';

@Module({
  imports: [
    DatabaseModule,
    CoreDatabaseModule,
    SystemSettingsModule,
    forwardRef(() => WorkflowRetrospectiveModule),
  ],
  controllers: [ChatMemoryObservabilityController],
  providers: [
    ChatMemoryMetricsService,
    ChatMemoryEventPublisherService,
    ChatMemoryContextAssemblerService,
    ChatMemoryDistillationService,
    ChatMemorySchemaBootstrapService,
    ChatMemoryJobService,
    ChatMemoryLifecycleService,
    ChatSessionLearningFlushListener,
  ],
  exports: [ChatMemoryLifecycleService, ChatMemoryMetricsService],
})
export class ChatMemoryModule {}
