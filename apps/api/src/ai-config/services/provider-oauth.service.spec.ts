import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProviderOAuthService } from './provider-oauth.service';
import { LlmProviderRepository } from '../database/repositories/llm-provider.repository';
import { ProviderOAuthSessionRepository } from '../database/repositories/provider-oauth-session.repository';
import { SecretCrudService } from '../../security/services/secret-crud.service';
import type { OAuthProviderResolver } from '../../oauth/oauth-login.types';
import { LlmProvider } from '../database/entities/llm-provider.entity';
import { ProviderOAuthSession } from '../database/entities/provider-oauth-session.entity';
import { createAnthropicOAuthProvider } from '../../oauth/anthropic-oauth.provider';
import {
  createMockLlmProvider,
  createMockSecretStore,
} from '../__tests__/setup/ai-config-mocks.factory';

const DEFAULT_TEST_DATE = '2026-01-01T00:00:00Z';

/**
 * Fixture Anthropic OAuth config for the pi-ai provider resolver mock.
 * The provider-oauth service tests exercise the real factory output so the
 * device-flow detection path matches production.
 */
const ANTHROPIC_OAUTH_FIXTURE = {
  clientId: 'spec-client-id',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  redirectUri: 'http://localhost:53692/callback',
  scopes: 'scope:one scope:two',
};

const apiKeyProviderFixture = (overrides?: Partial<LlmProvider>): LlmProvider =>
  createMockLlmProvider({
    id: 'provider-apikey',
    name: 'openai',
    auth_type: 'api_key',
    is_active: true,
    owner_type: 'global',
    owner_id: null,
    oauth_authorization_url: null,
    oauth_token_url: null,
    oauth_client_id: null,
    oauth_client_secret_id: null,
    oauth_scopes: null,
    oauth_redirect_uri: null,
    ...overrides,
  });

const oauthProviderFixture = (overrides?: Partial<LlmProvider>): LlmProvider =>
  createMockLlmProvider({
    id: 'provider-oauth',
    name: 'corporate-ai',
    auth_type: 'oauth',
    is_active: true,
    owner_type: 'global',
    owner_id: null,
    oauth_authorization_url: 'https://sso.corp.example/oauth/authorize',
    oauth_token_url: 'https://sso.corp.example/oauth/token',
    oauth_client_id: 'client-id-123',
    oauth_client_secret_id: 'secret-cs-1',
    oauth_scopes: ['openid', 'profile', 'offline_access'],
    oauth_redirect_uri: 'http://localhost:3120/providers/oauth/callback',
    ...overrides,
  });

const sessionFixture = (
  overrides?: Partial<ProviderOAuthSession>,
): ProviderOAuthSession => {
  return {
    id: 'session-1',
    provider_id: 'provider-oauth',
    state_hash: 'hashed-state',
    code_verifier: 'code-verifier-value',
    redirect_uri: 'http://localhost:3120/providers/oauth/callback',
    owner_type: 'global',
    owner_id: null,
    expires_at: new Date(Date.now() + 600000),
    used_at: null,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
    ...overrides,
  };
};

describe('ProviderOAuthService', () => {
  let service: ProviderOAuthService;
  let providerRepo: {
    findById: ReturnType<typeof vi.fn>;
    findActiveByOwnerAndName: ReturnType<typeof vi.fn>;
    findByName: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let sessionRepo: {
    create: ReturnType<typeof vi.fn>;
    findUnusedByStateHash: ReturnType<typeof vi.fn>;
    markUsed: ReturnType<typeof vi.fn>;
    deleteExpired: ReturnType<typeof vi.fn>;
  };
  let secretCrud: {
    findById: ReturnType<typeof vi.fn>;
    findByIdRaw: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let oauthProviderResolver: { resolve: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    providerRepo = {
      findById: vi.fn(),
      findActiveByOwnerAndName: vi.fn(),
      findByName: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };

    sessionRepo = {
      create: vi.fn(),
      findUnusedByStateHash: vi.fn(),
      markUsed: vi.fn(),
      deleteExpired: vi.fn(),
    };

    secretCrud = {
      findById: vi.fn(),
      findByIdRaw: vi.fn(),
      update: vi.fn(),
    };

    oauthProviderResolver = { resolve: vi.fn().mockResolvedValue(undefined) };

    service = new ProviderOAuthService(
      providerRepo as unknown as LlmProviderRepository,
      sessionRepo as unknown as ProviderOAuthSessionRepository,
      secretCrud as unknown as SecretCrudService,
      oauthProviderResolver,
    );
  });

  describe('createAuthorizationUrl', () => {
    it('rejects a provider that does not exist', async () => {
      providerRepo.findById.mockResolvedValue(null);

      await expect(
        service.createAuthorizationUrl({
          providerId: 'nonexistent',
          redirectUri: 'http://localhost:3120/providers/oauth/callback',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an inactive provider', async () => {
      providerRepo.findById.mockResolvedValue(
        apiKeyProviderFixture({ id: 'provider-1', is_active: false }),
      );

      await expect(
        service.createAuthorizationUrl({
          providerId: 'provider-1',
          redirectUri: 'http://localhost:3120/providers/oauth/callback',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a non-OAuth provider', async () => {
      providerRepo.findById.mockResolvedValue(apiKeyProviderFixture());

      await expect(
        service.createAuthorizationUrl({
          providerId: 'provider-apikey',
          redirectUri: 'http://localhost:3120/providers/oauth/callback',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an OAuth provider missing required registration fields', async () => {
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({
          oauth_authorization_url: null,
          oauth_token_url: null,
          oauth_client_id: null,
        }),
      );

      await expect(
        service.createAuthorizationUrl({
          providerId: 'provider-oauth',
          redirectUri: 'http://localhost:3120/providers/oauth/callback',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('creates an authorization URL with state and PKCE', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      sessionRepo.create.mockResolvedValue(sessionFixture());

      const result = await service.createAuthorizationUrl({
        providerId: 'provider-oauth',
        redirectUri: 'http://localhost:3120/providers/oauth/callback',
      });

      expect(result.authorizationUrl).toContain('response_type=code');
      expect(result.authorizationUrl).toContain('client_id=client-id-123');
      expect(result.authorizationUrl).toContain(
        'redirect_uri=http%3A%2F%2Flocalhost%3A3120%2Fproviders%2Foauth%2Fcallback',
      );
      expect(result.authorizationUrl).toContain('code_challenge=');
      expect(result.authorizationUrl).toContain('code_challenge_method=S256');
      expect(result.authorizationUrl).toContain('state=');
      expect(result.authorizationUrl).toContain(
        'scope=openid+profile+offline_access',
      );
      expect(result.state).toBeTruthy();
      expect(result.state.length).toBe(43);
      expect(sessionRepo.create).toHaveBeenCalledTimes(1);

      const sessionCallArgs = sessionRepo.create.mock.calls[0][0];
      expect(sessionCallArgs.provider_id).toBe('provider-oauth');
      expect(sessionCallArgs.redirect_uri).toBe(
        'http://localhost:3120/providers/oauth/callback',
      );
      expect(sessionCallArgs.code_verifier).toBeTruthy();
      expect(sessionCallArgs.state_hash).toBeTruthy();
      expect(sessionCallArgs.owner_type).toBe('global');
      expect(sessionCallArgs.owner_id).toBeNull();
      expect(sessionCallArgs.expires_at).toBeInstanceOf(Date);
    });

    it('stores session owner from provider owner_type and owner_id', async () => {
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ owner_type: 'user', owner_id: 'user-1' }),
      );
      sessionRepo.create.mockResolvedValue(sessionFixture());

      await service.createAuthorizationUrl({
        providerId: 'provider-oauth',
        redirectUri: 'http://localhost:3120/providers/oauth/callback',
      });

      const sessionCallArgs = sessionRepo.create.mock.calls[0][0];
      expect(sessionCallArgs.owner_type).toBe('user');
      expect(sessionCallArgs.owner_id).toBe('user-1');
    });

    it('uses the request redirect URI over the provider configured URI', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      sessionRepo.create.mockResolvedValue(sessionFixture());

      const result = await service.createAuthorizationUrl({
        providerId: 'provider-oauth',
        redirectUri: 'http://localhost:3120/providers/oauth/callback',
      });

      expect(result.authorizationUrl).toContain(
        'redirect_uri=http%3A%2F%2Flocalhost%3A3120%2Fproviders%2Foauth%2Fcallback',
      );
    });

    it('uses the provider configured redirect URI when request does not provide one', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      sessionRepo.create.mockResolvedValue(sessionFixture());

      const result = await service.createAuthorizationUrl({
        providerId: 'provider-oauth',
      });

      expect(result.authorizationUrl).toContain(
        'redirect_uri=http%3A%2F%2Flocalhost%3A3120%2Fproviders%2Foauth%2Fcallback',
      );
    });

    it('creates a URL without scopes when provider has no scopes configured', async () => {
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ oauth_scopes: null }),
      );
      sessionRepo.create.mockResolvedValue(sessionFixture());

      const result = await service.createAuthorizationUrl({
        providerId: 'provider-oauth',
        redirectUri: 'http://localhost:3120/providers/oauth/callback',
      });

      expect(result.authorizationUrl).not.toContain('scope=');
    });

    it('rejects when request and provider redirect URIs are both present but differ', async () => {
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({
          oauth_redirect_uri: 'http://localhost:3120/providers/oauth/callback',
        }),
      );

      await expect(
        service.createAuthorizationUrl({
          providerId: 'provider-oauth',
          redirectUri: 'http://evil.com/steal-tokens',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts when request and provider redirect URIs match', async () => {
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({
          oauth_redirect_uri: 'http://localhost:3120/providers/oauth/callback',
        }),
      );
      sessionRepo.create.mockResolvedValue(sessionFixture());

      const result = await service.createAuthorizationUrl({
        providerId: 'provider-oauth',
        redirectUri: 'http://localhost:3120/providers/oauth/callback',
      });

      expect(result.authorizationUrl).toContain(
        'redirect_uri=http%3A%2F%2Flocalhost%3A3120%2Fproviders%2Foauth%2Fcallback',
      );
    });

    it('accepts request redirect URI when provider has none configured', async () => {
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ oauth_redirect_uri: null }),
      );
      sessionRepo.create.mockResolvedValue(sessionFixture());

      const result = await service.createAuthorizationUrl({
        providerId: 'provider-oauth',
        redirectUri: 'http://localhost:3120/providers/oauth/callback',
      });

      expect(result.authorizationUrl).toContain(
        'redirect_uri=http%3A%2F%2Flocalhost%3A3120%2Fproviders%2Foauth%2Fcallback',
      );
    });

    it('rejects when neither request nor provider redirect URI is available', async () => {
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ oauth_redirect_uri: null }),
      );

      await expect(
        service.createAuthorizationUrl({
          providerId: 'provider-oauth',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('assigns a session expiry 10 minutes in the future', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      sessionRepo.create.mockResolvedValue(sessionFixture());

      const before = Date.now();
      await service.createAuthorizationUrl({
        providerId: 'provider-oauth',
        redirectUri: 'http://localhost:3120/providers/oauth/callback',
      });

      const sessionCallArgs = sessionRepo.create.mock.calls[0][0] as {
        expires_at: Date;
      };
      const expiresAt = sessionCallArgs.expires_at;
      const diffMs = expiresAt.getTime() - before;
      expect(diffMs).toBeGreaterThan(9 * 60 * 1000);
      expect(diffMs).toBeLessThan(11 * 60 * 1000);
    });
  });

  describe('getStatus', () => {
    it('returns not_configured status when provider does not exist', async () => {
      providerRepo.findById.mockResolvedValue(null);

      const result = await service.getStatus('nonexistent');

      expect(result.status).toBe('not_configured');
    });

    it('returns not_configured status for a non-OAuth provider', async () => {
      providerRepo.findById.mockResolvedValue(apiKeyProviderFixture());

      const result = await service.getStatus('provider-apikey');

      expect(result.status).toBe('not_configured');
    });

    it('returns not_configured status for OAuth provider missing registration', async () => {
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({
          oauth_authorization_url: null,
          oauth_token_url: null,
        }),
      );

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('not_configured');
    });

    it('returns disconnected (not not_configured) for pi-ai provider without a stored secret', async () => {
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({
          oauth_authorization_url: null,
          oauth_token_url: null,
          oauth_client_id: null,
          secret_id: null,
          runtime_env: { pi_provider: 'anthropic' },
        }),
      );
      oauthProviderResolver.resolve.mockResolvedValue(
        createAnthropicOAuthProvider(ANTHROPIC_OAUTH_FIXTURE),
      );

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('disconnected');
    });

    it('returns connected for pi-ai provider after tokens are stored', async () => {
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({
          oauth_authorization_url: null,
          oauth_token_url: null,
          oauth_client_id: null,
          runtime_env: { pi_provider: 'anthropic' },
        }),
      );
      oauthProviderResolver.resolve.mockResolvedValue(
        createAnthropicOAuthProvider(ANTHROPIC_OAUTH_FIXTURE),
      );
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-1',
        decryptedValue: JSON.stringify({
          oauth: {
            accessToken: 'tok',
            refreshToken: 'ref',
            expiresAt: Date.now() + 60000,
          },
        }),
      });

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('connected');
    });

    it('returns disconnected status when provider is configured but has no stored tokens', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue(null);

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('disconnected');
    });

    it('returns connected status when tokens are present and not expired', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-1',
        decryptedValue: JSON.stringify({
          oauth: {
            accessToken: 'secret-access-token',
            refreshToken: 'secret-refresh-token',
            expiresAt: Date.now() + 60000,
          },
        }),
      });

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('connected');
    });

    it('returns expired status when tokens are present but have expired', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-1',
        decryptedValue: JSON.stringify({
          oauth: {
            accessToken: 'secret-access-token',
            refreshToken: 'secret-refresh-token',
            expiresAt: Date.now() - 60000,
          },
        }),
      });

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('expired');
    });

    it('does not expose raw access token in status response', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-1',
        decryptedValue: JSON.stringify({
          oauth: {
            accessToken: 'secret-access-value',
            refreshToken: 'secret-refresh-value',
            expiresAt: Date.now() + 60000,
          },
        }),
      });

      const result = await service.getStatus('provider-oauth');
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain('secret-access-value');
      expect(serialized).not.toContain('secret-refresh-value');
    });

    it('returns disconnected status when secret payload is not valid JSON', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-1',
        decryptedValue: 'not-valid-json{{{',
      });

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('disconnected');
    });

    it('returns disconnected status when oauth field is missing from payload', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-1',
        decryptedValue: JSON.stringify({ other: 'data' }),
      });

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('disconnected');
    });

    it('returns disconnected status when oauth field is not an object', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-1',
        decryptedValue: JSON.stringify({ oauth: 'not-an-object' }),
      });

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('disconnected');
    });

    it('returns disconnected status when expiresAt is not a valid number', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-1',
        decryptedValue: JSON.stringify({
          oauth: { expiresAt: 'not-a-number' },
        }),
      });

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('disconnected');
    });

    it('returns disconnected status when findByIdRaw throws NotFoundException', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockRejectedValue(
        new NotFoundException('Secret missing could not be decrypted'),
      );

      const result = await service.getStatus('provider-oauth');

      expect(result.status).toBe('disconnected');
    });

    it('propagates non-NotFound errors from findByIdRaw', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      const dbError = new Error('connection refused');
      secretCrud.findByIdRaw.mockRejectedValue(dbError);

      await expect(service.getStatus('provider-oauth')).rejects.toThrow(
        'connection refused',
      );
    });

    it('does not expose client secret in status response', async () => {
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-1',
        decryptedValue: JSON.stringify({
          oauth: {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            expiresAt: Date.now() + 60000,
          },
        }),
      });

      const result = await service.getStatus('provider-oauth');

      expect(result).not.toHaveProperty('clientSecret');
      expect(result).not.toHaveProperty('token');
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
    });
  });

  describe('completeCallback', () => {
    const savedFetch = global.fetch;

    afterEach(() => {
      global.fetch = savedFetch;
    });

    it('exchanges code and stores OAuth tokens in the linked secret', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: JSON.stringify({ app: 'nexus' }),
      });
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });
      secretCrud.update.mockResolvedValue(createMockSecretStore());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          scope: 'model.read model.write',
          token_type: 'Bearer',
        }),
      });

      const result = await service.completeCallback({
        code: 'code-1',
        state: 'state-1',
      });

      expect(result.status).toBe('connected');
      expect(secretCrud.update).toHaveBeenCalledWith(
        'secret-1',
        expect.objectContaining({
          value: expect.objectContaining({
            oauth: expect.objectContaining({
              accessToken: 'access-1',
              refreshToken: 'refresh-1',
              tokenType: 'Bearer',
              scope: 'model.read model.write',
            }),
            app: 'nexus',
          }),
        }),
      );
      expect(sessionRepo.markUsed).toHaveBeenCalledWith(
        'session-1',
        expect.any(Date),
      );
    });

    it('preserves existing non-oauth secret fields when storing tokens', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: JSON.stringify({ apiVersion: 'v2', customField: 42 }),
      });
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });
      secretCrud.update.mockResolvedValue(createMockSecretStore());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      await service.completeCallback({ code: 'code-1', state: 'state-1' });

      const updateCall = secretCrud.update.mock.calls[0];
      expect(updateCall[0]).toBe('secret-1');
      expect(updateCall[1].value).toMatchObject({
        apiVersion: 'v2',
        customField: 42,
        oauth: expect.objectContaining({
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
        }),
      });
    });

    it('throws when session is not found for the state hash', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(null);

      await expect(
        service.completeCallback({ code: 'code-1', state: 'invalid-state' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when the linked provider is not found', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(null);

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when the provider is not OAuth', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(
        apiKeyProviderFixture({ id: 'provider-oauth' }),
      );

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when the provider is missing required OAuth registration fields', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ oauth_token_url: null }),
      );

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws when the provider has no linked secret', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ secret_id: null }),
      );

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws when the token endpoint returns a non-OK response without exposing tokens', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow('token exchange failed');
    });

    it('throws when token response is missing access_token', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
      });

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws when token response is missing refresh_token', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          expires_in: 3600,
        }),
      });

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws when token response has invalid expires_in', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 'not-a-number',
        }),
      });

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('does not mark session used when token exchange fails', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      try {
        await service.completeCallback({ code: 'code-1', state: 'state-1' });
      } catch {
        // expected
      }

      expect(sessionRepo.markUsed).not.toHaveBeenCalled();
    });

    it('does not mark session used when secret update fails', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: JSON.stringify({}),
      });
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });
      secretCrud.update.mockRejectedValue(new Error('db error'));

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow('db error');

      expect(sessionRepo.markUsed).not.toHaveBeenCalled();
    });

    it('includes code_verifier in token exchange request', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: JSON.stringify({}),
      });
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });
      secretCrud.update.mockResolvedValue(createMockSecretStore());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
      });

      await service.completeCallback({ code: 'code-1', state: 'state-1' });

      const fetchCall = global.fetch.mock.calls[0];
      const body = fetchCall[1].body as URLSearchParams;
      expect(body.get('code_verifier')).toBe('code-verifier-value');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('code-1');
    });

    it('sends client_secret when oauth_client_secret_id is configured with client_secret field', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: JSON.stringify({}),
      });
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'my-client-secret' }),
      });
      secretCrud.update.mockResolvedValue(createMockSecretStore());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
      });

      await service.completeCallback({ code: 'code-1', state: 'state-1' });

      const fetchCall = global.fetch.mock.calls[0];
      const body = fetchCall[1].body as URLSearchParams;
      expect(body.get('client_secret')).toBe('my-client-secret');
    });

    it('sends client_secret when oauth_client_secret_id is configured with clientSecret field', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ oauth_client_secret_id: 'secret-cs-2' }),
      );
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: JSON.stringify({}),
      });
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-cs-2',
        decryptedValue: JSON.stringify({ clientSecret: 'camel-secret' }),
      });
      secretCrud.update.mockResolvedValue(createMockSecretStore());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
      });

      await service.completeCallback({ code: 'code-1', state: 'state-1' });

      const fetchCall = global.fetch.mock.calls[0];
      const body = fetchCall[1].body as URLSearchParams;
      expect(body.get('client_secret')).toBe('camel-secret');
    });

    it('omits client_secret when oauth_client_secret_id is not configured', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ oauth_client_secret_id: null }),
      );
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: JSON.stringify({}),
      });
      secretCrud.update.mockResolvedValue(createMockSecretStore());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
      });

      await service.completeCallback({ code: 'code-1', state: 'state-1' });

      const fetchCall = global.fetch.mock.calls[0];
      const body = fetchCall[1].body as URLSearchParams;
      expect(body.has('client_secret')).toBe(false);
    });

    it('throws when client secret payload cannot be parsed', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: JSON.stringify({}),
      });
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-cs-1',
        decryptedValue: 'not-valid-json',
      });

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when client secret payload does not contain a recognisable client secret', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ other: 'data' }),
      });

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not expose tokens in error messages on fetch failure', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValue({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });

      global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow('network error');

      expect(sessionRepo.markUsed).not.toHaveBeenCalled();
    });

    it('uses session redirect_uri when provider oauth_redirect_uri is null', async () => {
      const customSession = sessionFixture({
        redirect_uri: 'http://custom.example/callback',
      });
      sessionRepo.findUnusedByStateHash.mockResolvedValue(customSession);
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ oauth_redirect_uri: null }),
      );
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: JSON.stringify({}),
      });
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });
      secretCrud.update.mockResolvedValue(createMockSecretStore());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
      });

      await service.completeCallback({ code: 'code-1', state: 'state-1' });

      const fetchCall = global.fetch.mock.calls[0];
      const body = fetchCall[1].body as URLSearchParams;
      expect(body.get('redirect_uri')).toBe('http://custom.example/callback');
    });

    it('rejects an inactive provider and does not call downstream services', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ is_active: false }),
      );

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(NotFoundException);

      expect(secretCrud.findByIdRaw).not.toHaveBeenCalled();
      expect(secretCrud.update).not.toHaveBeenCalled();
      expect(sessionRepo.markUsed).not.toHaveBeenCalled();
    });

    it('throws when existing secret value cannot be parsed and does not update or mark used', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: 'not-valid-json{{{',
      });
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(secretCrud.update).not.toHaveBeenCalled();
      expect(sessionRepo.markUsed).not.toHaveBeenCalled();
    });

    it('rejects when session owner_type does not match provider owner_type', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(
        sessionFixture({ owner_type: 'user' }),
      );
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ owner_type: 'global', owner_id: null }),
      );

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow('Session owner does not match provider owner');

      expect(secretCrud.update).not.toHaveBeenCalled();
      expect(sessionRepo.markUsed).not.toHaveBeenCalled();
    });

    it('rejects when session owner_id does not match provider owner_id', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(
        sessionFixture({ owner_type: 'user', owner_id: 'user-1' }),
      );
      providerRepo.findById.mockResolvedValue(
        oauthProviderFixture({ owner_type: 'user', owner_id: 'user-2' }),
      );

      await expect(
        service.completeCallback({ code: 'code-1', state: 'state-1' }),
      ).rejects.toThrow('Session owner does not match provider owner');

      expect(secretCrud.update).not.toHaveBeenCalled();
      expect(sessionRepo.markUsed).not.toHaveBeenCalled();
    });

    it('supplies AbortController signal to token exchange fetch', async () => {
      sessionRepo.findUnusedByStateHash.mockResolvedValue(sessionFixture());
      providerRepo.findById.mockResolvedValue(oauthProviderFixture());
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-1',
        decryptedValue: JSON.stringify({}),
      });
      secretCrud.findByIdRaw.mockResolvedValueOnce({
        id: 'secret-cs-1',
        decryptedValue: JSON.stringify({ client_secret: 'secret-value' }),
      });
      secretCrud.update.mockResolvedValue(createMockSecretStore());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
      });

      await service.completeCallback({ code: 'code-1', state: 'state-1' });

      const fetchCall = global.fetch.mock.calls[0];
      expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('refreshAccessToken', () => {
    it('POSTs grant_type=refresh_token and persists rotated tokens', async () => {
      const provider = {
        id: 'prov-1',
        name: 'anthropic-claude-code',
        auth_type: 'oauth',
        is_active: true,
        secret_id: 'sec-1',
        oauth_token_url: 'https://auth.example/token',
        oauth_client_id: 'client-1',
        oauth_client_secret_id: null,
      } as unknown as LlmProvider;

      vi.spyOn(service, 'loadExistingSecretValue').mockResolvedValue({
        oauth: {
          accessToken: 'old',
          refreshToken: 'old-refresh',
          expiresAt: 1,
        },
      });
      vi.spyOn(service, 'loadOAuthClientSecret').mockResolvedValue(null);

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 },
        ),
      );

      const updateSpy = vi
        .spyOn(secretCrud, 'update')
        .mockResolvedValue(undefined);

      const result = await service.refreshAccessToken(provider);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://auth.example/token');
      const body = (init as RequestInit).body as URLSearchParams;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('old-refresh');
      expect(body.get('client_id')).toBe('client-1');

      expect(updateSpy).toHaveBeenCalledWith('sec-1', {
        value: expect.objectContaining({
          oauth: expect.objectContaining({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
          }),
        }),
      });
      expect(result.accessToken).toBe('new-access');

      fetchMock.mockRestore();
    });

    it('throws a clear re-auth error when the refresh POST fails', async () => {
      const provider = {
        id: 'prov-1',
        name: 'anthropic-claude-code',
        auth_type: 'oauth',
        is_active: true,
        secret_id: 'sec-1',
        oauth_token_url: 'https://auth.example/token',
        oauth_client_id: 'client-1',
        oauth_client_secret_id: null,
      } as unknown as LlmProvider;

      vi.spyOn(service, 'loadExistingSecretValue').mockResolvedValue({
        oauth: {
          accessToken: 'old',
          refreshToken: 'old-refresh',
          expiresAt: 1,
        },
      });
      vi.spyOn(service, 'loadOAuthClientSecret').mockResolvedValue(null);

      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('nope', { status: 400 }));

      await expect(service.refreshAccessToken(provider)).rejects.toThrow(
        /re-authenticate|refresh failed/i,
      );

      fetchMock.mockRestore();
    });

    it('throws an actionable re-auth error when a 200 response body is malformed', async () => {
      const provider = {
        id: 'prov-1',
        name: 'anthropic-claude-code',
        auth_type: 'oauth',
        is_active: true,
        secret_id: 'sec-1',
        oauth_token_url: 'https://auth.example/token',
        oauth_client_id: 'client-1',
        oauth_client_secret_id: null,
      } as unknown as LlmProvider;

      vi.spyOn(service, 'loadExistingSecretValue').mockResolvedValue({
        oauth: {
          accessToken: 'old',
          refreshToken: 'old-refresh',
          expiresAt: 1,
        },
      });
      vi.spyOn(service, 'loadOAuthClientSecret').mockResolvedValue(null);

      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 }),
        );

      await expect(service.refreshAccessToken(provider)).rejects.toThrow(
        /re-authenticate|invalid token response/i,
      );

      fetchMock.mockRestore();
    });

    it('delegates to the pi provider when runtime_env.pi_provider is set even with empty oauth_client_id', async () => {
      const provider = {
        id: 'p',
        name: 'anthropic-claude-code',
        auth_type: 'oauth',
        is_active: true,
        secret_id: 'sec-1',
        oauth_token_url: 'https://platform.claude.com/v1/oauth/token',
        oauth_client_id: null,
        oauth_client_secret_id: null,
        runtime_env: { pi_provider: 'anthropic' },
      } as unknown as LlmProvider;

      vi.spyOn(service, 'loadExistingSecretValue').mockResolvedValue({
        oauth: {
          accessToken: 'old-access',
          refreshToken: 'old-refresh',
          expiresAt: 1,
        },
      });

      const piRefreshToken = vi.fn().mockResolvedValue({
        refresh: 'rotated-refresh',
        access: 'new-access',
        expires: 1_700_000_000_000,
      });
      oauthProviderResolver.resolve.mockResolvedValue({
        refreshToken: piRefreshToken,
      });

      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const updateSpy = vi
        .spyOn(secretCrud, 'update')
        .mockResolvedValue(undefined);

      const result = await service.refreshAccessToken(provider);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(piRefreshToken).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: 'old-refresh' }),
      );
      expect(updateSpy).toHaveBeenCalledWith('sec-1', {
        value: expect.objectContaining({
          oauth: expect.objectContaining({
            accessToken: 'new-access',
            refreshToken: 'rotated-refresh',
            expiresAt: 1_700_000_000_000,
          }),
        }),
      });
      expect(result.accessToken).toBe('new-access');

      fetchMock.mockRestore();
    });

    it('falls back to the token endpoint when pi_provider is set but the resolver returns undefined', async () => {
      const provider = {
        id: 'prov-1',
        name: 'anthropic-claude-code',
        auth_type: 'oauth',
        is_active: true,
        secret_id: 'sec-1',
        oauth_token_url: 'https://auth.example/token',
        oauth_client_id: 'client-1',
        oauth_client_secret_id: null,
        runtime_env: { pi_provider: 'unknown' },
      } as unknown as LlmProvider;

      vi.spyOn(service, 'loadExistingSecretValue').mockResolvedValue({
        oauth: {
          accessToken: 'old',
          refreshToken: 'old-refresh',
          expiresAt: 1,
        },
      });
      vi.spyOn(service, 'loadOAuthClientSecret').mockResolvedValue(null);

      oauthProviderResolver.resolve.mockResolvedValue(undefined);

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 },
        ),
      );

      const updateSpy = vi
        .spyOn(secretCrud, 'update')
        .mockResolvedValue(undefined);

      const result = await service.refreshAccessToken(provider);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith('sec-1', {
        value: expect.objectContaining({
          oauth: expect.objectContaining({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
          }),
        }),
      });
      expect(result.accessToken).toBe('new-access');

      fetchMock.mockRestore();
    });
  });

  describe('ensureFreshOAuthCredential', () => {
    function oauthProvider(): LlmProvider {
      return {
        id: 'prov-1',
        name: 'anthropic-claude-code',
        auth_type: 'oauth',
        is_active: true,
        secret_id: 'sec-1',
        oauth_token_url: 'https://auth.example/token',
        oauth_client_id: 'client-1',
        oauth_client_secret_id: null,
      } as unknown as LlmProvider;
    }

    it('does NOT refresh a comfortably-valid token', async () => {
      vi.spyOn(service, 'loadExistingSecretValue').mockResolvedValue({
        oauth: {
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: Date.now() + 3_600_000,
        },
      });
      const refreshSpy = vi.spyOn(service, 'refreshAccessToken');

      await service.ensureFreshOAuthCredential(oauthProvider());

      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('refreshes an expiring token exactly once under concurrent callers', async () => {
      vi.spyOn(service, 'loadExistingSecretValue').mockResolvedValue({
        oauth: {
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: Date.now() + 1000,
        },
      });
      const refreshSpy = vi
        .spyOn(service, 'refreshAccessToken')
        .mockResolvedValue({
          accessToken: 'new',
          refreshToken: 'new-r',
          expiresAt: Date.now() + 3_600_000,
        });

      await Promise.all([
        service.ensureFreshOAuthCredential(oauthProvider()),
        service.ensureFreshOAuthCredential(oauthProvider()),
        service.ensureFreshOAuthCredential(oauthProvider()),
      ]);

      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for non-oauth providers', async () => {
      const refreshSpy = vi.spyOn(service, 'refreshAccessToken');
      await service.ensureFreshOAuthCredential({
        id: 'p',
        name: 'deepseek',
        auth_type: 'api_key',
      } as unknown as LlmProvider);
      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });
});
