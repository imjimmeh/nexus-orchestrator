import { Injectable } from '@nestjs/common';
import { ChatSessionMemoryRepository } from '../../chat/database/repositories/chat-session-memory.repository';
import type { ChatSessionMemory } from '../../chat/database/entities/chat-session-memory.entity';
import type { IChatSessionMemoryPort } from './chat-session-memory.port.types';

@Injectable()
export class InProcessChatSessionMemoryAdapter implements IChatSessionMemoryPort {
  constructor(private readonly repo: ChatSessionMemoryRepository) {}

  findRecentBySession(
    sessionId: string,
    limit?: number,
  ): Promise<ChatSessionMemory[]> {
    return this.repo.findRecentBySession(sessionId, limit ?? 50);
  }
}
