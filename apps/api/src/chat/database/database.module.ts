import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatChannelRoute } from './entities/chat-channel-route.entity';
import { ChatMemoryEvent } from './entities/chat-memory-event.entity';
import { ChatMemoryJob } from './entities/chat-memory-job.entity';
import { ChatMemoryPromotionAudit } from './entities/chat-memory-promotion-audit.entity';
import { ChatProfileMemory } from './entities/chat-profile-memory.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSessionParticipant } from './entities/chat-session-participant.entity';
import { ChatSessionMemory } from './entities/chat-session-memory.entity';
import { Notification } from '../../notifications/database/entities/notification.entity';
import { ChatChannelRouteRepository } from './repositories/chat-channel-route.repository';
import { ChatMemoryEventRepository } from './repositories/chat-memory-event.repository';
import { ChatMemoryJobRepository } from './repositories/chat-memory-job.repository';
import { ChatMemoryPromotionAuditRepository } from './repositories/chat-memory-promotion-audit.repository';
import { ChatProfileMemoryRepository } from './repositories/chat-profile-memory.repository';
import { ChatMessageRepository } from './repositories/chat-message.repository';
import { ChatSessionParticipantRepository } from './repositories/chat-session-participant.repository';
import { ChatSessionMemoryRepository } from './repositories/chat-session-memory.repository';
import { NotificationRepository } from './repositories/notification.repository';

const entities = [
  ChatSessionParticipant,
  ChatChannelRoute,
  ChatMessage,
  ChatSessionMemory,
  ChatProfileMemory,
  ChatMemoryPromotionAudit,
  ChatMemoryJob,
  ChatMemoryEvent,
  Notification,
];
const repositories = [
  ChatSessionParticipantRepository,
  ChatChannelRouteRepository,
  ChatMessageRepository,
  ChatSessionMemoryRepository,
  ChatProfileMemoryRepository,
  ChatMemoryPromotionAuditRepository,
  ChatMemoryJobRepository,
  ChatMemoryEventRepository,
  NotificationRepository,
];

@Module({
  imports: [TypeOrmModule.forFeature(entities)],
  providers: [...repositories],
  exports: [TypeOrmModule, ...repositories],
})
export class DatabaseModule {
  protected readonly _moduleName = 'DatabaseModule';
}
