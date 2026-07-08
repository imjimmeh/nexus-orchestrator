import { Injectable, Logger } from '@nestjs/common';
import { TelegramSenderService } from './telegram-sender.service';
import jwt from 'jsonwebtoken';
import {
  SERVICE_JWT_ROLES,
  SERVICE_JWT_SCOPES,
} from '../../../config/service-jwt.constants';

const DEFAULT_CORE_BASE_URL = resolveDefaultCoreBaseUrl();
const SERVICE_TOKEN_SUBJECT = 'chat-service';

function resolveDefaultCoreBaseUrl(): string {
  const port = process.env.PORT?.trim() || '3000';
  return `http://127.0.0.1:${port}/api`;
}

@Injectable()
export class TelegramToolApprovalHandler {
  private readonly logger = new Logger(TelegramToolApprovalHandler.name);

  constructor(private readonly telegramSender: TelegramSenderService) {}

  async handleCallbackQuery(params: {
    callbackQueryId: string;
    externalThreadId: string;
    providerMessageId: string;
    data: string;
  }): Promise<void> {
    const [action, requestId] = params.data.split(':');
    if (!requestId) {
      return;
    }

    if (
      action !== 'approve_tool' &&
      action !== 'reject_tool' &&
      action !== 'approve_tool_always'
    ) {
      return;
    }

    try {
      if (action === 'reject_tool') {
        await this.postToApi(
          `/tool-call-approval-requests/${encodeURIComponent(requestId)}/reject`,
          {
            reason: 'Rejected via Telegram',
          },
        );
        await this.telegramSender.answerCallbackQuery({
          callbackQueryId: params.callbackQueryId,
          text: 'Request rejected',
        });
      } else {
        const body: Record<string, unknown> = {};
        if (action === 'approve_tool_always') {
          body.alwaysAllowExact = true;
        }

        await this.postToApi(
          `/tool-call-approval-requests/${encodeURIComponent(requestId)}/approve`,
          body,
        );
        await this.telegramSender.answerCallbackQuery({
          callbackQueryId: params.callbackQueryId,
          text:
            action === 'approve_tool_always'
              ? 'Request approved & always allowed'
              : 'Request approved',
        });
      }

      await this.telegramSender.editMessageReplyMarkup({
        externalThreadId: params.externalThreadId,
        providerMessageId: params.providerMessageId,
        replyMarkup: { inline_keyboard: [] },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to process Telegram callback query: ${(error as Error).message}`,
      );
      await this.telegramSender.answerCallbackQuery({
        callbackQueryId: params.callbackQueryId,
        text: 'Error processing your response. Please use the web UI.',
        showAlert: true,
      });
    }
  }

  private async postToApi(
    path: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const baseUrl =
      this.readOptionalEnv('CHAT_CORE_BASE_URL') ?? DEFAULT_CORE_BASE_URL;
    const token = this.resolveCoreJwtToken();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API call failed: ${response.status} ${text}`);
    }
  }

  private resolveCoreJwtToken(): string | null {
    const secret = this.readOptionalEnv('JWT_SECRET');
    if (!secret) {
      return null;
    }

    const audience =
      this.readOptionalEnv('CHAT_CORE_JWT_AUDIENCE') ?? 'nexus-core-internal';
    const issuer = this.readOptionalEnv('CHAT_CORE_JWT_ISSUER') ?? 'nexus-chat';
    const expiresIn = (this.readOptionalEnv('CHAT_CORE_JWT_TTL') ??
      '5m') as jwt.SignOptions['expiresIn'];

    return jwt.sign(
      {
        role: 'agent',
        roles: [...SERVICE_JWT_ROLES],
        service: 'chat',
        serviceScopes: [...SERVICE_JWT_SCOPES],
      },
      secret,
      {
        audience,
        issuer,
        subject: SERVICE_TOKEN_SUBJECT,
        expiresIn,
      },
    );
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
