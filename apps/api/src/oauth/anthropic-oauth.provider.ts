import { createHash, randomBytes } from 'crypto';
import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  OAuthProviderInterface,
} from '@earendil-works/pi-ai/oauth';
import type { AnthropicOAuthConfig } from './anthropic-oauth.provider.types';

export type { AnthropicOAuthConfig } from './anthropic-oauth.provider.types';

/**
 * Anthropic (Claude Pro/Max) OAuth provider driving the authorization-code +
 * PKCE flow **without** a local loopback callback server.
 *
 * The upstream pi-ai SDK provider opens an HTTP server on 127.0.0.1:53692 to
 * auto-capture the browser redirect. On a deployed API host that server is
 * unreachable from the user's browser (it lives on a different machine) and it
 * leaks the port across abandoned attempts — the SDK only closes it once the
 * `login()` promise settles, so an abandoned flow holds 53692 until the process
 * restarts, surfacing as `EADDRINUSE` on the next attempt.
 *
 * This implementation relies solely on the manual paste flow
 * (`onManualCodeInput`), which is the only path that works when the browser and
 * API run on different machines. Configuration mirrors the SDK's Claude Code
 * preset and is supplied by {@link AnthropicOAuthConfig} so the values can be
 * sourced from the `llm_providers` DB row instead of hardcoded constants.
 */

export const ANTHROPIC_OAUTH_PROVIDER_ID = 'anthropic';

const PKCE_VERIFIER_BYTES = 32;
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000;
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;
const MILLISECONDS_PER_SECOND = 1000;
const STATE_DELIMITER = '#';

const AUTH_INSTRUCTIONS =
  'Complete login in your browser, then paste the authorization code (or the ' +
  'full redirect URL) shown after you approve access.';

interface ParsedAuthorization {
  code?: string;
  state?: string;
}

interface AnthropicTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(PKCE_VERIFIER_BYTES).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Parses whatever the user pasted: a full redirect URL, a `code#state` token,
 * a raw `code=...&state=...` query fragment, or a bare authorization code.
 */
function parseAuthorizationInput(input: string): ParsedAuthorization {
  const value = input.trim();
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // Not a URL — fall through to the token/code parsers below.
  }

  if (value.includes(STATE_DELIMITER)) {
    const [code, state] = value.split(STATE_DELIMITER, 2);
    return { code, state };
  }

  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }

  return { code: value };
}

function abortError(): Error {
  return new Error('Anthropic OAuth login was aborted');
}

function parseTokenResponse(body: string): AnthropicTokenResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(
      `Anthropic token exchange returned invalid JSON. body=${body}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Anthropic token response is not an object');
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.access_token !== 'string' ||
    typeof record.refresh_token !== 'string' ||
    typeof record.expires_in !== 'number'
  ) {
    throw new Error('Anthropic token response is missing required fields');
  }

  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    expires_in: record.expires_in,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateConfig(config: AnthropicOAuthConfig): void {
  if (!config.clientId) {
    throw new Error('Anthropic OAuth clientId is required');
  }
  if (!config.authorizeUrl) {
    throw new Error('Anthropic OAuth authorizeUrl is required');
  }
  if (!config.tokenUrl) {
    throw new Error('Anthropic OAuth tokenUrl is required');
  }
  if (!config.redirectUri) {
    throw new Error('Anthropic OAuth redirectUri is required');
  }
  if (!config.scopes) {
    throw new Error('Anthropic OAuth scopes are required');
  }
}

/**
 * Awaits the pasted authorization input, preferring the dedicated paste
 * callback and racing against the abort signal so abandoned sessions unwind.
 */
function waitForAuthorizationInput(
  redirectUri: string,
  callbacks: OAuthLoginCallbacks,
): Promise<string> {
  const input = callbacks.onManualCodeInput
    ? callbacks.onManualCodeInput()
    : callbacks.onPrompt({
        message: 'Paste the authorization code or full redirect URL:',
        placeholder: redirectUri,
      });

  const { signal } = callbacks;
  if (!signal) {
    return input;
  }
  if (signal.aborted) {
    return Promise.reject(abortError());
  }

  return Promise.race([
    input,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(abortError());
        },
        { once: true },
      );
    }),
  ]);
}

/**
 * Creates a server-less Anthropic OAuth provider backed by the supplied
 * {@link AnthropicOAuthConfig}. The returned provider implements the manual
 * paste flow and never binds a local loopback callback server.
 */
export function createAnthropicOAuthProvider(
  config: AnthropicOAuthConfig,
): OAuthProviderInterface {
  validateConfig(config);

  function buildAuthorizeUrl(challenge: string, state: string): string {
    const params = new URLSearchParams({
      code: 'true',
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      scope: config.scopes,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  }

  async function postToken(
    body: Record<string, string>,
    context: string,
  ): Promise<OAuthCredentials> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, TOKEN_EXCHANGE_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(
        `Anthropic ${context} request failed. ${formatError(error)}`,
        {
          cause: error,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = await response.text();
    if (!response.ok) {
      throw new Error(
        `Anthropic ${context} failed. status=${response.status}; body=${responseBody}`,
      );
    }

    const tokens = parseTokenResponse(responseBody);
    return {
      refresh: tokens.refresh_token,
      access: tokens.access_token,
      expires:
        Date.now() +
        tokens.expires_in * MILLISECONDS_PER_SECOND -
        TOKEN_EXPIRY_SKEW_MS,
    };
  }

  async function login(
    callbacks: OAuthLoginCallbacks,
  ): Promise<OAuthCredentials> {
    const { verifier, challenge } = generatePkce();

    callbacks.onAuth({
      url: buildAuthorizeUrl(challenge, verifier),
      instructions: AUTH_INSTRUCTIONS,
    });

    const input = await waitForAuthorizationInput(
      config.redirectUri,
      callbacks,
    );
    const parsed = parseAuthorizationInput(input);

    if (!parsed.code) {
      throw new Error('Missing authorization code');
    }

    const state = parsed.state ?? verifier;
    if (state !== verifier) {
      throw new Error('OAuth state mismatch');
    }

    callbacks.onProgress?.('Exchanging authorization code for tokens...');

    return postToken(
      {
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code: parsed.code,
        state,
        redirect_uri: config.redirectUri,
        code_verifier: verifier,
      },
      'token exchange',
    );
  }

  function refreshToken(
    credentials: OAuthCredentials,
  ): Promise<OAuthCredentials> {
    return postToken(
      {
        grant_type: 'refresh_token',
        client_id: config.clientId,
        refresh_token: credentials.refresh,
      },
      'token refresh',
    );
  }

  return {
    id: ANTHROPIC_OAUTH_PROVIDER_ID,
    name: 'Anthropic (Claude Pro/Max)',
    usesCallbackServer: false,
    login,
    refreshToken,
    getApiKey: (credentials) => credentials.access,
  };
}
