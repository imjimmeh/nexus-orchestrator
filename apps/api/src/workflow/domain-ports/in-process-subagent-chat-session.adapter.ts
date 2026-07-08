import { Injectable, Logger } from '@nestjs/common';
import { buildChatSessionCreatePayload } from '../../chat/chat-sessions/chat-sessions.mappers';
import { ChatSessionRepository } from '../../chat/database/repositories/chat-session.repository';
import type {
  ISubagentChatSessionPort,
  SubagentChatSessionCreatePayload,
} from './subagent-chat-session.port.types';

@Injectable()
export class InProcessSubagentChatSessionAdapter implements ISubagentChatSessionPort {
  private readonly logger = new Logger(
    InProcessSubagentChatSessionAdapter.name,
  );

  constructor(private readonly chatSessionRepo: ChatSessionRepository) {}

  async createSubagentChatSession(
    payload: SubagentChatSessionCreatePayload,
  ): Promise<string | null> {
    try {
      const subagentSession = await this.chatSessionRepo.create(
        buildChatSessionCreatePayload({
          profile: payload.profile,
          status: payload.status,
          executionState: payload.executionState,
          source: payload.source,
          initialMessage: payload.initialMessage,
          displayName: payload.displayName,
          scopeId: payload.scopeId,
          sessionType: payload.sessionType,
          harnessId: payload.harnessId,
          overrides: payload.overrides,
        }),
      );
      return subagentSession.id;
    } catch (error) {
      this.logger.warn(
        `Failed to create subagent chat session: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
