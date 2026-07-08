import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatChannelRoute } from '../entities/chat-channel-route.entity';
import type {
  ChatChannelRouteIdentity,
  UpsertActiveChatChannelRouteInput,
} from './chat-channel-route.repository.types';

@Injectable()
export class ChatChannelRouteRepository {
  constructor(
    @InjectRepository(ChatChannelRoute)
    private readonly repository: Repository<ChatChannelRoute>,
  ) {}

  async findByIdentity(
    identity: ChatChannelRouteIdentity,
  ): Promise<ChatChannelRoute | null> {
    return this.repository.findOne({
      where: {
        provider: identity.provider,
        external_thread_id: identity.externalThreadId,
        external_user_id: identity.externalUserId,
      },
    });
  }

  async findActiveSessionId(
    identity: ChatChannelRouteIdentity,
  ): Promise<string | null> {
    const route = await this.findByIdentity(identity);
    return route?.active_chat_session_id ?? null;
  }

  async upsertActiveSession(
    input: UpsertActiveChatChannelRouteInput,
  ): Promise<void> {
    const lastAccessedAt = input.lastAccessedAt ?? new Date();

    await this.repository.upsert(
      {
        provider: input.provider,
        external_thread_id: input.externalThreadId,
        external_user_id: input.externalUserId,
        active_chat_session_id: input.activeChatSessionId,
        last_accessed_at: lastAccessedAt,
        updated_at: new Date(),
      },
      ['provider', 'external_thread_id', 'external_user_id'],
    );
  }
}
