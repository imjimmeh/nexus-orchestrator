import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ProviderCrudService } from './provider-crud.service';
import { LlmProviderRepository } from '../../database/repositories/llm-provider.repository';
import { RunnerProviderSelectionService } from '../runner-provider-selection.service';

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

const mockProvider = (overrides?: Partial<Record<string, unknown>>) =>
  ({
    id: 'provider-1',
    name: 'ChatGPT Plus/Pro (Codex Subscription)',
    auth_type: 'oauth',
    runtime_env: { pi_provider: 'openai-codex' },
    oauth_authorization_url: 'https://auth.openai.com/oauth/authorize',
    oauth_token_url: 'https://auth.openai.com/oauth/token',
    oauth_client_id: null,
    oauth_client_secret_id: null,
    oauth_scopes: null,
    oauth_redirect_uri: 'http://localhost:3120/providers/oauth/callback',
    is_active: true,
    owner_type: 'global',
    owner_id: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  }) as unknown as import('../../database/entities/llm-provider.entity').LlmProvider;

describe('ProviderCrudService', () => {
  let service: ProviderCrudService;
  const repository = {
    findAll: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    findAllPaginated: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderCrudService,
        { provide: LlmProviderRepository, useValue: repository },
        RunnerProviderSelectionService,
      ],
    }).compile();

    service = module.get<ProviderCrudService>(ProviderCrudService);
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('presets runtime_env.providerConfig for OAuth providers with pi_provider and oauth_token_url', async () => {
      repository.create.mockImplementation((data: unknown) =>
        Promise.resolve(mockProvider(data as Record<string, unknown>)),
      );

      vi.mocked(getModels).mockReturnValue([
        {
          id: 'gpt-5.5',
          name: 'GPT-5.5',
          api: 'openai-codex-responses',
          provider: 'openai-codex',
          baseUrl: 'https://chatgpt.com/backend-api',
          reasoning: true,
          input: ['text', 'image'],
          cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
          contextWindow: 272000,
          maxTokens: 128000,
        },
      ] as ReturnType<typeof getModels>);

      const result = await service.create({
        name: 'ChatGPT Plus/Pro (Codex Subscription)',
        auth_type: 'oauth',
        runtime_env: { pi_provider: 'openai-codex' },
        oauth_token_url: 'https://auth.openai.com/oauth/token',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime_env: expect.objectContaining({
            pi_provider: 'openai-codex',
            providerConfig: expect.objectContaining({
              name: 'ChatGPT Plus/Pro (Codex Subscription)',
              baseUrl: 'https://chatgpt.com/backend-api',
              api: 'openai-codex-responses',
              authHeader: true,
              oauth: expect.objectContaining({
                name: 'ChatGPT Plus/Pro (Codex Subscription)',
                refresh: expect.objectContaining({
                  tokenUrl: 'https://auth.openai.com/oauth/token',
                }),
              }),
            }),
          }),
        }),
      );
      expect(result.runtime_env.providerConfig).toBeDefined();
    });

    it('does not override an explicitly provided runtime_env.providerConfig', async () => {
      const explicitConfig = {
        name: 'Custom',
        baseUrl: 'https://custom.example',
      };
      repository.create.mockImplementation((data: unknown) =>
        Promise.resolve(mockProvider(data as Record<string, unknown>)),
      );

      const result = await service.create({
        name: 'ChatGPT Plus/Pro (Codex Subscription)',
        auth_type: 'oauth',
        runtime_env: {
          pi_provider: 'openai-codex',
          providerConfig: explicitConfig,
        },
        oauth_token_url: 'https://auth.openai.com/oauth/token',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime_env: expect.objectContaining({
            providerConfig: explicitConfig,
          }),
        }),
      );
      expect(result.runtime_env.providerConfig).toEqual(explicitConfig);
    });

    it('leaves non-OAuth providers unchanged', async () => {
      repository.create.mockImplementation((data: unknown) =>
        Promise.resolve(mockProvider(data as Record<string, unknown>)),
      );

      const result = await service.create({
        name: 'openai',
        auth_type: 'api_key',
        runtime_env: { pi_provider: 'openai' },
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime_env: { pi_provider: 'openai' },
        }),
      );
      expect(result.runtime_env.providerConfig).toBeUndefined();
    });
  });

  describe('update', () => {
    it('presets runtime_env.providerConfig when updating an OAuth provider to have pi_provider and oauth_token_url', async () => {
      repository.findById.mockResolvedValue(
        mockProvider({ auth_type: 'oauth' }),
      );
      repository.update.mockImplementation((id: string, data: unknown) =>
        Promise.resolve(mockProvider(data as Record<string, unknown>)),
      );

      vi.mocked(getModels).mockReturnValue([
        {
          id: 'gpt-5.5',
          name: 'GPT-5.5',
          api: 'openai-codex-responses',
          provider: 'openai-codex',
          baseUrl: 'https://chatgpt.com/backend-api',
          reasoning: true,
          input: ['text', 'image'],
          cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
          contextWindow: 272000,
          maxTokens: 128000,
        },
      ] as ReturnType<typeof getModels>);

      const result = await service.update('provider-1', {
        runtime_env: { pi_provider: 'openai-codex' },
        oauth_token_url: 'https://auth.openai.com/oauth/token',
      });

      expect(repository.update).toHaveBeenCalledWith(
        'provider-1',
        expect.objectContaining({
          runtime_env: expect.objectContaining({
            providerConfig: expect.objectContaining({
              name: 'ChatGPT Plus/Pro (Codex Subscription)',
              baseUrl: 'https://chatgpt.com/backend-api',
            }),
          }),
        }),
      );
      expect(result?.runtime_env.providerConfig).toBeDefined();
    });
  });
});
