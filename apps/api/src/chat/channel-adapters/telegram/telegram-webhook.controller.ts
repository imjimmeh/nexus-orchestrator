import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { TelegramAdapterService } from './telegram-adapter.service';
import type { TelegramIngressAck } from './telegram-ingress.types';
import { TelegramIngressService } from './telegram-ingress.service';

@Controller('channel-adapters/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly telegramAdapter: TelegramAdapterService,
    private readonly ingress: TelegramIngressService,
  ) {}

  @Post('webhook')
  async receiveWebhook(
    @Headers('x-telegram-bot-api-secret-token')
    secretHeader: string | undefined,
    @Body() payload: unknown,
  ): Promise<{ success: true; data: TelegramIngressAck }> {
    if (!(await this.telegramAdapter.validateWebhookSecret(secretHeader))) {
      throw new UnauthorizedException('Invalid telegram webhook secret');
    }

    const data = await this.ingress.handlePayload(payload, 'telegram_webhook');

    return {
      success: true,
      data,
    };
  }
}
