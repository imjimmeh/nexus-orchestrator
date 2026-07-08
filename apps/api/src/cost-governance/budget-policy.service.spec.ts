import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BudgetPolicyService } from './budget-policy.service';
import { BudgetPolicyRepository } from './database/repositories/budget-policy.repository';

describe('BudgetPolicyService', () => {
  let service: BudgetPolicyService;
  let mockRepo: {
    createPolicy: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findAllActive: ReturnType<typeof vi.fn>;
    findActiveByScope: ReturnType<typeof vi.fn>;
    updatePolicy: ReturnType<typeof vi.fn>;
    disablePolicy: ReturnType<typeof vi.fn>;
    deletePolicy: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRepo = {
      createPolicy: vi.fn(),
      findById: vi.fn(),
      findAllActive: vi.fn(),
      findActiveByScope: vi.fn(),
      updatePolicy: vi.fn(),
      disablePolicy: vi.fn(),
      deletePolicy: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        BudgetPolicyService,
        { provide: BudgetPolicyRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(BudgetPolicyService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('create validates enforcement mode is valid', async () => {
    mockRepo.createPolicy.mockResolvedValue({ id: 'p1' } as any);

    await expect(
      service.create({
        name: 'Test',
        scope_type: 'global',
        window: 'daily',
        enforcement_mode: 'invalid' as any,
        is_active: true,
      }),
    ).rejects.toThrow(/enforcement_mode/);
  });

  it('create delegates valid policy to repository', async () => {
    mockRepo.createPolicy.mockResolvedValue({ id: 'p1', name: 'Test' } as any);

    const result = await service.create({
      name: 'Test Policy',
      scope_type: 'global',
      window: 'daily',
      enforcement_mode: 'warn',
      is_active: true,
    });

    expect(result.id).toBe('p1');
    expect(mockRepo.createPolicy).toHaveBeenCalled();
  });

  it('getById returns the policy when found', async () => {
    mockRepo.findById.mockResolvedValue({ id: 'p1' } as any);
    const result = await service.getById('p1');
    expect(result).toBeDefined();
  });

  it('getById throws NotFoundException when not found', async () => {
    mockRepo.findById.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toThrow();
  });

  it('listAll returns active policies', async () => {
    mockRepo.findAllActive.mockResolvedValue([{ id: 'p1' } as any]);
    const result = await service.listAll();
    expect(result).toHaveLength(1);
  });
});
