import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiAiOAuthProviderResolver } from './pi-ai-oauth-provider.resolver';
import { LlmProviderRepository } from '../ai-config/database/repositories/llm-provider.repository';

const sdkGetOAuthProvider = vi.fn((id: string) => ({
  id,
  name: `sdk-${id}`,
  login: vi.fn(),
  refreshToken: vi.fn(),
  getApiKey: vi.fn(),
}));

vi.mock('@earendil-works/pi-ai/oauth', () => ({
  getOAuthProvider: (id: string) => sdkGetOAuthProvider(id),
}));

const fullTestRow = {
  id: 'test-provider-id',
  provider_id: 'anthropic',
  name: 'Anthropic Test',
  auth_type: 'oauth',
  oauth_client_id: 'test-client-id',
  oauth_authorization_url: 'https://claude.ai/oauth/authorize',
  oauth_token_url: 'https://platform.claude.com/v1/oauth/token',
  oauth_redirect_uri: 'http://localhost:53692/callback',
  oauth_scopes: ['scope:one', 'scope:two'],
};

function createMockLlmProviderRepository(
  row: typeof fullTestRow | null,
): LlmProviderRepository {
  return {
    findByProviderId: vi.fn().mockResolvedValue(row),
  } as unknown as LlmProviderRepository;
}

describe('PiAiOAuthProviderResolver', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('builds the server-less anthropic provider from the LlmProvider DB row for the anthropic preset', async () => {
    const resolver = new PiAiOAuthProviderResolver(
      createMockLlmProviderRepository(fullTestRow),
    );

    const provider = await resolver.resolve('anthropic');

    expect(provider).toBeDefined();
    expect(provider?.id).toBe('anthropic');
    expect(provider?.usesCallbackServer).toBe(false);
    expect(sdkGetOAuthProvider).not.toHaveBeenCalled();
  });

  it('rejects the anthropic preset when the LlmProvider row is missing', async () => {
    const resolver = new PiAiOAuthProviderResolver(
      createMockLlmProviderRepository(null),
    );

    await expect(resolver.resolve('anthropic')).rejects.toThrow(
      /Anthropic LlmProvider row not found or OAuth columns are not configured/,
    );
    expect(sdkGetOAuthProvider).not.toHaveBeenCalled();
  });

  it('delegates non-anthropic presets to the pi-ai SDK registry', async () => {
    const resolver = new PiAiOAuthProviderResolver(
      createMockLlmProviderRepository(null),
    );

    const provider = await resolver.resolve('github-copilot');

    expect(sdkGetOAuthProvider).toHaveBeenCalledWith('github-copilot');
    expect(provider?.id).toBe('github-copilot');
  });
});
