import { Injectable } from '@nestjs/common';
import { ChatSessionsService } from '../../chat-sessions/chat-sessions.service';
import type {
  TelegramCommandContext,
  TelegramCommandHandler,
} from './telegram-command-handler.types';

@Injectable()
export class TelegramNewCommandHandler implements TelegramCommandHandler {
  readonly command = 'new' as const;

  constructor(private readonly chatSessions: ChatSessionsService) {}

  async handle(context: TelegramCommandContext) {
    const created = await this.chatSessions.createAndActivateChannelSession({
      provider: context.inbound.provider,
      externalThreadId: context.inbound.externalThreadId,
      externalUserId: context.inbound.externalUserId,
      agentProfileName: context.settings.defaultAgentProfile,
      initialMessage: 'Telegram /new command',
      scopeId: context.settings.defaultScopeId,
    });

    return {
      status: 'success' as const,
      chatSession: created,
      responseText: `Started a new session: ${created.id}\nAgent: ${created.agentProfileName}`,
    };
  }
}
