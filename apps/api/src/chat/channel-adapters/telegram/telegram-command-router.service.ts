import { Injectable, Logger } from '@nestjs/common';
import type { InboundChannelMessage } from '../channel-adapter.types';
import { ChatMessagesService } from '../../chat-messages/chat-messages.service';
import { ChatMessageRepository } from '../../database/repositories/chat-message.repository';
import { ChatSessionsService } from '../../chat-sessions/chat-sessions.service';
import type { TelegramCommandMetadata } from './telegram-command.types';
import type { TelegramIngressAck } from './telegram-ingress.types';
import type { CommandExecutionResult } from './telegram-command-router.types';
import type { TelegramChannelRuntimeSettings } from './telegram-runtime-settings.types';
import { TelegramSenderService } from './telegram-sender.service';
import { TelegramAgentCommandHandler } from './telegram-agent-command.handler';
import { TelegramHelpCommandHandler } from './telegram-help-command.handler';
import { TelegramNewCommandHandler } from './telegram-new-command.handler';
import { TelegramResumeCommandHandler } from './telegram-resume-command.handler';
import type { TelegramCommandHandler } from './telegram-command-handler.types';
import {
  isSupportedTelegramCommand,
  readInboundTelegramCommand,
  resolveEnabledTelegramCommands,
} from './telegram-command-router.utils';

@Injectable()
export class TelegramCommandRouterService {
  private readonly logger = new Logger(TelegramCommandRouterService.name);

  constructor(
    private readonly chatSessions: ChatSessionsService,
    private readonly chatMessages: ChatMessageRepository,
    private readonly chatMessageActions: ChatMessagesService,
    private readonly telegramSender: TelegramSenderService,
    private readonly helpCommandHandler: TelegramHelpCommandHandler,
    private readonly newCommandHandler: TelegramNewCommandHandler,
    private readonly resumeCommandHandler: TelegramResumeCommandHandler,
    private readonly agentCommandHandler: TelegramAgentCommandHandler,
  ) {}

  async handleIfCommand(params: {
    inbound: InboundChannelMessage;
    settings: TelegramChannelRuntimeSettings;
    requestedBy: 'telegram_webhook' | 'telegram_polling';
  }): Promise<TelegramIngressAck | null> {
    const command = readInboundTelegramCommand(
      params.inbound.metadata,
      params.inbound.text,
    );
    if (!command) {
      return null;
    }
    const duplicateAck = await this.resolveDuplicateCommandAck(
      params.inbound,
      command,
    );
    if (duplicateAck) {
      return duplicateAck;
    }
    const contextSession =
      await this.chatSessions.resolveOrCreatePreferredChannelSession({
        provider: params.inbound.provider,
        externalThreadId: params.inbound.externalThreadId,
        externalUserId: params.inbound.externalUserId,
        initialMessage: params.inbound.text,
        defaultAgentProfileName: params.settings.defaultAgentProfile,
        scopeId: params.settings.defaultScopeId,
      });
    const commandMessage = await this.createInboundCommandMessage({
      inbound: params.inbound,
      command,
      requestedBy: params.requestedBy,
      contextSession,
    });
    const outcome = await this.executeCommand({
      command,
      contextSession,
      inbound: params.inbound,
      settings: params.settings,
    });
    await this.alignCommandMessageSession(
      commandMessage,
      outcome.chatSession.id,
    );
    await this.sendCommandResponse({
      inbound: params.inbound,
      command,
      commandMessage,
      outcome,
    });
    return {
      acknowledged: true,
      chatSessionId: outcome.chatSession.id,
      messageId: commandMessage.id,
      runId: null,
      runStatus: null,
    };
  }

  private async resolveDuplicateCommandAck(
    inbound: InboundChannelMessage,
    command: TelegramCommandMetadata,
  ): Promise<TelegramIngressAck | null> {
    const existing = await this.chatMessages.findByProviderMessage({
      channel: inbound.channel,
      providerMessageId: inbound.providerMessageId,
    });
    if (!existing) {
      return null;
    }
    this.logger.log(
      `Ignoring duplicate Telegram command ${command.name} for provider message ${inbound.providerMessageId}`,
    );
    return {
      acknowledged: true,
      chatSessionId: existing.chat_session_id,
      messageId: existing.id,
      runId: existing.run_id ?? null,
      runStatus: existing.run_status ?? null,
    };
  }

  private createInboundCommandMessage(params: {
    inbound: InboundChannelMessage;
    command: TelegramCommandMetadata;
    requestedBy: 'telegram_webhook' | 'telegram_polling';
    contextSession: Awaited<
      ReturnType<ChatSessionsService['resolveOrCreatePreferredChannelSession']>
    >;
  }) {
    return this.chatMessages.create({
      chat_session_id: params.contextSession.id,
      direction: 'inbound',
      sender: 'user',
      channel: params.inbound.channel,
      provider_message_id: params.inbound.providerMessageId,
      correlation_id: params.inbound.correlationId,
      event_type: 'telegram_command',
      text: params.inbound.text,
      metadata: this.mergeMetadata(params.inbound.metadata, {
        provider: params.inbound.provider,
        externalThreadId: params.inbound.externalThreadId,
        externalUserId: params.inbound.externalUserId,
        commandName: params.command.name,
        commandArgs: params.command.args,
        commandRequestedBy: params.requestedBy,
        commandStatus: 'pending',
      }),
    });
  }

  private async alignCommandMessageSession(
    commandMessage: {
      id: string;
      chat_session_id: string;
    },
    targetSessionId: string,
  ): Promise<void> {
    if (targetSessionId === commandMessage.chat_session_id) {
      return;
    }
    await this.chatMessages.update(commandMessage.id, {
      chat_session_id: targetSessionId,
    });
  }

  private async sendCommandResponse(params: {
    inbound: InboundChannelMessage;
    command: TelegramCommandMetadata;
    commandMessage: {
      id: string;
      metadata?: Record<string, unknown> | null;
    };
    outcome: CommandExecutionResult;
  }): Promise<void> {
    const sendResult = await this.telegramSender.sendMessage({
      channel: params.inbound.channel,
      externalThreadId: params.inbound.externalThreadId,
      text: params.outcome.responseText,
    });

    const outbound = await this.chatMessageActions.appendOutboundMessage({
      chatId: params.outcome.chatSession.id,
      text: params.outcome.responseText,
      channel: params.inbound.channel,
      providerMessageId: sendResult.providerMessageId,
      metadata: {
        commandName: params.command.name,
        commandArgs: params.command.args,
        commandStatus: params.outcome.status,
        relaySource: 'telegram_command_router',
        relayInboundMessageId: params.commandMessage.id,
      },
    });

    await this.chatMessages.update(params.commandMessage.id, {
      metadata: this.mergeMetadata(params.commandMessage.metadata, {
        commandStatus: params.outcome.status,
        commandHandledAt: new Date().toISOString(),
        commandTargetSessionId: params.outcome.chatSession.id,
        commandResponseText: params.outcome.responseText,
        commandOutboundMessageId: outbound.messageId,
        commandOutboundProviderMessageId: sendResult.providerMessageId,
      }),
    });
  }

  private async executeCommand(params: {
    command: TelegramCommandMetadata;
    contextSession: Awaited<
      ReturnType<ChatSessionsService['resolveOrCreatePreferredChannelSession']>
    >;
    inbound: InboundChannelMessage;
    settings: TelegramChannelRuntimeSettings;
  }): Promise<CommandExecutionResult> {
    if (!params.settings.commandsEnabled) {
      return {
        status: 'denied',
        chatSession: params.contextSession,
        responseText:
          'Slash commands are currently disabled. Send a normal message to continue.',
      };
    }

    const enabledCommands = resolveEnabledTelegramCommands(
      params.settings.enabledCommands,
    );
    if (!isSupportedTelegramCommand(params.command.name)) {
      return {
        status: 'denied',
        chatSession: params.contextSession,
        responseText: `Unknown command /${params.command.name}. Use /help to list available commands.`,
      };
    }

    if (!enabledCommands.has(params.command.name)) {
      return {
        status: 'denied',
        chatSession: params.contextSession,
        responseText: `/${params.command.name} is disabled by runtime settings.`,
      };
    }
    const handler = this.resolveCommandHandler(params.command.name);
    if (!handler) {
      return {
        status: 'denied',
        chatSession: params.contextSession,
        responseText: `Unknown command /${params.command.name}.`,
      };
    }

    return handler.handle({
      command: params.command,
      contextSession: params.contextSession,
      inbound: params.inbound,
      settings: params.settings,
      enabledCommands,
    });
  }

  private resolveCommandHandler(
    commandName: string,
  ): TelegramCommandHandler | null {
    const handlers: TelegramCommandHandler[] = [
      this.helpCommandHandler,
      this.newCommandHandler,
      this.resumeCommandHandler,
      this.agentCommandHandler,
    ];
    return handlers.find((handler) => handler.command === commandName) ?? null;
  }

  private mergeMetadata(
    metadata: Record<string, unknown> | null | undefined,
    additions: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!metadata) {
      return { ...additions };
    }

    return {
      ...metadata,
      ...additions,
    };
  }
}
