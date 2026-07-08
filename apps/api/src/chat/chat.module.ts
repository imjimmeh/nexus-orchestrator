import { Module } from '@nestjs/common';
import { ChatSessionsModule } from './chat-sessions/chat-sessions.module';
import { ChatMessagesModule } from './chat-messages/chat-messages.module';
import { ChannelAdaptersModule } from './channel-adapters/channel-adapters.module';
import { ChatMemoryModule } from './memory/chat-memory.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ChatActionsModule } from './chat-actions/chat-actions.module';
import { RequestContextModule } from './common/request-context.module';

@Module({
  imports: [
    RequestContextModule,
    ChatSessionsModule,
    ChatMessagesModule,
    ChannelAdaptersModule,
    ChatMemoryModule,
    NotificationsModule,
    ChatActionsModule,
  ],
  exports: [
    ChatSessionsModule,
    ChatMessagesModule,
    ChannelAdaptersModule,
    ChatActionsModule,
  ],
})
export class ChatModule {}
