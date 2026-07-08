import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TelegramSettingsService } from './telegram-settings.service';

@Injectable()
export class TelegramToolApprovalNotifier {
  private readonly logger = new Logger(TelegramToolApprovalNotifier.name);

  constructor(private readonly telegramSettings: TelegramSettingsService) {}

  @OnEvent('tool_call.approval_required')
  async handleApprovalRequired(payload: {
    requestId: string;
    chatSessionId?: string | null;
    toolName: string;
    toolArguments: Record<string, unknown>;
    requestedBy: string;
  }): Promise<void> {
    if (!payload.chatSessionId) {
      return;
    }

    const settings = await this.telegramSettings.getRuntimeSettings();
    if (!settings.botToken) {
      this.logger.warn(
        'Cannot send Telegram approval notification: no bot token configured',
      );
      return;
    }

    const argsPreview = JSON.stringify(payload.toolArguments).slice(0, 200);
    const text = `Approval required\nTool: ${payload.toolName}\nBy: ${payload.requestedBy}\nArgs: ${argsPreview}`;

    const body = {
      chat_id: payload.chatSessionId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Approve',
              callback_data: `approve_tool:${payload.requestId}`,
            },
            {
              text: 'Reject',
              callback_data: `reject_tool:${payload.requestId}`,
            },
          ],
          [
            {
              text: 'Approve & Always Allow',
              callback_data: `approve_tool_always:${payload.requestId}`,
            },
          ],
        ],
      },
    };

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${settings.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const responseBody = await response.text();
        this.logger.warn(
          `Telegram sendMessage failed: ${response.status} ${responseBody}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to send Telegram approval notification: ${(error as Error).message}`,
      );
    }
  }
}
