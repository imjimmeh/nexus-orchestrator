import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ChatMessage } from '../entities/chat-message.entity';
import type { ChatChannelProvider } from '../../channel-adapters/chat-channel-provider.types';

@Injectable()
export class ChatMessageRepository {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly repository: Repository<ChatMessage>,
  ) {}

  async findById(id: string): Promise<ChatMessage | null> {
    return this.repository.findOne({ where: { id } });
  }

  async create(data: Partial<ChatMessage>): Promise<ChatMessage> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: Partial<ChatMessage>,
  ): Promise<ChatMessage | null> {
    await this.repository.update(
      id,
      data as QueryDeepPartialEntity<ChatMessage>,
    );
    return this.findById(id);
  }

  async findBySessionId(chatSessionId: string): Promise<ChatMessage[]> {
    return this.repository.find({
      where: { chat_session_id: chatSessionId },
      order: { created_at: 'ASC' },
    });
  }

  async findByProviderMessage(params: {
    channel: string;
    providerMessageId: string;
  }): Promise<ChatMessage | null> {
    return this.repository.findOne({
      where: {
        channel: params.channel,
        provider_message_id: params.providerMessageId,
      },
    });
  }

  async findRecentSessionIdsByChannelIdentity(params: {
    channel: string;
    provider: string;
    externalThreadId: string;
    externalUserId: string;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.repository
      .createQueryBuilder('message')
      .select('message.chat_session_id', 'chatSessionId')
      .addSelect('MAX(message.created_at)', 'lastMessageAt')
      .where('message.channel = :channel', { channel: params.channel })
      .andWhere("message.metadata->>'provider' = :provider", {
        provider: params.provider,
      })
      .andWhere("message.metadata->>'externalThreadId' = :externalThreadId", {
        externalThreadId: params.externalThreadId,
      })
      .andWhere("message.metadata->>'externalUserId' = :externalUserId", {
        externalUserId: params.externalUserId,
      })
      .groupBy('message.chat_session_id')
      .orderBy('lastMessageAt', 'DESC')
      .limit(params.limit)
      .getRawMany<{ chatSessionId: string }>();

    return rows
      .map((row) => row.chatSessionId)
      .filter((sessionId) => typeof sessionId === 'string');
  }

  async hasChannelIdentityForSession(params: {
    chatSessionId: string;
    channel: string;
    provider: string;
    externalThreadId: string;
    externalUserId: string;
  }): Promise<boolean> {
    const matches = await this.repository
      .createQueryBuilder('message')
      .where('message.chat_session_id = :chatSessionId', {
        chatSessionId: params.chatSessionId,
      })
      .andWhere('message.channel = :channel', { channel: params.channel })
      .andWhere("message.metadata->>'provider' = :provider", {
        provider: params.provider,
      })
      .andWhere("message.metadata->>'externalThreadId' = :externalThreadId", {
        externalThreadId: params.externalThreadId,
      })
      .andWhere("message.metadata->>'externalUserId' = :externalUserId", {
        externalUserId: params.externalUserId,
      })
      .getCount();

    return matches > 0;
  }

  async findPendingRunLinks(chatSessionId: string): Promise<ChatMessage[]> {
    const terminalStatuses = ['COMPLETED', 'FAILED', 'CANCELLED'];

    return this.repository
      .createQueryBuilder('message')
      .where('message.chat_session_id = :chatSessionId', { chatSessionId })
      .andWhere('message.run_id IS NOT NULL')
      .andWhere(
        '(message.run_status IS NULL OR message.run_status NOT IN (:...terminalStatuses))',
        { terminalStatuses },
      )
      .orderBy('message.created_at', 'ASC')
      .getMany();
  }

  async findPendingRelayCandidates(
    provider: ChatChannelProvider,
    limit: number,
  ): Promise<ChatMessage[]> {
    return this.repository
      .createQueryBuilder('message')
      .where('message.direction = :direction', { direction: 'inbound' })
      .andWhere('message.channel = :channel', { channel: provider })
      .andWhere('message.event_type = :eventType', {
        eventType: 'user_message',
      })
      .andWhere('message.run_id IS NOT NULL')
      .andWhere(
        "(message.metadata IS NULL OR message.metadata->>'telegramRelaySentAt' IS NULL)",
      )
      .andWhere(
        "(message.metadata IS NULL OR message.metadata->>'telegramRelaySkippedAt' IS NULL)",
      )
      .orderBy('message.created_at', 'ASC')
      .limit(limit)
      .getMany();
  }

  async findTelegramRelayOutboundByInboundMessageId(
    inboundMessageId: string,
  ): Promise<ChatMessage | null> {
    return this.repository
      .createQueryBuilder('message')
      .where('message.direction = :direction', { direction: 'outbound' })
      .andWhere('message.channel = :channel', { channel: 'telegram' })
      .andWhere(
        "message.metadata->>'relayInboundMessageId' = :inboundMessageId",
        {
          inboundMessageId,
        },
      )
      .andWhere("message.metadata->>'relaySource' = :relaySource", {
        relaySource: 'telegram_outbound_relay',
      })
      .orderBy('message.created_at', 'DESC')
      .getOne();
  }
}
