import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContextService } from '../../common/request-context.service';
import { TelegramSettingsClient } from './telegram-settings.client';

describe('TelegramSettingsClient', () => {
  const previousBaseUrl = process.env.CHAT_CORE_BASE_URL;
  const previousToken = process.env.CHAT_CORE_BEARER_TOKEN;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CHAT_CORE_BASE_URL = 'http://core.local:3010/api';
    process.env.CHAT_CORE_BEARER_TOKEN = 'chat-core-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.CHAT_CORE_BASE_URL = previousBaseUrl;
    process.env.CHAT_CORE_BEARER_TOKEN = previousToken;
  });

  describe('getTelegramRuntimeSettings', () => {
    it('fetches runtime settings via the chat core endpoint', async () => {
      const fetchMock = vi
        .fn<
          (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
        >()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                ingressMode: 'hybrid',
                defaultAgentProfile: 'ceo-agent',
                defaultScopeId: null,
                allowedUserIds: ['1001', '1002'],
                pollTimeoutSeconds: 50,
                pollRetryDelayMs: 1000,
                pollBackoffMaxMs: 30000,
                outboundRelayEnabled: true,
                outboundRelayIntervalMs: 3000,
                outboundRelayBatchSize: 20,
                botToken: 'bot-token',
                webhookSecret: 'secret',
              },
            }),
            { status: 200 },
          ),
        );

      vi.stubGlobal('fetch', fetchMock);

      const client = new TelegramSettingsClient();
      const settings = await client.getTelegramRuntimeSettings('corr-tele');

      expect(settings).toMatchObject({
        ingressMode: 'hybrid',
        defaultAgentProfile: 'ceo-agent',
        allowedUserIds: ['1001', '1002'],
        botToken: 'bot-token',
        webhookSecret: 'secret',
      });

      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe(
        'http://core.local:3010/api/internal/core/telegram-settings/runtime',
      );
      expect(calledInit?.method).toBe('GET');
      expect(calledInit?.headers).toEqual(
        expect.objectContaining({
          authorization: 'Bearer chat-core-token',
          'x-correlation-id': 'corr-tele',
        }),
      );
    });

    it('surfaces a BadGateway error when the core response payload is malformed', async () => {
      const fetchMock = vi
        .fn<
          (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
        >()
        .mockResolvedValue(
          new Response(JSON.stringify({ success: true, data: 'oops' }), {
            status: 200,
          }),
        );

      vi.stubGlobal('fetch', fetchMock);

      const client = new TelegramSettingsClient();
      await expect(
        client.getTelegramRuntimeSettings('corr-tele'),
      ).rejects.toThrow(
        /Unexpected telegram runtime settings response payload/,
      );
    });
  });

  describe('registerChannelIdentity', () => {
    it('posts the channel identity payload to the notifications endpoint', async () => {
      const fetchMock = vi
        .fn<
          (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
        >()
        .mockResolvedValue(
          new Response(JSON.stringify({ success: true, data: {} }), {
            status: 200,
          }),
        );

      vi.stubGlobal('fetch', fetchMock);

      const requestContext = {
        getRequestId: () => 'corr-from-context',
      } as unknown as RequestContextService;

      const client = new TelegramSettingsClient(requestContext);
      await client.registerChannelIdentity({
        channel: 'telegram',
        externalUserId: 'tg-user-1',
      });

      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe(
        'http://core.local:3010/api/internal/notifications/identities',
      );
      expect(calledInit?.method).toBe('POST');
      expect(calledInit?.headers).toEqual(
        expect.objectContaining({
          authorization: 'Bearer chat-core-token',
          'content-type': 'application/json',
          'x-correlation-id': 'corr-from-context',
        }),
      );
      const parsedBody: unknown = JSON.parse(
        (calledInit?.body as string | undefined) ?? '{}',
      );
      expect(parsedBody).toEqual({
        channel: 'telegram',
        externalUserId: 'tg-user-1',
      });
    });

    it('swallows errors from the identity endpoint as best-effort warnings', async () => {
      const fetchMock = vi
        .fn<
          (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
        >()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'boom' }), { status: 500 }),
        );
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      vi.stubGlobal('fetch', fetchMock);

      const client = new TelegramSettingsClient();
      await expect(
        client.registerChannelIdentity({
          channel: 'telegram',
          externalUserId: 'tg-user-2',
        }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to register channel identity'),
      );

      warnSpy.mockRestore();
    });
  });
});
