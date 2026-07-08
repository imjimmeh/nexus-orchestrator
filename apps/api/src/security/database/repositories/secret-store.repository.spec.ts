import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { vi } from 'vitest';
import { SecretStore } from '../entities/secret-store.entity';
import { SecretStoreRepository } from './secret-store.repository';

describe('SecretStoreRepository', () => {
  let repository: SecretStoreRepository;
  let queryBuilder: {
    where: ReturnType<typeof vi.fn>;
    andWhere: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    getMany: ReturnType<typeof vi.fn>;
  };
  let typeormRepo: {
    findOne: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    merge: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  const defaultDate = new Date('2026-01-01T00:00:00Z');

  function buildSecret(overrides: Partial<SecretStore> = {}): SecretStore {
    return {
      id: 'secret-1',
      name: 'openai-secret',
      encrypted_value: 'encrypted-payload',
      metadata: {},
      owner_type: 'global',
      owner_id: null,
      created_at: defaultDate,
      updated_at: defaultDate,
      ...overrides,
    };
  }

  beforeEach(async () => {
    queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    typeormRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
      merge: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const module = await Test.createTestingModule({
      providers: [
        SecretStoreRepository,
        {
          provide: getRepositoryToken(SecretStore),
          useValue: typeormRepo,
        },
      ],
    }).compile();

    repository = module.get(SecretStoreRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findByName', () => {
    it('finds by name for global-only lookup', async () => {
      const secret = buildSecret();
      typeormRepo.findOne.mockResolvedValue(secret);

      const result = await repository.findByName('openai-secret');

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'openai-secret', owner_type: 'global' },
      });
      expect(result).toEqual(secret);
    });

    it('returns null when not found', async () => {
      typeormRepo.findOne.mockResolvedValue(null);

      const result = await repository.findByName('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByOwnerAndName', () => {
    it('finds global secret with null owner_id', async () => {
      const secret = buildSecret({ owner_type: 'global', owner_id: null });
      typeormRepo.findOne.mockResolvedValue(secret);

      const result = await repository.findByOwnerAndName({
        ownerType: 'global',
        ownerId: null,
        name: 'openai-secret',
      });

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: {
          owner_type: 'global',
          owner_id: IsNull(),
          name: 'openai-secret',
        },
      });
      expect(result).toEqual(secret);
    });

    it('finds user-scoped secret with owner_id', async () => {
      const secret = buildSecret({
        owner_type: 'user',
        owner_id: 'user-123',
      });
      typeormRepo.findOne.mockResolvedValue(secret);

      const result = await repository.findByOwnerAndName({
        ownerType: 'user',
        ownerId: 'user-123',
        name: 'my-secret',
      });

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: {
          owner_type: 'user',
          owner_id: 'user-123',
          name: 'my-secret',
        },
      });
      expect(result).toEqual(secret);
    });

    it('finds scope-scoped secret with scope owner_id', async () => {
      const secret = buildSecret({
        owner_type: 'scope',
        owner_id: 'ctx-scope-1',
      });
      typeormRepo.findOne.mockResolvedValue(secret);

      const result = await repository.findByOwnerAndName({
        ownerType: 'scope',
        ownerId: 'ctx-scope-1',
        name: 'scope-secret',
      });

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: {
          owner_type: 'scope',
          owner_id: 'ctx-scope-1',
          name: 'scope-secret',
        },
      });
      expect(result).toEqual(secret);
    });

    it('returns null when not found', async () => {
      typeormRepo.findOne.mockResolvedValue(null);

      const result = await repository.findByOwnerAndName({
        ownerType: 'user',
        ownerId: 'user-456',
        name: 'missing',
      });

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('finds secret by id', async () => {
      const secret = buildSecret();
      typeormRepo.findOne.mockResolvedValue(secret);

      const result = await repository.findById('secret-1');

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'secret-1' },
      });
      expect(result).toEqual(secret);
    });
  });

  describe('findAll', () => {
    it('returns all secrets ordered by created_at descending when no scopeIds given', async () => {
      queryBuilder.getMany.mockResolvedValue([buildSecret()]);

      const result = await repository.findAll();

      expect(result).toHaveLength(1);
      expect(typeormRepo.createQueryBuilder).toHaveBeenCalledWith('secret');
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'secret.created_at',
        'DESC',
      );
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('confines scope-owned secrets to the accessible scopeIds', async () => {
      await repository.findAll({ scopeIds: ['team-a'] });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "(secret.owner_type != 'scope' OR secret.owner_id = ANY(:scopeIds))",
        { scopeIds: ['team-a'] },
      );
    });

    it('excludes scope-owned secrets when the accessible scopeIds set is empty', async () => {
      await repository.findAll({ scopeIds: [] });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "secret.owner_type != 'scope'",
      );
    });
  });
});
