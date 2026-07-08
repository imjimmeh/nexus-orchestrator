import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule as CoreDatabaseModule } from '../../database/database.module';
import { DatabaseModule } from '../database/database.module';
import { ChatActionsModule } from '../chat-actions/chat-actions.module';
import { ChatMemoryModule } from '../memory/chat-memory.module';
import { CostGovernanceModule } from '../../cost-governance/cost-governance.module';
import { ChatSessionCollaborationController } from './chat-session-collaboration.controller';
import { ChatSessionCollaborationService } from './chat-session-collaboration.service';
import { ChatSessionsController } from './chat-sessions.controller';
import { ChatSessionsService } from './chat-sessions.service';

@Module({
  imports: [
    CoreDatabaseModule,
    DatabaseModule,
    ChatActionsModule,
    ChatMemoryModule,
    CostGovernanceModule,
    BullModule.registerQueue({
      name: 'chat-sessions',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
  ],
  controllers: [ChatSessionsController, ChatSessionCollaborationController],
  providers: [ChatSessionsService, ChatSessionCollaborationService],
  exports: [ChatSessionsService],
})
export class ChatSessionsModule {}
