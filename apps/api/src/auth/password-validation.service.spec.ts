import { vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PasswordValidationService } from './password-validation.service';

describe('PasswordValidationService', () => {
  let service: PasswordValidationService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordValidationService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PasswordValidationService>(PasswordValidationService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('getPasswordRequirements', () => {
    it('should return default requirements when config values are not set', () => {
      vi.spyOn(configService, 'get').mockImplementation(
        (key: string, defaultValue: any) => defaultValue,
      );

      const requirements = service.getPasswordRequirements();

      expect(requirements).toEqual({
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecial: true,
      });
    });

    it('should return config values when they are set', () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        const config: Record<string, any> = {
          PASSWORD_MIN_LENGTH: 12,
          PASSWORD_REQUIRE_UPPERCASE: false,
          PASSWORD_REQUIRE_LOWERCASE: false,
          PASSWORD_REQUIRE_NUMBERS: false,
          PASSWORD_REQUIRE_SPECIAL: false,
        };
        return config[key];
      });

      const requirements = service.getPasswordRequirements();

      expect(requirements).toEqual({
        minLength: 12,
        requireUppercase: false,
        requireLowercase: false,
        requireNumbers: false,
        requireSpecial: false,
      });
    });
  });

  describe('validatePassword', () => {
    beforeEach(() => {
      vi.spyOn(configService, 'get').mockImplementation(
        (key: string, defaultValue: any) => defaultValue,
      );
    });

    it('should validate a strong password', () => {
      const result = service.validatePassword('StrongPass1!');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject password shorter than min length', () => {
      const result = service.validatePassword('Short1!');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });

    it('should reject password without uppercase letter', () => {
      const result = service.validatePassword('lowercase1!');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one uppercase letter',
      );
    });

    it('should reject password without lowercase letter', () => {
      const result = service.validatePassword('UPPERCASE1!');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one lowercase letter',
      );
    });

    it('should reject password without numbers', () => {
      const result = service.validatePassword('NoNumbers!');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one number',
      );
    });

    it('should reject password without special characters', () => {
      const result = service.validatePassword('NoSpecial1');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Password must contain at least one special character',
      );
    });

    it('should return all validation errors for a weak password', () => {
      const result = service.validatePassword('weak');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
      expect(result.errors).toContain(
        'Password must contain at least one uppercase letter',
      );
      expect(result.errors).toContain(
        'Password must contain at least one number',
      );
      expect(result.errors).toContain(
        'Password must contain at least one special character',
      );
    });

    it('should pass validation when requirements are disabled', () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        const config: Record<string, any> = {
          PASSWORD_MIN_LENGTH: 4,
          PASSWORD_REQUIRE_UPPERCASE: false,
          PASSWORD_REQUIRE_LOWERCASE: true,
          PASSWORD_REQUIRE_NUMBERS: false,
          PASSWORD_REQUIRE_SPECIAL: false,
        };
        return config[key];
      });

      const result = service.validatePassword('lowercase');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
