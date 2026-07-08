import { BadGatewayException, Injectable } from '@nestjs/common';
import type {
  ChannelOutboundMessage,
  ChannelOutboundSendResult,
  ChannelOutboundSender,
} from '../outbound-sender.types';
import type {
  TelegramApiResponseBase,
  TelegramChatActionName,
  TelegramCommandMenuItem,
} from './telegram-adapter.types';
import { TelegramRuntimeSettingsService } from './telegram-runtime-settings.service';

@Injectable()
export class TelegramSenderService implements ChannelOutboundSender {
  constructor(private readonly settings: TelegramRuntimeSettingsService) {}

  async sendMessage(
    message: ChannelOutboundMessage & {
      replyMarkup?: unknown;
    },
  ): Promise<ChannelOutboundSendResult> {
    const bodyPayload: Record<string, unknown> = {
      chat_id: message.externalThreadId,
      text: message.text,
    };
    if (message.replyMarkup) {
      bodyPayload.reply_markup = message.replyMarkup;
    }
    const { response, body } = await this.callTelegramApi(
      'sendMessage',
      bodyPayload,
    );

    this.assertSuccess(response, body, 'sendMessage');

    return {
      providerMessageId: this.readProviderMessageId(body.result),
    };
  }

  async sendChatAction(params: {
    externalThreadId: string;
    action: TelegramChatActionName;
  }): Promise<void> {
    const { response, body } = await this.callTelegramApi('sendChatAction', {
      chat_id: params.externalThreadId,
      action: params.action,
    });

    this.assertSuccess(response, body, 'sendChatAction');
  }

  async editMessageText(params: {
    externalThreadId: string;
    providerMessageId: string;
    text: string;
  }): Promise<boolean> {
    const messageId = Number.parseInt(params.providerMessageId, 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return false;
    }

    const { response, body } = await this.callTelegramApi('editMessageText', {
      chat_id: params.externalThreadId,
      message_id: messageId,
      text: params.text,
    });

    if (!response.ok || body.ok !== true) {
      if (this.isTelegramNoOpEdit(body.description)) {
        return false;
      }

      this.throwBadGateway('editMessageText', response, body);
    }

    if (body.result === true) {
      return true;
    }

    return this.readProviderMessageId(body.result) !== null;
  }

  async setMyCommands(commands: TelegramCommandMenuItem[]): Promise<void> {
    if (commands.length === 0) {
      await this.clearMyCommands();
      return;
    }

    const { response, body } = await this.callTelegramApi('setMyCommands', {
      commands,
    });

    this.assertSuccess(response, body, 'setMyCommands');
  }

  async clearMyCommands(): Promise<void> {
    const { response, body } = await this.callTelegramApi(
      'deleteMyCommands',
      {},
    );

    this.assertSuccess(response, body, 'deleteMyCommands');
  }

  async answerCallbackQuery(params: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<void> {
    const { response, body } = await this.callTelegramApi(
      'answerCallbackQuery',
      {
        callback_query_id: params.callbackQueryId,
        text: params.text,
        show_alert: params.showAlert,
      },
    );

    this.assertSuccess(response, body, 'answerCallbackQuery');
  }

  async editMessageReplyMarkup(params: {
    externalThreadId: string;
    providerMessageId: string;
    replyMarkup?: unknown;
  }): Promise<boolean> {
    const messageId = Number.parseInt(params.providerMessageId, 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return false;
    }

    const { response, body } = await this.callTelegramApi(
      'editMessageReplyMarkup',
      {
        chat_id: params.externalThreadId,
        message_id: messageId,
        reply_markup: params.replyMarkup,
      },
    );

    if (!response.ok || body.ok !== true) {
      return false;
    }

    return true;
  }

  private async callTelegramApi(
    methodName: string,
    body: Record<string, unknown>,
  ): Promise<{ response: Response; body: TelegramApiResponseBase }> {
    const token = await this.readRequiredToken();
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${methodName}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const responseBody = (await response.json()) as TelegramApiResponseBase;
    return {
      response,
      body: responseBody,
    };
  }

  private assertSuccess(
    response: Response,
    body: TelegramApiResponseBase,
    methodName: string,
  ): void {
    if (!response.ok || body.ok !== true) {
      this.throwBadGateway(methodName, response, body);
    }
  }

  private throwBadGateway(
    methodName: string,
    response: Response,
    body: TelegramApiResponseBase,
  ): never {
    throw new BadGatewayException(
      `Telegram ${methodName} failed: ${body.description ?? response.statusText}`,
    );
  }

  private isTelegramNoOpEdit(description: unknown): boolean {
    if (typeof description !== 'string') {
      return false;
    }

    return description.toLowerCase().includes('message is not modified');
  }

  private readProviderMessageId(result: unknown): string | null {
    if (typeof result !== 'object' || result === null) {
      return null;
    }

    const resultRecord = result as { message_id?: unknown };
    if (typeof resultRecord.message_id !== 'number') {
      return null;
    }

    return `${resultRecord.message_id}`;
  }

  private async readRequiredToken(): Promise<string> {
    const runtimeSettings = await this.settings.getSettings();
    if (runtimeSettings.botToken) {
      return runtimeSettings.botToken;
    }

    throw new BadGatewayException('Telegram bot token is not configured');
  }
}
