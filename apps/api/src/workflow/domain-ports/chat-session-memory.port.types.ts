import type { ChatSessionMemory } from '../../chat/database/entities/chat-session-memory.entity';

export interface IChatSessionMemoryPort {
  findRecentBySession(
    sessionId: string,
    limit?: number,
  ): Promise<ChatSessionMemory[]>;
}
