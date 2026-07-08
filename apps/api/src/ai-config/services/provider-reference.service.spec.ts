import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ProviderReferenceService } from './provider-reference.service';
import { LlmProviderRepository } from '../database/repositories/llm-provider.repository';
import { LlmProvider } from '../database/entities/llm-provider.entity';
import { createMockLlmProvider } from '../__tests__/setup/ai-config-mocks.factory';

const providerFixture = (overrides?: Partial<LlmProvider>): LlmProvider =>
  createMockLlmProvider({
    id: 'provider-1',
    name: 'openai',
    auth_type: 'api_key',
    is_active: true,
    owner_type: 'global',
    owner_id: null,
    ...overrides,
  });

describe('ProviderReferenceService', () => {
  let service: ProviderReferenceService;
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    findActiveByOwnerAndName: ReturnType<typeof vi.fn>;
    findByName: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repo = {
      findById: vi.fn(),
      findActiveByOwnerAndName: vi.fn(),
      findByName: vi.fn(),
    };

    service = new ProviderReferenceService(
      repo as unknown as LlmProviderRepository,
    );
  });

  describe('resolve', () => {
    it('uses provider_id without fallback', async () => {
      repo.findById.mockResolvedValue(providerFixture({ id: 'provider-1' }));

      const result = await service.resolve({
        providerId: 'provider-1',
        executionContext: { ownerType: 'user', ownerId: 'user-1' },
      });

      expect(result.id).toBe('provider-1');
      expect(repo.findActiveByOwnerAndName).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when provider_id is not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.resolve({ providerId: 'nonexistent' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when provider_id is inactive', async () => {
      repo.findById.mockResolvedValue(
        providerFixture({ id: 'provider-1', is_active: false }),
      );

      await expect(
        service.resolve({ providerId: 'provider-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolves by providerSource + providerName within specified source', async () => {
      repo.findActiveByOwnerAndName.mockResolvedValue(
        providerFixture({
          id: 'provider-user',
          name: 'openai',
          owner_type: 'user',
          owner_id: 'user-1',
        }),
      );

      const result = await service.resolve({
        providerSource: 'user',
        providerName: 'openai',
        executionContext: { ownerType: 'user', ownerId: 'user-1' },
      });

      expect(result.id).toBe('provider-user');
      expect(repo.findByName).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when providerSource + providerName resolves nothing', async () => {
      repo.findActiveByOwnerAndName.mockResolvedValue(null);

      await expect(
        service.resolve({
          providerSource: 'user',
          providerName: 'openai',
          executionContext: { ownerType: 'user', ownerId: 'user-1' },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolves unqualified providerName via execution context first', async () => {
      repo.findActiveByOwnerAndName.mockResolvedValueOnce(
        providerFixture({
          id: 'provider-scope',
          name: 'openai',
          owner_type: 'scope',
          owner_id: 'scope-1',
        }),
      );

      const result = await service.resolve({
        providerName: 'openai',
        executionContext: { ownerType: 'scope', ownerId: 'scope-1' },
      });

      expect(result.id).toBe('provider-scope');
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.findActiveByOwnerAndName).toHaveBeenCalledTimes(1);
    });

    it('falls back from execution context to global for unqualified provider names', async () => {
      repo.findActiveByOwnerAndName
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(providerFixture({ owner_type: 'global' }));

      const result = await service.resolve({
        providerName: 'openai',
        executionContext: { ownerType: 'scope', ownerId: 'scope-1' },
      });

      expect(result.owner_type).toBe('global');
      expect(repo.findActiveByOwnerAndName).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundException when neither context nor global resolves unqualified providerName', async () => {
      repo.findActiveByOwnerAndName.mockResolvedValue(null);

      await expect(
        service.resolve({
          providerName: 'openai',
          executionContext: { ownerType: 'scope', ownerId: 'scope-1' },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no identifying fields are provided', async () => {
      await expect(service.resolve({})).rejects.toThrow(NotFoundException);
    });

    it('skips duplicate lookup when execution context is already global', async () => {
      repo.findActiveByOwnerAndName.mockResolvedValueOnce(
        providerFixture({ owner_type: 'global' }),
      );

      const result = await service.resolve({
        providerName: 'openai',
        executionContext: { ownerType: 'global', ownerId: null },
      });

      expect(result.owner_type).toBe('global');
      expect(repo.findActiveByOwnerAndName).toHaveBeenCalledTimes(1);
      expect(repo.findActiveByOwnerAndName).toHaveBeenCalledWith({
        ownerType: 'global',
        ownerId: null,
        name: 'openai',
      });
    });

    it('skips duplicate lookup when execution context is global and misses, then throws', async () => {
      repo.findActiveByOwnerAndName.mockResolvedValue(null);

      await expect(
        service.resolve({
          providerName: 'openai',
          executionContext: { ownerType: 'global', ownerId: null },
        }),
      ).rejects.toThrow(NotFoundException);

      expect(repo.findActiveByOwnerAndName).toHaveBeenCalledTimes(1);
    });

    it('does not swallow non-NotFound repository errors', async () => {
      const dbError = new Error('connection refused');
      repo.findById.mockRejectedValue(dbError);

      await expect(
        service.resolve({ providerId: 'provider-1' }),
      ).rejects.toThrow('connection refused');
    });
  });
});
