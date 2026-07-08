import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TelegramWebhookController } from './telegram-webhook.controller';

describe('TelegramWebhookController', () => {
  function createController() {
    const telegramAdapter = {
      validateWebhookSecret: vi.fn(),
    };

    const ingress = {
      handlePayload: vi.fn(),
    };

    const controller = new TelegramWebhookController(
      telegramAdapter as never,
      ingress as never,
    );

    return { controller, telegramAdapter, ingress };
  }

  it('rejects invalid webhook secret', async () => {
    const { controller, telegramAdapter } = createController();
    telegramAdapter.validateWebhookSecret.mockResolvedValue(false);

    await expect(controller.receiveWebhook('invalid', {})).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('delegates inbound payload handling to Telegram ingress service', async () => {
    const { controller, telegramAdapter, ingress } = createController();

    telegramAdapter.validateWebhookSecret.mockResolvedValue(true);
    ingress.handlePayload.mockResolvedValue({
      acknowledged: true,
      chatSessionId: 'chat-1',
      messageId: 'msg-1',
      runId: 'run-1',
      runStatus: 'PENDING',
    });

    const result = await controller.receiveWebhook('secret', {
      update_id: 101,
    });

    expect(ingress.handlePayload).toHaveBeenCalledWith(
      { update_id: 101 },
      'telegram_webhook',
    );
    expect(result).toEqual({
      success: true,
      data: {
        acknowledged: true,
        chatSessionId: 'chat-1',
        messageId: 'msg-1',
        runId: 'run-1',
        runStatus: 'PENDING',
      },
    });
  });

  it('returns ignored acknowledgement when ingress ignores payload', async () => {
    const { controller, telegramAdapter, ingress } = createController();

    telegramAdapter.validateWebhookSecret.mockResolvedValue(true);
    ingress.handlePayload.mockResolvedValue({
      acknowledged: true,
      ignored: true,
    });

    const result = await controller.receiveWebhook('secret', {
      update_id: 101,
      edited_message: { message_id: 55 },
    });

    expect(ingress.handlePayload).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      data: {
        acknowledged: true,
        ignored: true,
      },
    });
  });
});
