import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { vi } from 'vitest';
import { SecretManagerService } from './secret-manager.service';

describe('SecretManagerService', () => {
  let service: SecretManagerService;

  const configServiceMock = {
    get: vi.fn((key: string) => {
      if (key === 'APP_SECRET') {
        return 'x'.repeat(40);
      }
      return undefined;
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretManagerService,
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
      ],
    }).compile();

    service = module.get(SecretManagerService);
  });

  it('returns configured secret when available', async () => {
    const value = await service.getSecret('APP_SECRET');

    expect(value).toBe('x'.repeat(40));
  });

  it('rotates secret and returns rotated value for subsequent reads', async () => {
    const original = await service.getSecret('APP_SECRET');

    await service.rotateSecret('APP_SECRET');
    const rotated = await service.getSecret('APP_SECRET');

    expect(rotated).not.toBe(original);
    expect(rotated.length).toBeGreaterThanOrEqual(32);
  });

  it('throws when rotating an empty key', async () => {
    await expect(service.rotateSecret('   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws for short secret values', async () => {
    await expect(service.validateSecret('short-value')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
