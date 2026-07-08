import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BudgetPolicy } from '../entities/budget-policy.entity';
import { BudgetPolicyRepository } from './budget-policy.repository';

describe('BudgetPolicyRepository', () => {
  let repo: BudgetPolicyRepository;
  let queryBuilder: {
    where: ReturnType<typeof vi.fn>;
    andWhere: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    getMany: ReturnType<typeof vi.fn>;
  };
  let mockTypeormRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    findOneBy: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    mockTypeormRepo = {
      create: vi.fn(),
      save: vi.fn(),
      find: vi.fn(),
      findOneBy: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const module = await Test.createTestingModule({
      providers: [
        BudgetPolicyRepository,
        {
          provide: getRepositoryToken(BudgetPolicy),
          useValue: mockTypeormRepo,
        },
      ],
    }).compile();

    repo = module.get(BudgetPolicyRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('createPolicy saves and returns the entity', async () => {
    const input = {
      name: 'Test Policy',
      scope_type: 'global' as const,
      is_active: true,
      enforcement_mode: 'observe' as const,
      window: 'daily' as const,
    };
    mockTypeormRepo.create.mockReturnValue(input);
    mockTypeormRepo.save.mockResolvedValue({ id: 'p1', ...input });

    const result = await repo.createPolicy(input);
    expect(result.id).toBe('p1');
    expect(mockTypeormRepo.save).toHaveBeenCalled();
  });

  it('findActiveByScope returns policies matching scope and active', async () => {
    mockTypeormRepo.find.mockResolvedValue([
      { id: 'p1', scope_type: 'global' },
    ]);

    const result = await repo.findActiveByScope('global', null);
    expect(result).toHaveLength(1);
  });

  it('findById returns the policy when found', async () => {
    mockTypeormRepo.findOneBy.mockResolvedValue({ id: 'p1', name: 'Test' });

    const result = await repo.findById('p1');
    expect(result?.name).toBe('Test');
  });

  it('findById returns null when not found', async () => {
    mockTypeormRepo.findOneBy.mockResolvedValue(null);
    const result = await repo.findById('missing');
    expect(result).toBeNull();
  });

  it('findAllActive returns all active policies', async () => {
    queryBuilder.getMany.mockResolvedValue([
      { id: 'p1', is_active: true },
      { id: 'p2', is_active: true },
    ]);

    const result = await repo.findAllActive();
    expect(result).toHaveLength(2);
    expect(mockTypeormRepo.createQueryBuilder).toHaveBeenCalledWith(
      'budget_policy',
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'budget_policy.is_active = :isActive',
      { isActive: true },
    );
    expect(queryBuilder.andWhere).not.toHaveBeenCalled();
  });

  it('findAllActive confines scope-type policies to the accessible scopeIds', async () => {
    await repo.findAllActive({ scopeIds: ['team-a'] });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "(budget_policy.scope_type != 'scope' OR budget_policy.scope_id = ANY(:scopeIds))",
      { scopeIds: ['team-a'] },
    );
  });

  it('findAllActive excludes scope-type policies when the accessible scopeIds set is empty', async () => {
    await repo.findAllActive({ scopeIds: [] });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "budget_policy.scope_type != 'scope'",
    );
  });

  it('updatePolicy updates and returns the entity', async () => {
    const updated = { id: 'p1', name: 'Updated' };
    mockTypeormRepo.findOneBy.mockResolvedValue(updated);
    mockTypeormRepo.update.mockResolvedValue({ affected: 1 } as any);

    const result = await repo.updatePolicy('p1', { name: 'Updated' });
    expect(result?.name).toBe('Updated');
    expect(mockTypeormRepo.update).toHaveBeenCalled();
  });

  it('disablePolicy sets is_active to false', async () => {
    mockTypeormRepo.update.mockResolvedValue({ affected: 1 } as any);

    await repo.disablePolicy('p1');
    expect(mockTypeormRepo.update).toHaveBeenCalledWith('p1', {
      is_active: false,
    });
  });

  it('deletePolicy removes the entity when found', async () => {
    const entity = { id: 'p1' };
    mockTypeormRepo.findOneBy.mockResolvedValue(entity);
    mockTypeormRepo.remove.mockResolvedValue(entity);

    await repo.deletePolicy('p1');
    expect(mockTypeormRepo.remove).toHaveBeenCalledWith(entity);
  });

  it('deletePolicy does nothing when not found', async () => {
    mockTypeormRepo.findOneBy.mockResolvedValue(null);

    await repo.deletePolicy('missing');
    expect(mockTypeormRepo.remove).not.toHaveBeenCalled();
  });
});
