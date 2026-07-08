import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunnerProviderSelectionService } from './runner-provider-selection.service';
import type { LlmProvider } from '../database/entities/llm-provider.entity';

vi.mock('@earendil-works/pi-ai', async () => {
  const actual = await vi.importActual<typeof import('@earendil-works/pi-ai')>(
    '@earendil-works/pi-ai',
  );
  return {
    ...actual,
    getModels: vi.fn(actual.getModels),
  };
});

import { getModels } from '@earendil-works/pi-ai';

function makeProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: 'provider-1',
    name: 'TestProvider',
    auth_type: 'api_key',
    runtime_env: {},
    is_active: true,
    owner_type: 'global',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('RunnerProviderSelectionService', () => {
  let service: RunnerProviderSelectionService;

  beforeEach(() => {
    service = new RunnerProviderSelectionService();
  });

  describe('removeOAuthCredentialEnv', () => {
    it('strips OAuth credential keys while preserving other env vars', () => {
      const result = service.removeOAuthCredentialEnv({
        API_KEY: 'k',
        ACCESS_TOKEN: 'a',
        REFRESH_TOKEN: 'r',
        EXPIRES_AT: '1',
        oauth: 'o',
        BASE_URL: 'b',
      });

      expect(result).toEqual({ API_KEY: 'k', BASE_URL: 'b' });
    });

    it('strips snake_case OAuth credential variants', () => {
      const result = service.removeOAuthCredentialEnv({
        access_token: 'a',
        refresh_token: 'r',
        expires_at: '1',
        GITHUB_TOKEN: 'gt',
      });

      expect(result).toEqual({ GITHUB_TOKEN: 'gt' });
    });

    it('returns the input as-is when no OAuth credential keys are present', () => {
      const env = { API_KEY: 'k', BASE_URL: 'b', ORG_ID: 'org' };
      const result = service.removeOAuthCredentialEnv(env);

      expect(result).toEqual({ API_KEY: 'k', BASE_URL: 'b', ORG_ID: 'org' });
    });
  });

  describe('resolveRunnerProviderAuth', () => {
    it('returns OAuth auth with credential for an oauth provider', () => {
      const provider = makeProvider({
        name: 'OAuthProvider',
        auth_type: 'oauth',
      });
      const resolveApiKey = vi.fn();

      const result = service.resolveRunnerProviderAuth({
        provider,
        resolvedProvider: 'oauth-provider',
        providerEnv: {},
        runtimeEnv: {
          oauth: {
            refreshToken: 'rt',
            accessToken: 'at',
            expiresAt: 1234,
          },
        },
        secretMap: {},
        resolveApiKey,
      });

      expect(result).toEqual({
        type: 'oauth',
        credential: {
          type: 'oauth',
          refreshToken: 'rt',
          accessToken: 'at',
          expiresAt: 1234,
        },
      });
      expect(resolveApiKey).not.toHaveBeenCalled();
    });

    it('returns API key auth by delegating to the injected resolveApiKey', () => {
      const provider = makeProvider({ name: 'APIKeyProvider' });
      const resolveApiKey = vi.fn().mockReturnValue('resolved-key');

      const result = service.resolveRunnerProviderAuth({
        provider,
        resolvedProvider: 'api-key-provider',
        providerEnv: { API_KEY: 'k' },
        runtimeEnv: {},
        secretMap: {},
        apiKeyField: 'API_KEY',
        resolveApiKey,
      });

      expect(result).toEqual({ type: 'api_key', apiKey: 'resolved-key' });
      expect(resolveApiKey).toHaveBeenCalledWith({
        provider: 'api-key-provider',
        providerEnv: { API_KEY: 'k' },
        apiKeyField: 'API_KEY',
      });
    });
  });

  describe('resolveProviderRegistrationConfig', () => {
    it('replaces {{KEY}} header tokens from the secret map', () => {
      const config = service.resolveProviderRegistrationConfig({
        auth: { type: 'api_key', apiKey: 'sk' },
        runtimeEnv: {
          providerConfig: {
            headers: {
              'X-Auth': 'Bearer {{EDGE_TOKEN}}',
              'X-Title': 'nexus',
            },
          },
        },
        secretMap: { EDGE_TOKEN: 'tok_123' },
      });

      expect(config?.headers).toEqual({
        'X-Auth': 'Bearer tok_123',
        'X-Title': 'nexus',
      });
    });

    it('leaves unmatched placeholders intact', () => {
      const config = service.resolveProviderRegistrationConfig({
        auth: { type: 'api_key', apiKey: 'sk' },
        runtimeEnv: {
          providerConfig: { headers: { 'X-Auth': '{{MISSING}}' } },
        },
        secretMap: {},
      });

      expect(config?.headers).toEqual({ 'X-Auth': '{{MISSING}}' });
    });

    it('returns undefined when no source is present and auth.type is api_key', () => {
      const config = service.resolveProviderRegistrationConfig({
        auth: { type: 'api_key', apiKey: 'sk' },
        runtimeEnv: {},
        secretMap: {},
      });

      expect(config).toBeUndefined();
    });

    it('propagates authHeader: true from runtimeEnv.providerConfig.authHeader', () => {
      const config = service.resolveProviderRegistrationConfig({
        auth: { type: 'api_key', apiKey: 'sk' },
        runtimeEnv: {
          providerConfig: { authHeader: true, name: 'demo' },
        },
        secretMap: {},
      });

      expect(config?.authHeader).toBe(true);
      expect(config?.name).toBe('demo');
    });
  });

  describe('synthesizeOAuthProviderConfig', () => {
    it('returns synthesized config when getModels yields a valid model', async () => {
      vi.mocked(getModels).mockReturnValue([
        {
          id: 'gpt-5.3-codex-spark',
          name: 'GPT-5.3 Codex Spark',
          api: 'openai-codex-responses',
          provider: 'openai-codex',
          baseUrl: 'https://chatgpt.com/backend-api/',
          reasoning: true,
        },
      ] as ReturnType<typeof getModels>);

      const config = await service.synthesizeOAuthProviderConfig({
        providerName: 'ChatGPT',
        piProvider: 'openai-codex',
        oauthTokenUrl: 'https://auth.example.com/token',
      });

      expect(config).toEqual({
        name: 'ChatGPT',
        baseUrl: 'https://chatgpt.com/backend-api/',
        api: 'openai-codex-responses',
        authHeader: true,
        oauth: {
          name: 'ChatGPT',
          refresh: {
            tokenUrl: 'https://auth.example.com/token',
            refreshTokenParam: 'refresh_token',
            accessTokenPath: 'access_token',
            refreshTokenPath: 'refresh_token',
            expiresInPath: 'expires_in',
          },
        },
        models: [
          {
            id: 'gpt-5.3-codex-spark',
            name: 'GPT-5.3 Codex Spark',
            api: 'openai-codex-responses',
            provider: 'openai-codex',
            baseUrl: 'https://chatgpt.com/backend-api/',
            reasoning: true,
          },
        ],
      });
    });

    it('returns undefined when getModels throws', async () => {
      vi.mocked(getModels).mockImplementation(() => {
        throw new Error('SDK error');
      });

      const config = await service.synthesizeOAuthProviderConfig({
        providerName: 'Broken',
        piProvider: 'broken',
        oauthTokenUrl: 'https://auth.example.com/token',
      });

      expect(config).toBeUndefined();
    });

    it('returns undefined when getModels returns an empty array', async () => {
      vi.mocked(getModels).mockReturnValue([] as ReturnType<typeof getModels>);

      const config = await service.synthesizeOAuthProviderConfig({
        providerName: 'Empty',
        piProvider: 'empty',
        oauthTokenUrl: 'https://auth.example.com/token',
      });

      expect(config).toBeUndefined();
    });
  });
});
