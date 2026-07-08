import { Injectable, Logger } from '@nestjs/common';
import { ChatMessagesService } from '../../chat-messages/chat-messages.service';
import { ChatSessionsService } from '../../chat-sessions/chat-sessions.service';
import { TelegramAdapterService } from './telegram-adapter.service';
import { TelegramCommandRouterService } from './telegram-command-router.service';
import { TelegramSenderService } from './telegram-sender.service';
import { TelegramSettingsClient } from './telegram-settings.client';
import { TelegramToolApprovalHandler } from './telegram-tool-approval.handler';
import type { TelegramIngressAck } from './telegram-ingress.types';
import type { TelegramChannelRuntimeSettings } from './telegram-runtime-settings.types';
import { TelegramRuntimeSettingsService } from './telegram-runtime-settings.service';

@Injectable()
export class TelegramIngressService {
  private readonly logger = new Logger(TelegramIngressService.name);

  constructor(
    private readonly telegramAdapter: TelegramAdapterService,
    private readonly runtimeSettings: TelegramRuntimeSettingsService,
    private readonly commandRouter: TelegramCommandRouterService,
    private readonly chatSessions: ChatSessionsService,
    private readonly chatMessages: ChatMessagesService,
    private readonly telegramSender: TelegramSenderService,
    private readonly toolApprovalHandler: TelegramToolApprovalHandler,
    private readonly telegramSettings: TelegramSettingsClient,
  ) {}

  async handlePayload(
    payload: unknown,
    requestedBy: 'telegram_webhook' | 'telegram_polling' = 'telegram_webhook',
  ): Promise<TelegramIngressAck> {
    const callbackQuery = this.telegramAdapter.extractCallbackQuery(payload);
    if (callbackQuery) {
      await this.toolApprovalHandler.handleCallbackQuery(callbackQuery);
      return { acknowledged: true };
    }

    const inbound = this.telegramAdapter.extractInboundMessage(payload);
    if (!inbound) {
      return { acknowledged: true, ignored: true };
    }

    const settings = await this.runtimeSettings.getSettings();
    if (
      !this.isInboundUserAllowed(
        inbound.externalUserId,
        settings.allowedUserIds,
      )
    ) {
      this.logger.log(
        `Ignoring Telegram ingress from disallowed user ${inbound.externalUserId}`,
      );
      return { acknowledged: true, ignored: true };
    }

    // Register the user's Telegram identity for notifications (best-effort)
    void this.telegramSettings.registerChannelIdentity({
      channel: 'telegram',
      externalUserId: inbound.externalUserId,
    });

    const commandAck = await this.commandRouter.handleIfCommand({
      inbound,
      settings,
      requestedBy,
    });
    if (commandAck) {
      this.logger.log(
        `Handled Telegram slash command for ${inbound.externalUserId} on thread ${inbound.externalThreadId}`,
      );
      return commandAck;
    }

    await this.sendTypingIndicatorIfEnabled(inbound.externalThreadId, settings);

    const chatSession =
      await this.chatSessions.resolveOrCreatePreferredChannelSession({
        provider: inbound.provider,
        externalThreadId: inbound.externalThreadId,
        externalUserId: inbound.externalUserId,
        initialMessage: inbound.text,
        defaultAgentProfileName: settings.defaultAgentProfile,
        scopeId: settings.defaultScopeId,
      });

    const message = await this.chatMessages.sendChatMessage(
      chatSession.id,
      inbound.text,
      {
        channel: inbound.channel,
        providerMessageId: inbound.providerMessageId,
        correlationId: inbound.correlationId,
        externalUserId: inbound.externalUserId,
        metadata: this.buildInboundMetadata(inbound.metadata, {
          externalThreadId: inbound.externalThreadId,
          externalUserId: inbound.externalUserId,
          provider: inbound.provider,
        }),
        requestedBy,
      },
    );

    return {
      acknowledged: true,
      chatSessionId: chatSession.id,
      messageId: message.messageId,
      runId: message.runId,
      runStatus: message.runStatus,
    };
  }

  private buildInboundMetadata(
    metadata: Record<string, unknown>,
    additions: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...metadata,
      ...additions,
    };
  }

  private isInboundUserAllowed(
    externalUserId: string,
    allowedUserIds: string[],
  ): boolean {
    if (allowedUserIds.length === 0) {
      return true;
    }

    return allowedUserIds.includes(externalUserId);
  }

  private async sendTypingIndicatorIfEnabled(
    externalThreadId: string,
    settings: TelegramChannelRuntimeSettings,
  ): Promise<void> {
    if (!settings.uxTypingEnabled || !settings.botToken) {
      return;
    }

    try {
      await this.telegramSender.sendChatAction({
        externalThreadId,
        action: 'typing',
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send immediate Telegram typing indicator: ${(error as Error).message}`,
      );
    }
  }
}
