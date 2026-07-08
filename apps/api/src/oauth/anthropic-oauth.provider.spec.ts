import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthLoginCallbacks } from '@earendil-works/pi-ai/oauth';
import {
  ANTHROPIC_OAUTH_PROVIDER_ID,
  createAnthropicOAuthProvider,
} from './anthropic-oauth.provider';

const mockConfig = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  redirectUri: 'http://localhost:53692/callback',
  scopes:
    'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
};

interface TokenResponseInit {
  ok?: boolean;
  status?: number;
  body?: unknown;
}

function tokenResponse({
  ok = true,
  status = 200,
  body = {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
  },
}: TokenResponseInit = {}): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function captureAuthState(authUrl: string): string {
  const state = new URL(authUrl).searchParams.get('state');
  if (!state) {
    throw new Error('authorize URL is missing a state parameter');
  }
  return state;
}

interface CallbackHarness {
  callbacks: OAuthLoginCallbacks;
  getAuthUrl: () => string;
}

function makeCallbacks(
  pasteFor: (state: string) => string,
  overrides: Partial<OAuthLoginCallbacks> = {},
): CallbackHarness {
  let authUrl = '';
  const callbacks: OAuthLoginCallbacks = {
    onAuth: (info) => {
      authUrl = info.url;
    },
    onDeviceCode: vi.fn(),
    onPrompt: vi.fn(async () => pasteFor(captureAuthState(authUrl))),
    onSelect: vi.fn(async () => undefined),
    onProgress: vi.fn(),
    onManualCodeInput: vi.fn(async () => pasteFor(captureAuthState(authUrl))),
    ...overrides,
  };
  return { callbacks, getAuthUrl: () => authUrl };
}

describe('createAnthropicOAuthProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: ReturnType<typeof createAnthropicOAuthProvider>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => tokenResponse());
    vi.stubGlobal('fetch', fetchMock);
    provider = createAnthropicOAuthProvider(mockConfig);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not use a loopback callback server', () => {
    expect(provider.id).toBe(ANTHROPIC_OAUTH_PROVIDER_ID);
    expect(provider.usesCallbackServer).toBe(false);
  });

  it('emits an authorization URL with PKCE and the registered redirect', async () => {
    const { callbacks, getAuthUrl } = makeCallbacks(
      (state) => `code-1#${state}`,
    );

    await provider.login(callbacks);

    const url = new URL(getAuthUrl());
    expect(`${url.origin}${url.pathname}`).toBe(mockConfig.authorizeUrl);
    expect(url.searchParams.get('client_id')).toBe(mockConfig.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(mockConfig.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('exchanges a pasted code#state for credentials', async () => {
    const { callbacks } = makeCallbacks((state) => `auth-code-123#${state}`);

    const creds = await provider.login(callbacks);

    expect(creds.access).toBe('access-token');
    expect(creds.refresh).toBe('refresh-token');
    expect(creds.expires).toBeGreaterThan(Date.now());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(mockConfig.tokenUrl);
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody).toMatchObject({
      grant_type: 'authorization_code',
      client_id: mockConfig.clientId,
      code: 'auth-code-123',
      redirect_uri: mockConfig.redirectUri,
    });
    expect(sentBody.code_verifier).toBeTruthy();
  });

  it('accepts a pasted full redirect URL', async () => {
    const { callbacks } = makeCallbacks(
      (state) => `${mockConfig.redirectUri}?code=url-code&state=${state}`,
    );

    await provider.login(callbacks);

    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sentBody.code).toBe('url-code');
  });

  it('falls back to onPrompt when onManualCodeInput is absent', async () => {
    const { callbacks } = makeCallbacks((state) => `prompt-code#${state}`, {
      onManualCodeInput: undefined,
    });

    await provider.login(callbacks);

    expect(callbacks.onPrompt).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sentBody.code).toBe('prompt-code');
  });

  it('rejects when the pasted state does not match', async () => {
    const { callbacks } = makeCallbacks(() => 'code-1#tampered-state');

    await expect(provider.login(callbacks)).rejects.toThrow(/state mismatch/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when no authorization code is provided', async () => {
    const { callbacks } = makeCallbacks(() => '   ');

    await expect(provider.login(callbacks)).rejects.toThrow(
      /authorization code/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when the token exchange fails', async () => {
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ ok: false, status: 400, body: { error: 'bad' } }),
    );
    const { callbacks } = makeCallbacks((state) => `code-1#${state}`);

    await expect(provider.login(callbacks)).rejects.toThrow(/token exchange/i);
  });

  it('aborts the login when the signal is triggered', async () => {
    const controller = new AbortController();
    const callbacks: OAuthLoginCallbacks = {
      onAuth: vi.fn(),
      onDeviceCode: vi.fn(),
      onPrompt: vi.fn(),
      onSelect: vi.fn(async () => undefined),
      onProgress: vi.fn(),
      onManualCodeInput: vi.fn(() => new Promise<string>(() => {})),
      signal: controller.signal,
    };

    const pending = provider.login(callbacks);
    controller.abort();

    await expect(pending).rejects.toThrow(/abort/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes credentials via the refresh_token grant', async () => {
    fetchMock.mockResolvedValueOnce(
      tokenResponse({
        body: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 7200,
        },
      }),
    );

    const creds = await provider.refreshToken({
      access: 'old-access',
      refresh: 'old-refresh',
      expires: 0,
    });

    expect(creds.access).toBe('new-access');
    expect(creds.refresh).toBe('new-refresh');
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(mockConfig.tokenUrl);
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
    });
  });

  it('exposes the access token as the API key', () => {
    expect(
      provider.getApiKey({
        access: 'the-access-token',
        refresh: 'r',
        expires: 1,
      }),
    ).toBe('the-access-token');
  });

  it('throws an actionable error before any network call when clientId is missing', () => {
    expect(() =>
      createAnthropicOAuthProvider({
        ...mockConfig,
        clientId: null as unknown as string,
      }),
    ).toThrow(/clientId is required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
