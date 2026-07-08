import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { FallbackChainEntity } from '../entities/fallback-chain.entity';
import { FallbackChainRepository } from './fallback-chain.repository';

describe('FallbackChainRepository', () => {
  let typeorm: { findOne: ReturnType<typeof vi.fn> };
  let repo: FallbackChainRepository;
  beforeEach(() => {
    typeorm = { findOne: vi.fn() };
    repo = new FallbackChainRepository(
      typeorm as unknown as Repository<FallbackChainEntity>,
    );
  });
  it('findByName queries by unique name', async () => {
    typeorm.findOne.mockResolvedValue({ name: 'default', entries: [] });
    const result = await repo.findByName('default');
    expect(typeorm.findOne).toHaveBeenCalledWith({
      where: { name: 'default' },
    });
    expect(result?.name).toBe('default');
  });
});
