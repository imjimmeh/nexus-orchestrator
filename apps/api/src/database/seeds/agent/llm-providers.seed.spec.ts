import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { DEFAULT_LLM_PROVIDERS, seedLlmProviders } from './llm-providers.seed';

describe('seedLlmProviders', () => {
  const repository = {
    findOne: vi.fn(),
    create: vi.fn((value) => value),
    save: vi.fn(),
  };

  const dataSource = {
    getRepository: vi.fn(() => repository),
  } as unknown as DataSource;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the default provider when missing', async () => {
    repository.findOne.mockResolvedValue(null);

    await seedLlmProviders(dataSource);

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { name: DEFAULT_LLM_PROVIDERS[0].name, owner_type: 'global' },
    });
    expect(repository.create).toHaveBeenCalledWith(DEFAULT_LLM_PROVIDERS[0]);
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('links seeded provider to env-seeded secret when provided', async () => {
    repository.findOne.mockResolvedValue(null);

    await seedLlmProviders(dataSource, { secretId: 'secret-123' });

    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        name: DEFAULT_LLM_PROVIDERS[0].name,
        owner_type: 'global',
      },
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: DEFAULT_LLM_PROVIDERS[0].name,
        secret_id: 'secret-123',
      }),
    );
  });

  it('includes the anthropic OAuth provider with all five OAuth fields', () => {
    const anthropic = DEFAULT_LLM_PROVIDERS.find(
      (p) => p.provider_id === 'anthropic',
    );

    expect(anthropic).toBeDefined();
    expect(anthropic).toMatchObject({
      name: 'Anthropic (Claude Pro/Max)',
      auth_type: 'oauth',
      oauth_client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      oauth_authorization_url: 'https://claude.ai/oauth/authorize',
      oauth_token_url: 'https://platform.claude.com/v1/oauth/token',
      oauth_redirect_uri: 'http://localhost:53692/callback',
      oauth_scopes: [
        'org:create_api_key',
        'user:profile',
        'user:inference',
        'user:sessions:claude_code',
        'user:mcp_servers',
        'user:file_upload',
      ],
      runtime_env: { pi_provider: 'anthropic' },
      is_active: true,
    });
  });

  it('backfills OAuth columns on an existing anthropic row', async () => {
    const defaultProvider = DEFAULT_LLM_PROVIDERS[0];
    const anthropic = DEFAULT_LLM_PROVIDERS.find(
      (p) => p.provider_id === 'anthropic',
    )!;

    repository.findOne.mockImplementation((query) => {
      const name = (query as { where: { name: string } }).where.name;
      if (name === defaultProvider.name) {
        return Promise.resolve({
          id: 'provider-1',
          name: defaultProvider.name,
          auth_type: defaultProvider.auth_type,
          secret_id: null,
          runtime_env: defaultProvider.runtime_env,
          is_active: defaultProvider.is_active,
        });
      }
      return Promise.resolve({
        id: 'provider-anthropic',
        name: anthropic.name,
        provider_id: 'anthropic',
        auth_type: 'oauth',
        secret_id: null,
        oauth_authorization_url: null,
        oauth_token_url: null,
        oauth_client_id: null,
        oauth_client_secret_id: null,
        oauth_redirect_uri: null,
        oauth_scopes: null,
        runtime_env: anthropic.runtime_env,
        is_active: true,
      });
    });

    await seedLlmProviders(dataSource);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'provider-anthropic',
        oauth_client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
        oauth_authorization_url: 'https://claude.ai/oauth/authorize',
        oauth_token_url: 'https://platform.claude.com/v1/oauth/token',
        oauth_redirect_uri: 'http://localhost:53692/callback',
        oauth_scopes: [
          'org:create_api_key',
          'user:profile',
          'user:inference',
          'user:sessions:claude_code',
          'user:mcp_servers',
          'user:file_upload',
        ],
      }),
    );
  });

  it('updates an existing provider when seeded defaults differ', async () => {
    const providerName = DEFAULT_LLM_PROVIDERS[0].name;
    repository.findOne.mockImplementation((query) => {
      const name = (query as { where: { name: string } }).where.name;
      if (name === providerName) {
        return Promise.resolve({
          id: 'provider-1',
          name: providerName,
          auth_type: 'oauth',
          secret_id: 'secret-1',
          runtime_env: {},
          is_active: false,
        });
      }
      return Promise.resolve({
        id: 'provider-anthropic',
        name: 'Anthropic',
        provider_id: 'anthropic',
        auth_type: 'oauth',
        secret_id: null,
        oauth_authorization_url: 'https://claude.ai/oauth/authorize',
        oauth_token_url: 'https://platform.claude.com/v1/oauth/token',
        oauth_client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
        oauth_client_secret_id: null,
        oauth_redirect_uri: 'http://localhost:53692/callback',
        oauth_scopes: [
          'org:create_api_key',
          'user:profile',
          'user:inference',
          'user:sessions:claude_code',
          'user:mcp_servers',
          'user:file_upload',
        ],
        runtime_env: {},
        is_active: true,
      });
    });

    await seedLlmProviders(dataSource);

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { name: providerName, owner_type: 'global' },
    });
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'provider-1',
        name: providerName,
        auth_type: DEFAULT_LLM_PROVIDERS[0].auth_type,
        runtime_env: DEFAULT_LLM_PROVIDERS[0].runtime_env,
        is_active: DEFAULT_LLM_PROVIDERS[0].is_active,
      }),
    );
  });

  it('does not target a user-scoped provider with the same name', async () => {
    const providerName = DEFAULT_LLM_PROVIDERS[0].name;
    repository.findOne.mockResolvedValue(null);

    await seedLlmProviders(dataSource);

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { name: providerName, owner_type: 'global' },
    });
    expect(repository.create).toHaveBeenCalled();
  });

  it('does not link the env-seeded secret to a newly created OAuth provider', async () => {
    repository.findOne.mockResolvedValue(null);

    await seedLlmProviders(dataSource, { secretId: 'secret-123' });

    const anthropic = DEFAULT_LLM_PROVIDERS.find(
      (p) => p.provider_id === 'anthropic',
    )!;
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: anthropic.name,
        secret_id: null,
      }),
    );
  });

  it('does not overwrite an existing OAuth provider secret_id with the env-seeded secret', async () => {
    const defaultProvider = DEFAULT_LLM_PROVIDERS[0];
    const anthropic = DEFAULT_LLM_PROVIDERS.find(
      (p) => p.provider_id === 'anthropic',
    )!;

    repository.findOne.mockImplementation((query) => {
      const name = (query as { where: { name: string } }).where.name;
      if (name === defaultProvider.name) {
        return Promise.resolve({
          id: 'provider-1',
          name: defaultProvider.name,
          auth_type: defaultProvider.auth_type,
          secret_id: null,
          runtime_env: defaultProvider.runtime_env,
          is_active: defaultProvider.is_active,
        });
      }
      return Promise.resolve({
        id: 'provider-anthropic',
        name: anthropic.name,
        provider_id: 'anthropic',
        auth_type: 'oauth',
        secret_id: 'existing-oauth-secret-id',
        oauth_authorization_url: anthropic.oauth_authorization_url,
        oauth_token_url: anthropic.oauth_token_url,
        oauth_client_id: anthropic.oauth_client_id,
        oauth_client_secret_id: null,
        oauth_redirect_uri: anthropic.oauth_redirect_uri,
        oauth_scopes: anthropic.oauth_scopes,
        runtime_env: anthropic.runtime_env,
        is_active: true,
      });
    });

    await seedLlmProviders(dataSource, { secretId: 'secret-123' });

    expect(repository.save).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'provider-anthropic',
        secret_id: 'secret-123',
      }),
    );
  });
});
