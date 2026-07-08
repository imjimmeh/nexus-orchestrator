import { vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PasswordHashingService } from './password-hashing.service';

vi.mock('bcrypt', async () => {
  const actual = await vi.importActual<typeof import('bcrypt')>('bcrypt');
  return {
    ...actual,
    hash: vi.fn(),
    compare: vi.fn(),
  };
});

import * as bcrypt from 'bcrypt';

function buildConfigServiceMock(costFactor: number | undefined): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue: number) => {
      if (key === 'PASSWORD_HASH_COST_FACTOR') {
        return costFactor ?? defaultValue;
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

async function buildService(
  configService: ConfigService,
): Promise<PasswordHashingService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PasswordHashingService,
      { provide: ConfigService, useValue: configService },
    ],
  }).compile();

  return module.get<PasswordHashingService>(PasswordHashingService);
}

describe('PasswordHashingService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('hash', () => {
    it('hashes the plain password using the configured cost factor', async () => {
      const configService = buildConfigServiceMock(undefined);
      const service = await buildService(configService);
      vi.mocked(bcrypt.hash).mockResolvedValue(
        '$2b$12$abcdefghijklmnopqrstuv1234567890ABCDEFGHIJKLMNOPQRSTUVW' as never,
      );

      const result = await service.hash('plain-password');

      expect(configService.get).toHaveBeenCalledWith(
        'PASSWORD_HASH_COST_FACTOR',
        12,
      );
      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 12);
      expect(result).toBe(
        '$2b$12$abcdefghijklmnopqrstuv1234567890ABCDEFGHIJKLMNOPQRSTUVW',
      );
    });

    it('uses a custom cost factor when PASSWORD_HASH_COST_FACTOR is set', async () => {
      const configService = buildConfigServiceMock(4);
      const service = await buildService(configService);
      vi.mocked(bcrypt.hash).mockResolvedValue(
        '$2b$04$abcdefghijklmnopqrstu1234567890123456789012345678901234' as never,
      );

      const result = await service.hash('plain-password');

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 4);
      expect(result.startsWith('$2b$04$')).toBe(true);
    });
  });

  describe('verify', () => {
    it('returns true when bcrypt.compare resolves true', async () => {
      const configService = buildConfigServiceMock(undefined);
      const service = await buildService(configService);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const result = await service.verify('plain', 'hashed');

      expect(bcrypt.compare).toHaveBeenCalledWith('plain', 'hashed');
      expect(result).toBe(true);
    });

    it('returns false when bcrypt.compare resolves false', async () => {
      const configService = buildConfigServiceMock(undefined);
      const service = await buildService(configService);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      const result = await service.verify('plain', 'hashed');

      expect(result).toBe(false);
    });
  });

  describe('default cost factor', () => {
    it('falls back to 12 when PASSWORD_HASH_COST_FACTOR is not configured', async () => {
      const configService = buildConfigServiceMock(undefined);
      const service = await buildService(configService);
      vi.mocked(bcrypt.hash).mockResolvedValue(
        '$2b$12$abcdefghijklmnopqrstuv1234567890ABCDEFGHIJKLMNOPQRSTUVW' as never,
      );

      await service.hash('plain-password');

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 12);
    });
  });
});
