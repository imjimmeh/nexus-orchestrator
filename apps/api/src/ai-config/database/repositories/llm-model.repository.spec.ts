import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { vi } from 'vitest';
import { LlmModel } from '../entities/llm-model.entity';
import { LlmModelRepository } from './llm-model.repository';

describe('LlmModelRepository', () => {
  let repository: LlmModelRepository;
  let typeormRepo: { createQueryBuilder: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    typeormRepo = { createQueryBuilder: vi.fn() };

    const module = await Test.createTestingModule({
      providers: [
        LlmModelRepository,
        { provide: getRepositoryToken(LlmModel), useValue: typeormRepo },
      ],
    }).compile();

    repository = module.get(LlmModelRepository);
  });

  afterEach(() => vi.clearAllMocks());

  describe('findAllPaginated', () => {
    function mockQb(rows: LlmModel[], total: number) {
      const qb = {
        alias: 'model',
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getCount: vi.fn().mockResolvedValue(total),
        getMany: vi.fn().mockResolvedValue(rows),
      };
      typeormRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    it('clamps page size to a max of 100', async () => {
      const qb = mockQb([], 0);

      await repository.findAllPaginated({ page: 3, limit: 500 });

      expect(qb.take).toHaveBeenCalledWith(100);
      expect(qb.skip).toHaveBeenCalledWith(200);
    });

    it('emits the shared search clause and default sort', async () => {
      const qb = mockQb([], 0);

      await repository.findAllPaginated({ page: 1, limit: 20, search: 'opus' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(model.name ILIKE :searchTerm OR model.provider_name ILIKE :searchTerm)',
        { searchTerm: '%opus%' },
      );
      expect(qb.orderBy).toHaveBeenCalledWith('model.created_at', 'DESC');
    });
  });
});
