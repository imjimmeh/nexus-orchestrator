import { BadGatewayException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelegramChannelRuntimeSettings } from './telegram-runtime-settings.types';
import { TelegramSenderService } from './telegram-sender.service';

interface RuntimeSettingsMock {
  getSettings: ReturnType<
    typeof vi.fn<() => Promise<TelegramChannelRuntimeSettings>>
  >;
}

function createRuntimeSettings(
  botToken: string | null,
): TelegramChannelRuntimeSettings {
  return {
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
    botToken,
    webhookSecret: null,
  };
}

function createService(botToken: string | null = 'token-1'): {
  service: TelegramSenderService;
  settings: RuntimeSettingsMock;
} {
  const settings: RuntimeSettingsMock = {
    getSettings: vi
      .fn<() => Promise<TelegramChannelRuntimeSettings>>()
      .mockResolvedValue(createRuntimeSettings(botToken)),
  };

  return {
    service: new TelegramSenderService(settings as never),
    settings,
  };
}

describe('TelegramSenderService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends chat messages and returns provider message id', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 777,
            },
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const { service } = createService();

    await expect(
      service.sendMessage({
        channel: 'telegram',
        externalThreadId: '123',
        text: 'hello',
      }),
    ).resolves.toEqual({ providerMessageId: '777' });

    const [calledUrl] = fetchMock.mock.calls[0] ?? [];
    expect(calledUrl).toBe('https://api.telegram.org/bottoken-1/sendMessage');
  });

  it('sends typing chat action', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            result: true,
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const { service } = createService();

    await expect(
      service.sendChatAction({
        externalThreadId: '123',
        action: 'typing',
      }),
    ).resolves.toBeUndefined();

    const [calledUrl] = fetchMock.mock.calls[0] ?? [];
    expect(calledUrl).toBe(
      'https://api.telegram.org/bottoken-1/sendChatAction',
    );
  });

  it('treats no-op editMessageText as non-fatal', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            description: 'Bad Request: message is not modified',
          }),
          { status: 400 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const { service } = createService();

    await expect(
      service.editMessageText({
        externalThreadId: '123',
        providerMessageId: '99',
        text: 'same content',
      }),
    ).resolves.toBe(false);
  });

  it('syncs Telegram command menu', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            result: true,
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const { service } = createService();

    await expect(
      service.setMyCommands([
        {
          command: 'help',
          description: 'Show command usage',
        },
      ]),
    ).resolves.toBeUndefined();

    const [calledUrl] = fetchMock.mock.calls[0] ?? [];
    expect(calledUrl).toBe('https://api.telegram.org/bottoken-1/setMyCommands');
  });

  it('throws when bot token is not configured', async () => {
    const { service } = createService(null);

    await expect(
      service.sendMessage({
        channel: 'telegram',
        externalThreadId: '123',
        text: 'hello',
      }),
    ).rejects.toThrow(BadGatewayException);
  });
});
