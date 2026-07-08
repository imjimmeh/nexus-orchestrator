import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramPollingService } from './telegram-polling.service';

describe('TelegramPollingService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('polls Telegram updates and advances offset', async () => {
    const settings = {
      getSettings: vi.fn(),
    };
    const ingress = {
      handlePayload: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const service = new TelegramPollingService(
      settings as never,
      ingress as never,
    );
    const access = service as unknown as {
      pollOnce: (token: string, pollTimeoutSeconds?: number) => Promise<void>;
      nextOffset: number | null;
    };

    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            result: [
              { update_id: 101, message: { message_id: 1, text: 'one' } },
              { update_id: 102, message: { message_id: 2, text: 'two' } },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await access.pollOnce('bot-token', 50);

    expect(ingress.handlePayload).toHaveBeenCalledTimes(2);
    expect(ingress.handlePayload).toHaveBeenNthCalledWith(
      1,
      { update_id: 101, message: { message_id: 1, text: 'one' } },
      'telegram_polling',
    );
    expect(access.nextOffset).toBe(103);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://api.telegram.org/botbot-token/getUpdates');
    expect(calledInit?.method).toBe('POST');
  });

  it('throws when Telegram getUpdates returns an error payload', async () => {
    const settings = {
      getSettings: vi.fn(),
    };
    const ingress = {
      handlePayload: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const service = new TelegramPollingService(
      settings as never,
      ingress as never,
    );
    const access = service as unknown as {
      pollOnce: (token: string, pollTimeoutSeconds?: number) => Promise<void>;
    };

    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            description: 'Unauthorized',
          }),
          { status: 401 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(access.pollOnce('bot-token', 50)).rejects.toThrow(
      'Telegram getUpdates failed: Unauthorized',
    );
  });
});
