import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThan } from 'typeorm';
import { vi } from 'vitest';
import { ProviderOAuthSession } from '../entities/provider-oauth-session.entity';
import { ProviderOAuthSessionRepository } from './provider-oauth-session.repository';
import { CreateProviderOAuthSessionData } from './provider-oauth-session.repository.types';

describe('ProviderOAuthSessionRepository', () => {
  let repository: ProviderOAuthSessionRepository;
  let typeormRepo: {
    createQueryBuilder: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let queryBuilder: {
    addSelect: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    andWhere: ReturnType<typeof vi.fn>;
    getOne: ReturnType<typeof vi.fn>;
  };

  const now = new Date('2026-06-04T14:00:00Z');
  const defaultDate = new Date('2026-06-04T13:00:00Z');

  function buildSession(
    overrides: Partial<ProviderOAuthSession> = {},
  ): ProviderOAuthSession {
    const session: ProviderOAuthSession = {
      id: 'session-1',
      provider_id: 'provider-1',
      state_hash: 'state-hash-abc',
      code_verifier: 'verifier-secret',
      redirect_uri: 'http://localhost:3120/oauth/callback',
      owner_type: 'global',
      owner_id: null,
      expires_at: new Date('2026-06-04T15:00:00Z'),
      used_at: null,
      created_at: defaultDate,
      updated_at: defaultDate,
    };
    return Object.assign(session, overrides);
  }

  beforeEach(async () => {
    queryBuilder = {
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };

    typeormRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      create: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProviderOAuthSessionRepository,
        {
          provide: getRepositoryToken(ProviderOAuthSession),
          useValue: typeormRepo,
        },
      ],
    }).compile();

    repository = module.get(ProviderOAuthSessionRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findUnusedByStateHash', () => {
    it('uses query builder with addSelect to retrieve code_verifier', async () => {
      const session = buildSession();
      queryBuilder.getOne.mockResolvedValue(session);

      const result = await repository.findUnusedByStateHash(
        'state-hash-abc',
        now,
      );

      expect(typeormRepo.createQueryBuilder).toHaveBeenCalledWith('session');
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'session.code_verifier',
      );
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'session.state_hash = :stateHash',
        { stateHash: 'state-hash-abc' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'session.used_at IS NULL',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'session.expires_at > :now',
        { now },
      );
      expect(queryBuilder.getOne).toHaveBeenCalled();
      expect(result).toEqual(session);
    });

    it('returns null when no matching session found', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      const result = await repository.findUnusedByStateHash(
        'missing-hash',
        now,
      );

      expect(result).toBeNull();
    });
  });

  describe('markUsed', () => {
    it('updates used_at for the given session id', async () => {
      typeormRepo.update.mockResolvedValue({ affected: 1 });

      await repository.markUsed('session-1', now);

      expect(typeormRepo.update).toHaveBeenCalledWith('session-1', {
        used_at: now,
      });
    });
  });

  describe('deleteExpired', () => {
    it('deletes sessions with expires_at less than now', async () => {
      typeormRepo.delete.mockResolvedValue({ affected: 3 });

      await repository.deleteExpired(now);

      expect(typeormRepo.delete).toHaveBeenCalledWith({
        expires_at: LessThan(now),
      });
    });
  });

  describe('create', () => {
    it('creates and saves a session from CreateProviderOAuthSessionData', async () => {
      const data: CreateProviderOAuthSessionData = {
        provider_id: 'provider-1',
        state_hash: 'state-hash-new',
        code_verifier: 'new-verifier',
        redirect_uri: 'http://localhost:3120/oauth/callback',
        owner_type: 'global',
        expires_at: new Date('2026-06-04T15:00:00Z'),
      };

      const createdEntity = buildSession({
        id: 'session-new',
        ...data,
      });

      typeormRepo.create.mockReturnValue(createdEntity);
      typeormRepo.save.mockResolvedValue(createdEntity);

      const result = await repository.create(data);

      expect(typeormRepo.create).toHaveBeenCalledWith(data);
      expect(typeormRepo.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toEqual(createdEntity);
    });

    it('defaults owner_type and owner_id when omitted', async () => {
      const data: CreateProviderOAuthSessionData = {
        provider_id: 'provider-1',
        state_hash: 'state-hash-new',
        code_verifier: 'new-verifier',
        redirect_uri: 'http://localhost:3120/oauth/callback',
        expires_at: new Date('2026-06-04T15:00:00Z'),
      };

      const createdEntity = buildSession({
        id: 'session-new',
        provider_id: 'provider-1',
        state_hash: 'state-hash-new',
        code_verifier: 'new-verifier',
        redirect_uri: 'http://localhost:3120/oauth/callback',
        owner_type: 'global',
        owner_id: null,
        expires_at: new Date('2026-06-04T15:00:00Z'),
        used_at: null,
      });

      typeormRepo.create.mockReturnValue(createdEntity);
      typeormRepo.save.mockResolvedValue(createdEntity);

      const result = await repository.create(data);

      expect(typeormRepo.create).toHaveBeenCalledWith(data);
      expect(result).toEqual(createdEntity);
    });
  });
});
