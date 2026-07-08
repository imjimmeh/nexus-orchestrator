import { Injectable, Logger } from '@nestjs/common';
import { ChatSessionsService } from '../../chat-sessions/chat-sessions.service';
import type {
  TelegramCommandContext,
  TelegramCommandHandler,
} from './telegram-command-handler.types';

@Injectable()
export class TelegramAgentCommandHandler implements TelegramCommandHandler {
  readonly command = 'agent' as const;
  private readonly logger = new Logger(TelegramAgentCommandHandler.name);

  constructor(private readonly chatSessions: ChatSessionsService) {}

  async handle(context: TelegramCommandContext) {
    const selectedProfile = context.command.args[0]?.trim() ?? '';
    if (!selectedProfile) {
      return {
        status: 'denied' as const,
        chatSession: context.contextSession,
        responseText: 'Usage: /agent <agent-profile>',
      };
    }

    try {
      const created = await this.chatSessions.createAndActivateChannelSession({
        provider: context.inbound.provider,
        externalThreadId: context.inbound.externalThreadId,
        externalUserId: context.inbound.externalUserId,
        agentProfileName: selectedProfile,
        initialMessage: `Telegram /agent ${selectedProfile}`,
        scopeId: context.settings.defaultScopeId,
      });

      return {
        status: 'success' as const,
        chatSession: created,
        responseText: `Switched to agent ${selectedProfile} in new session ${created.id}`,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to switch Telegram session to agent ${selectedProfile}: ${(error as Error).message}`,
      );

      return {
        status: 'denied' as const,
        chatSession: context.contextSession,
        responseText: `Agent '${selectedProfile}' was not found or is not active.`,
      };
    }
  }
}
