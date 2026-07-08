import { Injectable, Logger } from '@nestjs/common';
import { ChatSessionsService } from '../../chat-sessions/chat-sessions.service';
import {
  buildTelegramResumeListMessage,
  readTelegramCommandSelectionIndex,
} from './telegram-command-router.utils';
import type {
  TelegramCommandContext,
  TelegramCommandHandler,
} from './telegram-command-handler.types';

@Injectable()
export class TelegramResumeCommandHandler implements TelegramCommandHandler {
  readonly command = 'resume' as const;
  private readonly logger = new Logger(TelegramResumeCommandHandler.name);

  constructor(private readonly chatSessions: ChatSessionsService) {}

  async handle(context: TelegramCommandContext) {
    const limit = context.settings.commandResumeListLimit;
    const recentSessions = await this.chatSessions.listRecentChannelSessions({
      provider: context.inbound.provider,
      externalThreadId: context.inbound.externalThreadId,
      externalUserId: context.inbound.externalUserId,
      limit,
    });

    const targetArg = context.command.args[0]?.trim() ?? '';
    if (!targetArg) {
      if (recentSessions.length === 0) {
        return {
          status: 'denied' as const,
          chatSession: context.contextSession,
          responseText:
            'No resumable sessions were found for this Telegram user/thread.',
        };
      }

      return {
        status: 'success' as const,
        chatSession: context.contextSession,
        responseText: buildTelegramResumeListMessage(recentSessions),
      };
    }

    const indexedSelection = readTelegramCommandSelectionIndex(targetArg);
    let targetSession =
      indexedSelection === null
        ? null
        : (recentSessions[indexedSelection] ?? null);

    if (targetSession) {
      targetSession = await this.activateSessionForInbound(
        context.inbound,
        targetSession.id,
      );
    } else {
      const hasAccess = await this.chatSessions.canAccessChannelSession({
        provider: context.inbound.provider,
        externalThreadId: context.inbound.externalThreadId,
        externalUserId: context.inbound.externalUserId,
        chatSessionId: targetArg,
      });

      if (!hasAccess) {
        return {
          status: 'denied' as const,
          chatSession: context.contextSession,
          responseText:
            'That session is not available in this Telegram context. Use /resume to list available sessions.',
        };
      }

      try {
        targetSession = await this.activateSessionForInbound(
          context.inbound,
          targetArg,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to activate Telegram session ${targetArg}: ${(error as Error).message}`,
        );

        return {
          status: 'error' as const,
          chatSession: context.contextSession,
          responseText: `Unable to resume session ${targetArg}.`,
        };
      }
    }

    return {
      status: 'success' as const,
      chatSession: targetSession,
      responseText: `Resumed session ${targetSession.id}\nAgent: ${targetSession.agentProfileName}`,
    };
  }

  private activateSessionForInbound(
    inbound: TelegramCommandContext['inbound'],
    chatSessionId: string,
  ) {
    return this.chatSessions.activateChannelSession({
      provider: inbound.provider,
      externalThreadId: inbound.externalThreadId,
      externalUserId: inbound.externalUserId,
      chatSessionId,
    });
  }
}
