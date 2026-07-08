import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { vi } from 'vitest';
import { LlmProvider } from '../entities/llm-provider.entity';
import { LlmProviderRepository } from './llm-provider.repository';

describe('LlmProviderRepository', () => {
  let repository: LlmProviderRepository;
  let typeormRepo: {
    findOne: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  const defaultDate = new Date('2026-01-01T00:00:00Z');

  function buildProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
    return {
      id: 'provider-1',
      name: 'openai',
      auth_type: 'api_key',
      secret_id: 'secret-1',
      runtime_env: {},
      is_active: true,
      owner_type: 'global',
      owner_id: null,
      oauth_authorization_url: null,
      oauth_token_url: null,
      oauth_client_id: null,
      oauth_client_secret_id: null,
      oauth_scopes: null,
      oauth_redirect_uri: null,
      created_at: defaultDate,
      updated_at: defaultDate,
      ...overrides,
    };
  }

  beforeEach(async () => {
    typeormRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      createQueryBuilder: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        LlmProviderRepository,
        {
          provide: getRepositoryToken(LlmProvider),
          useValue: typeormRepo,
        },
      ],
    }).compile();

    repository = module.get(LlmProviderRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findByProviderId', () => {
    it('finds active global provider by provider_id', async () => {
      const provider = buildProvider({ provider_id: 'anthropic' });
      typeormRepo.findOne.mockResolvedValue(provider);

      const result = await repository.findByProviderId('anthropic');

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: {
          provider_id: 'anthropic',
          is_active: true,
          owner_type: 'global',
        },
      });
      expect(result).toEqual(provider);
    });

    it('returns null when provider_id is not found', async () => {
      typeormRepo.findOne.mockResolvedValue(null);

      const result = await repository.findByProviderId('unknown');

      expect(result).toBeNull();
    });
  });

  describe('findByName', () => {
    it('finds by name and is_active for global-only lookup', async () => {
      const provider = buildProvider();
      typeormRepo.findOne.mockResolvedValue(provider);

      const result = await repository.findByName('openai');

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'openai', is_active: true, owner_type: 'global' },
      });
      expect(result).toEqual(provider);
    });

    it('returns null when provider not found', async () => {
      typeormRepo.findOne.mockResolvedValue(null);

      const result = await repository.findByName('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findActiveByOwnerAndName', () => {
    it('finds global provider with null owner_id', async () => {
      const provider = buildProvider({ owner_type: 'global', owner_id: null });
      typeormRepo.findOne.mockResolvedValue(provider);

      const result = await repository.findActiveByOwnerAndName({
        ownerType: 'global',
        ownerId: null,
        name: 'openai',
      });

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: {
          is_active: true,
          owner_type: 'global',
          owner_id: IsNull(),
          name: 'openai',
        },
      });
      expect(result).toEqual(provider);
    });

    it('finds user-scoped provider with owner_id', async () => {
      const provider = buildProvider({
        owner_type: 'user',
        owner_id: 'user-123',
      });
      typeormRepo.findOne.mockResolvedValue(provider);

      const result = await repository.findActiveByOwnerAndName({
        ownerType: 'user',
        ownerId: 'user-123',
        name: 'custom-openai',
      });

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: {
          is_active: true,
          owner_type: 'user',
          owner_id: 'user-123',
          name: 'custom-openai',
        },
      });
      expect(result).toEqual(provider);
    });

    it('finds scope-scoped provider with scope owner_id', async () => {
      const provider = buildProvider({
        owner_type: 'scope',
        owner_id: 'ctx-scope-1',
      });
      typeormRepo.findOne.mockResolvedValue(provider);

      const result = await repository.findActiveByOwnerAndName({
        ownerType: 'scope',
        ownerId: 'ctx-scope-1',
        name: 'scope-provider',
      });

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: {
          is_active: true,
          owner_type: 'scope',
          owner_id: 'ctx-scope-1',
          name: 'scope-provider',
        },
      });
      expect(result).toEqual(provider);
    });

    it('returns null when not found', async () => {
      typeormRepo.findOne.mockResolvedValue(null);

      const result = await repository.findActiveByOwnerAndName({
        ownerType: 'user',
        ownerId: 'user-456',
        name: 'missing',
      });

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('finds provider by id', async () => {
      const provider = buildProvider();
      typeormRepo.findOne.mockResolvedValue(provider);

      const result = await repository.findById('provider-1');

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'provider-1' },
      });
      expect(result).toEqual(provider);
    });
  });

  describe('findAllPaginated', () => {
    function mockQb(rows: LlmProvider[], total: number) {
      const qb = {
        alias: 'provider',
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
      const qb = mockQb([buildProvider()], 1);

      await repository.findAllPaginated({ page: 1, limit: 500 });

      expect(qb.take).toHaveBeenCalledWith(100);
      expect(qb.skip).toHaveBeenCalledWith(0);
    });

    it('emits the shared search clause and default sort', async () => {
      const qb = mockQb([], 0);

      await repository.findAllPaginated({ page: 1, limit: 20, search: 'gpt' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(provider.name ILIKE :searchTerm OR provider.auth_type ILIKE :searchTerm)',
        { searchTerm: '%gpt%' },
      );
      expect(qb.orderBy).toHaveBeenCalledWith('provider.created_at', 'DESC');
    });

    it('confines scope-owned providers to the accessible scopeIds', async () => {
      const qb = mockQb([], 0);

      await repository.findAllPaginated({
        page: 1,
        limit: 20,
        scopeIds: ['team-a'],
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        "(provider.owner_type != 'scope' OR provider.owner_id = ANY(:scopeIds))",
        { scopeIds: ['team-a'] },
      );
    });

    it('excludes scope-owned providers when the accessible scopeIds set is empty', async () => {
      const qb = mockQb([], 0);

      await repository.findAllPaginated({
        page: 1,
        limit: 20,
        scopeIds: [],
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        "provider.owner_type != 'scope'",
      );
    });
  });
});
