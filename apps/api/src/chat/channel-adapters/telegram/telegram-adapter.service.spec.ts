import { describe, expect, it, vi } from 'vitest';
import { TelegramAdapterService } from './telegram-adapter.service';

function createService(webhookSecret: string | null = null) {
  const settings = {
    getSettings: vi.fn().mockResolvedValue({
      ingressMode: 'webhook',
      defaultAgentProfile: 'ceo-agent',
      defaultScopeId: null,
      allowedUserIds: [],
      pollTimeoutSeconds: 50,
      pollRetryDelayMs: 1000,
      pollBackoffMaxMs: 30000,
      outboundRelayEnabled: true,
      outboundRelayIntervalMs: 3000,
      outboundRelayBatchSize: 20,
      botToken: null,
      webhookSecret,
      commandsEnabled: true,
      enabledCommands: ['help', 'new', 'resume', 'agent'],
      commandResumeListLimit: 8,
      uxTypingEnabled: true,
      uxTypingHeartbeatMs: 4000,
      uxStatusUpdatesEnabled: true,
      uxStatusMode: 'single_message',
      uxHideThinking: true,
      uxExposeToolNames: false,
      uxCommandMenuSyncEnabled: true,
      uxProgressEventsAllowlist: ['job_start', 'tool_execution_start'],
      uxProgressUpdateThrottleMs: 1500,
      uxMaxProgressUpdatesPerRun: 40,
    }),
  };

  const service = new TelegramAdapterService(settings as never);
  return { service, settings };
}

describe('TelegramAdapterService', () => {
  it('accepts webhook requests when no secret is configured', async () => {
    const { service } = createService(null);
    await expect(service.validateWebhookSecret(undefined)).resolves.toBe(true);
  });

  it('validates webhook secret when configured', async () => {
    const { service } = createService('telegram-secret');
    await expect(
      service.validateWebhookSecret('telegram-secret'),
    ).resolves.toBe(true);
    await expect(service.validateWebhookSecret('wrong')).resolves.toBe(false);
  });

  it('maps Telegram update payload into inbound message contract', () => {
    const { service } = createService();
    const message = service.extractInboundMessage({
      update_id: 101,
      message: {
        message_id: 55,
        text: '  hello world  ',
        from: {
          id: 88,
          username: 'jimme',
        },
        chat: {
          id: 77,
          type: 'private',
        },
      },
    });

    expect(message).toEqual({
      provider: 'telegram',
      channel: 'telegram',
      externalUserId: '88',
      externalThreadId: '77',
      providerMessageId: '55',
      correlationId: 'telegram:101',
      text: 'hello world',
      metadata: {
        username: 'jimme',
        chatType: 'private',
        telegramCommand: null,
      },
    });
  });

  it('extracts slash command metadata with arguments', () => {
    const { service } = createService();
    const message = service.extractInboundMessage({
      update_id: 222,
      message: {
        message_id: 123,
        text: '/agent@my_bot architect-agent',
        from: {
          id: 88,
          username: 'jimme',
        },
        chat: {
          id: 77,
          type: 'private',
        },
      },
    });

    expect(message?.metadata).toEqual({
      username: 'jimme',
      chatType: 'private',
      telegramCommand: {
        name: 'agent',
        args: ['architect-agent'],
      },
    });
  });

  it('returns null when payload does not include valid text', () => {
    const { service } = createService();

    const message = service.extractInboundMessage({
      update_id: 101,
      message: {
        message_id: 55,
        text: '',
        from: { id: 1 },
        chat: { id: 2 },
      },
    });

    expect(message).toBeNull();
  });
});
