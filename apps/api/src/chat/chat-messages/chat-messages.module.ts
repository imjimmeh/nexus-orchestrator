import { Module } from '@nestjs/common';
import { DatabaseModule as CoreDatabaseModule } from '../../database/database.module';
import { DatabaseModule } from '../database/database.module';
import { ChatActionsModule } from '../chat-actions/chat-actions.module';
import { ChatMemoryModule } from '../memory/chat-memory.module';
import { TelemetryModule } from '../../telemetry/telemetry.module';
import { AttachmentsModule } from '../../attachments/attachments.module';
import { ChatMessagesController } from './chat-messages.controller';
import { ChatMessagesService } from './chat-messages.service';

@Module({
  imports: [
    CoreDatabaseModule,
    DatabaseModule,
    ChatActionsModule,
    ChatMemoryModule,
    TelemetryModule,
    AttachmentsModule,
  ],
  controllers: [ChatMessagesController],
  providers: [ChatMessagesService],
  exports: [ChatMessagesService],
})
export class ChatMessagesModule {}
