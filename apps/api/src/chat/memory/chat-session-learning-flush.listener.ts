import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CHAT_SESSION_COMPLETED_EVENT,
  CHAT_SESSION_FAILED_EVENT,
} from '../../chat-execution/chat-session-events.constants';
import { ChatSessionRepository } from '../database/repositories/chat-session.repository';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { resolveChatSessionFlushEnabled } from './chat-session-learning-flush.helper';
import { RetrospectiveEnqueueService } from '../../workflow/workflow-retrospective/retrospective-enqueue.service';

@Injectable()
export class ChatSessionLearningFlushListener {
  private readonly logger = new Logger(ChatSessionLearningFlushListener.name);

  constructor(
    private readonly chatSessionRepo: ChatSessionRepository,
    private readonly settings: SystemSettingsService,
    private readonly enqueueService: RetrospectiveEnqueueService,
  ) {}

  @OnEvent(CHAT_SESSION_COMPLETED_EVENT)
  async handleSessionCompleted(event: { sessionId: string }): Promise<void> {
    await this.processSessionFlush(event.sessionId);
  }

  @OnEvent(CHAT_SESSION_FAILED_EVENT)
  async handleSessionFailed(event: { sessionId: string }): Promise<void> {
    await this.processSessionFlush(event.sessionId);
  }

  private async processSessionFlush(sessionId: string): Promise<void> {
    try {
      const enabled = await resolveChatSessionFlushEnabled(this.settings);
      if (!enabled) {
        return;
      }

      const chatSession = await this.chatSessionRepo.findById(sessionId);
      if (!chatSession) {
        this.logger.warn(
          `Chat session not found for learning flush: ${sessionId}`,
        );
        return;
      }

      await this.enqueueService.enqueueChatSession(chatSession);
    } catch (err) {
      this.logger.error(
        `Failed to enqueue learning flush for session ${sessionId}: ${(err as Error).message}`,
      );
    }
  }
}
