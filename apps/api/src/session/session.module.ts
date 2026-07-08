import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { SessionHydrationService } from './session-hydration.service';
import { JSONLValidationService } from './jsonl-validation.service';
import { SessionCleanupService } from './session-cleanup.service';
import { ChatSessionContextService } from './chat-session-context.service';
import { ChatSessionContextRefreshListener } from './chat-session-context-refresh.listener';
import { DatabaseModule } from '../database/database.module';
import { DatabaseModule as ChatDatabaseModule } from '../chat/database/database.module';
import { DockerModule } from '../docker/docker.module';
import { RedisModule } from '../redis/redis.module';
import { SESSION_HYDRATION_SERVICE } from '../shared/interfaces/session-hydration.interface';
import { MemoryModule } from '../memory/memory.module';
import { SecurityModule } from '../security/security.module';
import { SystemPromptAssemblyModule } from '../system-prompt/system-prompt-assembly.module';

@Module({
  imports: [
    AiConfigModule,
    ChatDatabaseModule,
    DatabaseModule,
    DockerModule,
    RedisModule,
    forwardRef(() => MemoryModule),
    SecurityModule,
    SystemPromptAssemblyModule,
    // TELEMETRY_GATEWAY is resolved lazily via ModuleRef (strict:false) in
    // SessionHydrationService, so SessionModule does not import TelemetryModule —
    // that avoids the SessionModule <-> TelemetryModule cycle.
    BullModule.registerQueue({
      name: 'session-cleanup',
    }),
    BullModule.registerQueue({
      name: 'distillation',
    }),
  ],
  providers: [
    SessionHydrationService,
    JSONLValidationService,
    SessionCleanupService,
    ChatSessionContextService,
    ChatSessionContextRefreshListener,
    {
      provide: SESSION_HYDRATION_SERVICE,
      useExisting: SessionHydrationService,
    },
  ],
  exports: [
    SESSION_HYDRATION_SERVICE,
    SessionHydrationService,
    JSONLValidationService,
    ChatSessionContextService,
  ],
})
export class SessionModule {
  /** Session Hydration and State Management Module */
  protected readonly _moduleName = 'SessionModule';
}
