import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgentProfile } from '../entities/agent-profile.entity';
import { AgentProfileRepository } from './agent-profile.repository';

describe('AgentProfileRepository', () => {
  let repo: AgentProfileRepository;
  let queryBuilder: {
    orderBy: ReturnType<typeof vi.fn>;
    andWhere: ReturnType<typeof vi.fn>;
    getMany: ReturnType<typeof vi.fn>;
  };
  let mockTypeormRepo: {
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    queryBuilder = {
      orderBy: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    mockTypeormRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const module = await Test.createTestingModule({
      providers: [
        AgentProfileRepository,
        {
          provide: getRepositoryToken(AgentProfile),
          useValue: mockTypeormRepo,
        },
      ],
    }).compile();

    repo = module.get(AgentProfileRepository);
  });

  describe('findAll', () => {
    it('returns all profiles ordered by created_at descending when no scopeIds given', async () => {
      queryBuilder.getMany.mockResolvedValue([
        { id: 'p1' },
        { id: 'p2' },
      ] as AgentProfile[]);

      const result = await repo.findAll();

      expect(result).toHaveLength(2);
      expect(mockTypeormRepo.createQueryBuilder).toHaveBeenCalledWith(
        'agent_profile',
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'agent_profile.created_at',
        'DESC',
      );
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('confines scoped profiles to the accessible scopeIds, keeping NULL/platform rows visible', async () => {
      await repo.findAll({ scopeIds: ['team-a'] });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(agent_profile.scope_node_id IS NULL OR agent_profile.scope_node_id = ANY(:scopeIds))',
        { scopeIds: ['team-a'] },
      );
    });

    it('restricts to NULL/platform-only rows when the accessible scopeIds set is empty', async () => {
      await repo.findAll({ scopeIds: [] });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'agent_profile.scope_node_id IS NULL',
      );
    });
  });
});
