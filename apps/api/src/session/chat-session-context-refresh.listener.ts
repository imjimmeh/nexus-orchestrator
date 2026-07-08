import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChatSessionStatus } from '@nexus/core';
import { ChatSessionContextService } from './chat-session-context.service';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';

/**
 * Listens for orchestration state changes and refreshes context for active chat sessions.
 *
 * Future: This will be triggered by domain events like ProjectPhaseChangedEvent,
 * ContextPublishedEvent, etc. For MVP, context refresh can be triggered manually
 * via the public refreshContextMessage method or by emitting a custom event.
 */
@Injectable()
export class ChatSessionContextRefreshListener {
  private readonly logger = new Logger(ChatSessionContextRefreshListener.name);

  constructor(
    private readonly contextService: ChatSessionContextService,
    private readonly chatSessionRepo: ChatSessionRepository,
  ) {}

  /**
   * Refreshes context for a specific chat session.
   * Can be triggered manually or via event emission.
   */
  @OnEvent('chat_context.refresh_session')
  async onRefreshSessionContext(payload: {
    sessionId: string;
    reason?: string;
  }): Promise<void> {
    try {
      await this.contextService.refreshContextMessage(
        payload.sessionId,
        payload.reason ?? 'manual refresh',
      );
      this.logger.debug(`Context refreshed for session ${payload.sessionId}`);
    } catch (error) {
      this.logger.warn(
        `Failed to refresh context for session ${payload.sessionId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Refreshes context for all active sessions in a project.
   * Can be hooked to ProjectPhaseChangedEvent in the future.
   */
  @OnEvent('chat_context.refresh_project')
  async onRefreshProjectContext(payload: {
    scopeId: string;
    reason?: string;
  }): Promise<void> {
    try {
      // Find all sessions for this project
      const sessions = await this.chatSessionRepo.findAll({
        scopeId: payload.scopeId,
        limit: 200,
        offset: 0,
      });
      const activeSessions = sessions.filter(
        (s) => s.status === ChatSessionStatus.RUNNING,
      );

      this.logger.log(
        `Refreshing context for ${activeSessions.length} active sessions in project ${payload.scopeId}`,
      );

      // Refresh all in parallel with error handling
      await Promise.allSettled(
        activeSessions.map((session) =>
          this.contextService.refreshContextMessage(
            session.id,
            payload.reason ?? 'project state change',
          ),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to refresh context for project ${payload.scopeId}: ${(error as Error).message}`,
      );
    }
  }
}
