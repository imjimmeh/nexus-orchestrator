import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RefreshTokenService } from './refresh-token.service';
import { RefreshTokenRepository } from '../security/database/repositories/refresh-token.repository';
import { User } from '../users/database/entities/user.entity';
import { RefreshToken } from '../security/database/entities/refresh-token.entity';
import { hashRefreshToken } from './refresh-token-hash.util';
import { REFRESH_TOKEN_HMAC_KEY } from './refresh-token-key.provider';

// Fixed HMAC key for deterministic hashing in tests. 64 hex chars == 32 bytes,
// which matches the SHA-256 digest length used by the HMAC utility.
const TEST_HMAC_KEY = 'a'.repeat(64);
const testTokenHash = hashRefreshToken('any-test-token', TEST_HMAC_KEY);

interface MockRefreshTokenRepository {
  findByTokenHash: ReturnType<typeof vi.fn>;
  createQueryBuilder: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function createMockRefreshTokenRepository(): MockRefreshTokenRepository {
  return {
    findByTokenHash: vi.fn(),
    createQueryBuilder: vi.fn(),
    save: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
}

function createMockConfigService(): { get: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn(),
  };
}

function createUserFixture(overrides: Partial<User> = {}): User {
  return {
    id: '4f32a95c-3b0f-4e15-a5cf-c0e6e8ad7af1',
    username: 'fixture-user',
    email: 'fixture@example.com',
    passwordHash: '$2b$10$fixturehash',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastLoginAt: null,
    deactivatedAt: null,
    passwordChangedAt: null,
    userRoles: [],
    refreshTokens: [],
    ...overrides,
  } as User;
}

function createRefreshTokenFixture(
  user: User,
  overrides: Partial<RefreshToken> = {},
): RefreshToken {
  return {
    id: 'a4f5f9e9-2d9d-4518-bf43-198c82fdb83a',
    tokenHash: testTokenHash,
    user,
    expiresAt: new Date(Date.now() + 60_000),
    isRevoked: false,
    deviceInfo: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as RefreshToken;
}

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let repository: MockRefreshTokenRepository;
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repository = createMockRefreshTokenRepository();
    configService = createMockConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        {
          provide: REFRESH_TOKEN_HMAC_KEY,
          useValue: TEST_HMAC_KEY,
        },
        {
          provide: RefreshTokenRepository,
          useValue: repository,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get(RefreshTokenService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('validateRefreshToken', () => {
    it('uses O(1) HMAC lookup and returns the row for a matching valid token', async () => {
      const user = createUserFixture();
      const plainToken = 'plain-refresh-token';
      const row = createRefreshTokenFixture(user);
      const expectedHash = hashRefreshToken(plainToken, TEST_HMAC_KEY);
      repository.findByTokenHash.mockResolvedValue(row);

      const result = await service.validateRefreshToken(plainToken);

      expect(repository.findByTokenHash).toHaveBeenCalledTimes(1);
      expect(repository.findByTokenHash).toHaveBeenCalledWith(expectedHash);
      // The new O(1) lookup must NOT fall back to the legacy query builder
      // path that scanned every active token row.
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
      expect(result).toBe(row);
    });

    it('returns null when no matching token row exists', async () => {
      repository.findByTokenHash.mockResolvedValue(null);

      const result = await service.validateRefreshToken('missing-token');

      expect(repository.findByTokenHash).toHaveBeenCalledTimes(1);
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('returns null when token is expired', async () => {
      const user = createUserFixture();
      const expiredRow = createRefreshTokenFixture(user, {
        expiresAt: new Date(Date.now() - 60_000),
      });
      repository.findByTokenHash.mockResolvedValue(expiredRow);

      const result = await service.validateRefreshToken('expired-token');

      expect(result).toBeNull();
      expect(repository.findByTokenHash).toHaveBeenCalledTimes(1);
    });

    it('does not return revoked tokens', async () => {
      const user = createUserFixture();
      const revokedRow = createRefreshTokenFixture(user, { isRevoked: true });
      repository.findByTokenHash.mockResolvedValue(revokedRow);

      const result = await service.validateRefreshToken('revoked-token');

      expect(result).toBeNull();
      expect(repository.findByTokenHash).toHaveBeenCalledTimes(1);
    });
  });

  describe('createRefreshToken', () => {
    it('uses JWT_REFRESH_EXPIRY when legacy day key is absent', async () => {
      const user = createUserFixture();
      repository.save.mockResolvedValue(undefined);
      repository.create.mockImplementation((value: unknown) => value);
      configService.get.mockImplementation((key: string) => {
        if (key === 'JWT_REFRESH_EXPIRY_DAYS') {
          return undefined;
        }

        if (key === 'JWT_REFRESH_EXPIRY') {
          return '7d';
        }

        return undefined;
      });

      const createdAt = new Date();
      const token = await service.createRefreshToken(user, false);

      expect(token).toHaveLength(128);
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
      // The stored hash must be the deterministic HMAC digest of the returned
      // plain token so that O(1) lookup can resolve it later.
      const createArg = repository.create.mock.calls[0][0] as {
        tokenHash: string;
        expiresAt: Date;
      };
      expect(createArg.tokenHash).toBe(hashRefreshToken(token, TEST_HMAC_KEY));

      const msPerDay = 24 * 60 * 60 * 1000;
      expect(createArg.expiresAt.getTime()).toBeGreaterThan(
        createdAt.getTime() + 6 * msPerDay,
      );
      expect(createArg.expiresAt.getTime()).toBeLessThan(
        createdAt.getTime() + 8 * msPerDay,
      );
    });

    it('prefers JWT_REFRESH_EXPIRY_DAYS over JWT_REFRESH_EXPIRY when both are set', async () => {
      const user = createUserFixture();
      repository.save.mockResolvedValue(undefined);
      repository.create.mockImplementation((value: unknown) => value);
      configService.get.mockImplementation((key: string) => {
        if (key === 'JWT_REFRESH_EXPIRY_DAYS') {
          return '3';
        }

        if (key === 'JWT_REFRESH_EXPIRY') {
          return '7d';
        }

        return undefined;
      });

      const createdAt = new Date();
      await service.createRefreshToken(user, false);

      const createArg = repository.create.mock.calls[0][0] as {
        expiresAt: Date;
      };
      const msPerDay = 24 * 60 * 60 * 1000;
      expect(createArg.expiresAt.getTime()).toBeGreaterThan(
        createdAt.getTime() + 2 * msPerDay,
      );
      expect(createArg.expiresAt.getTime()).toBeLessThan(
        createdAt.getTime() + 4 * msPerDay,
      );
    });
  });

  describe('revokeRefreshToken', () => {
    it('uses O(1) HMAC lookup and revokes the matched token', async () => {
      const user = createUserFixture();
      const plainToken = 'plain-refresh-token';
      const row = createRefreshTokenFixture(user);
      const expectedHash = hashRefreshToken(plainToken, TEST_HMAC_KEY);
      repository.findByTokenHash.mockResolvedValue(row);
      repository.save.mockResolvedValue({ ...row, isRevoked: true });

      const result = await service.revokeRefreshToken(plainToken);

      expect(repository.findByTokenHash).toHaveBeenCalledTimes(1);
      expect(repository.findByTokenHash).toHaveBeenCalledWith(expectedHash);
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isRevoked: true }),
      );
      expect(result?.isRevoked).toBe(true);
    });

    it('returns null when no matching token row exists', async () => {
      repository.findByTokenHash.mockResolvedValue(null);

      const result = await service.revokeRefreshToken('missing-token');

      expect(result).toBeNull();
      expect(repository.findByTokenHash).toHaveBeenCalledTimes(1);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });
});
