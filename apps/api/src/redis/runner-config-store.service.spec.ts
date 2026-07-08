import { Test, TestingModule } from '@nestjs/testing';
import type { HarnessRuntimeConfig } from '@nexus/core';
import { vi } from 'vitest';
import { RunnerConfigStoreService } from './runner-config-store.service';
import { REDIS_CLIENT } from './redis.constants';

describe('RunnerConfigStoreService', () => {
  let service: RunnerConfigStoreService;

  const FIXTURE_CREDENTIAL = 'fixtureCredential';
  const FIXTURE_API_AUTH = {
    type: 'api_key',
    apiKey: FIXTURE_CREDENTIAL,
  } as const;
  const FIXTURE_OAUTH_AUTH = {
    type: 'oauth',
    credential: {
      type: 'oauth',
      refreshToken: 'fixtureRefreshCredential',
      accessToken: 'fixtureAccessCredential',
      expiresAt: 4102444800000,
    },
  } as const;

  const redisMock = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    getdel: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunnerConfigStoreService,
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    service = module.get<RunnerConfigStoreService>(RunnerConfigStoreService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('store', () => {
    it('should store config with default TTL', async () => {
      const payload: HarnessRuntimeConfig = {
        harnessId: 'pi',
        model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          auth: FIXTURE_API_AUTH,
        },
        prompt: { systemPrompt: 'You are helpful' },
      };

      await service.store('wf-1', 'step-1', payload);

      expect(redisMock.set).toHaveBeenCalledWith(
        'runner-config:wf-1:step-1',
        JSON.stringify(payload),
        'EX',
        300,
      );
    });

    it('should store config with custom TTL', async () => {
      const payload: HarnessRuntimeConfig = {
        harnessId: 'pi',
        model: {
          provider: 'openai',
          model: 'gpt-4o',
          auth: FIXTURE_API_AUTH,
        },
        prompt: { systemPrompt: 'Do stuff' },
      };

      await service.store('wf-2', 'step-a', payload, 600);

      expect(redisMock.set).toHaveBeenCalledWith(
        'runner-config:wf-2:step-a',
        JSON.stringify(payload),
        'EX',
        600,
      );
    });
  });

  describe('pop', () => {
    it('should return null when no config exists', async () => {
      redisMock.getdel.mockResolvedValueOnce(null);

      const result = await service.pop('wf-1', 'step-1');

      expect(result).toBeNull();
      expect(redisMock.getdel).toHaveBeenCalledWith(
        'runner-config:wf-1:step-1',
      );
    });

    it('should return and delete config when it exists', async () => {
      const payload: HarnessRuntimeConfig = {
        harnessId: 'pi',
        model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          auth: FIXTURE_API_AUTH,
        },
        prompt: { systemPrompt: 'Be nice' },
        session: { resumeNodeId: 'node-42' },
      };

      redisMock.getdel.mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.pop('wf-1', 'step-1');

      expect(result).toEqual(payload);
      expect(redisMock.getdel).toHaveBeenCalledWith(
        'runner-config:wf-1:step-1',
      );
    });
  });

  describe('get', () => {
    it('should return null when no config exists', async () => {
      redisMock.get.mockResolvedValueOnce(null);

      const result = await service.get('wf-1', 'step-1');

      expect(result).toBeNull();
      expect(redisMock.get).toHaveBeenCalledWith('runner-config:wf-1:step-1');
    });

    it('should return config without removing it', async () => {
      const payload: HarnessRuntimeConfig = {
        harnessId: 'pi',
        model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          auth: FIXTURE_API_AUTH,
        },
        prompt: { systemPrompt: 'Be nice' },
      };

      redisMock.get.mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.get('wf-1', 'step-1');

      expect(result).toEqual(payload);
      expect(redisMock.get).toHaveBeenCalledWith('runner-config:wf-1:step-1');
      expect(redisMock.getdel).not.toHaveBeenCalled();
    });

    it('should round-trip OAuth auth and provider metadata', async () => {
      const payload: HarnessRuntimeConfig = {
        harnessId: 'pi',
        model: {
          provider: 'corporate-ai',
          model: 'corp-large',
          auth: FIXTURE_OAUTH_AUTH,
          providerConfig: {
            name: 'Corporate AI',
            baseUrl: 'https://ai.corp.example/v1',
            api: 'openai-responses',
            oauth: {
              name: 'Corporate AI (SSO)',
              refresh: {
                tokenUrl: 'https://sso.corp.example/oauth/token',
              },
            },
          },
        },
        prompt: { systemPrompt: 'Be nice' },
      };

      redisMock.get.mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.get('wf-1', 'step-oauth');

      expect(result).toEqual(payload);
      expect(redisMock.get).toHaveBeenCalledWith(
        'runner-config:wf-1:step-oauth',
      );
    });
  });

  describe('delete', () => {
    it('should remove stored config key', async () => {
      await service.delete('wf-1', 'step-1');

      expect(redisMock.del).toHaveBeenCalledWith('runner-config:wf-1:step-1');
    });
  });
});
