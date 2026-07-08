import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  ChatMemoryEventEnvelopeV1Schema,
  type ChatMemoryEventEnvelopeV1Shape,
  type ChatMemoryEventTypeV1,
} from '@nexus/core';
import { ChatMemoryEventRepository } from '../database/repositories/chat-memory-event.repository';

@Injectable()
export class ChatMemoryEventPublisherService {
  private readonly logger = new Logger(ChatMemoryEventPublisherService.name);

  constructor(private readonly events: ChatMemoryEventRepository) {}

  async publish(params: {
    eventType: ChatMemoryEventTypeV1;
    correlationId: string;
    chatSessionId: string;
    memoryId: string;
    action: 'promoted' | 'updated' | 'archived';
    profileId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<ChatMemoryEventEnvelopeV1Shape> {
    const envelope = ChatMemoryEventEnvelopeV1Schema.parse({
      event_id: randomUUID(),
      event_type: params.eventType,
      event_version: 'v1',
      occurred_at: new Date().toISOString(),
      correlation_id: params.correlationId,
      source_service: 'chat',
      payload: {
        chat_session_id: params.chatSessionId,
        memory_id: params.memoryId,
        action: params.action,
        profile_id: params.profileId ?? null,
      },
      metadata: params.metadata ?? null,
    });

    await this.events.create({
      event_id: envelope.event_id,
      event_type: envelope.event_type,
      correlation_id: envelope.correlation_id,
      chat_session_id: envelope.payload.chat_session_id,
      memory_id: envelope.payload.memory_id,
      action: envelope.payload.action,
      profile_id: envelope.payload.profile_id ?? null,
      envelope,
    });

    this.logger.log(
      `Emitted chat memory event ${envelope.event_type} for session ${params.chatSessionId}`,
    );

    return envelope;
  }
}
