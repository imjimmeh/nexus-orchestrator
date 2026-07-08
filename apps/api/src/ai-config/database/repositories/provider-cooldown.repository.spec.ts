import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { ProviderCooldown } from '../entities/provider-cooldown.entity';
import { ProviderCooldownRepository } from './provider-cooldown.repository';

describe('ProviderCooldownRepository', () => {
  let typeorm: {
    createQueryBuilder: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let repo: ProviderCooldownRepository;

  beforeEach(() => {
    typeorm = {
      createQueryBuilder: vi.fn(),
      query: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    repo = new ProviderCooldownRepository(
      typeorm as unknown as Repository<ProviderCooldown>,
    );
  });

  it('findActiveProviderNames returns the set of provider names with active cooldowns', async () => {
    const getMany = vi
      .fn()
      .mockResolvedValue([
        { provider_name: 'anthropic-a' },
        { provider_name: 'openai-b' },
      ]);
    typeorm.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      getMany,
    });
    const result = await repo.findActiveProviderNames(
      new Date('2026-06-29T00:00:00Z'),
    );
    expect(result).toEqual(new Set(['anthropic-a', 'openai-b']));
  });
});
