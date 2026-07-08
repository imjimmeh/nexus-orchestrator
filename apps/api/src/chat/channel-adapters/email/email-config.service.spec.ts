import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailConfigService } from './email-config.service';
import type { SecretCrudService } from '../../../security/services/secret-crud.service';

const DEFAULT_ENV: Record<string, unknown> = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_FROM: 'noreply@example.com',
  SMTP_USER: 'smtp-user',
};

function createConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values = { ...DEFAULT_ENV, ...overrides };
  return {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function createSecretCrud(
  overrides: Partial<Record<'findByIdRaw', ReturnType<typeof vi.fn>>> = {},
): SecretCrudService {
  return {
    findByIdRaw: vi.fn(),
    ...overrides,
  } as unknown as SecretCrudService;
}

describe('EmailConfigService', () => {
  let loggerSpies: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    loggerSpies = [
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined),
    ];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function expectNoSecretLeak(forbidden: string[]): void {
    for (const spy of loggerSpies) {
      for (const call of spy.mock.calls) {
        const serialized = JSON.stringify(call);
        for (const value of forbidden) {
          expect(serialized).not.toContain(value);
        }
      }
    }
  }

  describe('resolveSmtpSettings', () => {
    it('returns null when SMTP_HOST is unset', async () => {
      const config = createConfig({ SMTP_HOST: undefined });
      const secretCrud = createSecretCrud();
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result).toBeNull();
    });

    it('returns null when SMTP_FROM is unset', async () => {
      const config = createConfig({ SMTP_FROM: undefined });
      const secretCrud = createSecretCrud();
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result).toBeNull();
    });

    it('resolves auth.pass from the secret store when SMTP_PASSWORD_SECRET_ID is set', async () => {
      const config = createConfig({
        SMTP_PASSWORD_SECRET_ID: 'secret-123',
        SMTP_PASSWORD: 'should-not-be-used',
      });
      const secretCrud = createSecretCrud({
        findByIdRaw: vi.fn().mockResolvedValue({
          id: 'secret-123',
          decryptedValue: 'super-secret-decrypted-password',
        }),
      });
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(secretCrud.findByIdRaw).toHaveBeenCalledWith('secret-123');
      expect(result?.auth?.pass).toBe('super-secret-decrypted-password');
      expect(result?.auth?.user).toBe('smtp-user');

      expectNoSecretLeak([
        'super-secret-decrypted-password',
        'should-not-be-used',
      ]);
    });

    it('extracts the password from a JSON-wrapped secret value ({ password })', async () => {
      const config = createConfig({ SMTP_PASSWORD_SECRET_ID: 'secret-456' });
      const secretCrud = createSecretCrud({
        findByIdRaw: vi.fn().mockResolvedValue({
          id: 'secret-456',
          decryptedValue: JSON.stringify({ password: 'wrapped-password' }),
        }),
      });
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result?.auth?.pass).toBe('wrapped-password');
    });

    it('extracts the password from a JSON-wrapped secret value ({ value })', async () => {
      const config = createConfig({ SMTP_PASSWORD_SECRET_ID: 'secret-789' });
      const secretCrud = createSecretCrud({
        findByIdRaw: vi.fn().mockResolvedValue({
          id: 'secret-789',
          decryptedValue: JSON.stringify({ value: 'value-wrapped-password' }),
        }),
      });
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result?.auth?.pass).toBe('value-wrapped-password');
    });

    it('falls back to the SMTP_PASSWORD env var when no secret id is configured', async () => {
      const config = createConfig({
        SMTP_PASSWORD_SECRET_ID: undefined,
        SMTP_PASSWORD: 'env-password',
      });
      const secretCrud = createSecretCrud();
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(secretCrud.findByIdRaw).not.toHaveBeenCalled();
      expect(result?.auth?.pass).toBe('env-password');
    });

    it('falls back to the SMTP_PASSWORD env var when the secret is not found', async () => {
      const config = createConfig({
        SMTP_PASSWORD_SECRET_ID: 'missing-secret',
        SMTP_PASSWORD: 'env-password-fallback',
      });
      const secretCrud = createSecretCrud({
        findByIdRaw: vi.fn().mockResolvedValue(null),
      });
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result?.auth?.pass).toBe('env-password-fallback');
    });

    it('falls back to the env password when findByIdRaw rejects (decrypt failure), without throwing or logging the error', async () => {
      const config = createConfig({
        SMTP_PASSWORD_SECRET_ID: 'undecryptable-secret',
        SMTP_PASSWORD: 'env-password-after-reject',
      });
      const secretCrud = createSecretCrud({
        findByIdRaw: vi
          .fn()
          .mockRejectedValue(new Error('decrypt failed: super-secret-leak')),
      });
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result?.auth?.pass).toBe('env-password-after-reject');
      expectNoSecretLeak([
        'decrypt failed: super-secret-leak',
        'env-password-after-reject',
      ]);
    });

    it('returns unauthenticated settings when findByIdRaw rejects and no env password is set', async () => {
      const config = createConfig({
        SMTP_PASSWORD_SECRET_ID: 'undecryptable-secret',
        SMTP_PASSWORD: undefined,
      });
      const secretCrud = createSecretCrud({
        findByIdRaw: vi
          .fn()
          .mockRejectedValue(new Error('decrypt failed: another-leak')),
      });
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result).not.toBeNull();
      expect(result?.auth).toBeUndefined();
      expectNoSecretLeak(['decrypt failed: another-leak']);
    });

    it('extracts the password from a JSON-wrapped secret value ({ smtp_password })', async () => {
      const config = createConfig({ SMTP_PASSWORD_SECRET_ID: 'secret-smtp' });
      const secretCrud = createSecretCrud({
        findByIdRaw: vi.fn().mockResolvedValue({
          id: 'secret-smtp',
          decryptedValue: JSON.stringify({
            smtp_password: 'smtp-key-password',
          }),
        }),
      });
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result?.auth?.pass).toBe('smtp-key-password');
    });

    it('extracts a lone string value from a JSON object without a known key', async () => {
      const config = createConfig({ SMTP_PASSWORD_SECRET_ID: 'secret-lone' });
      const secretCrud = createSecretCrud({
        findByIdRaw: vi.fn().mockResolvedValue({
          id: 'secret-lone',
          decryptedValue: JSON.stringify({ unexpectedKey: 'lone-password' }),
        }),
      });
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result?.auth?.pass).toBe('lone-password');
    });

    it('does not set auth when SMTP_USER is present but no password resolves', async () => {
      const config = createConfig({
        SMTP_PASSWORD_SECRET_ID: undefined,
        SMTP_PASSWORD: undefined,
      });
      const secretCrud = createSecretCrud();
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result?.auth).toBeUndefined();
      expect(loggerSpies[0]).toHaveBeenCalled(); // warn
    });

    it('does not set auth when neither SMTP_USER nor a password are configured', async () => {
      const config = createConfig({
        SMTP_USER: undefined,
        SMTP_PASSWORD_SECRET_ID: undefined,
        SMTP_PASSWORD: undefined,
      });
      const secretCrud = createSecretCrud();
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result?.auth).toBeUndefined();
      expect(result?.host).toBe('smtp.example.com');
    });

    it('defaults port and secure when absent from config', async () => {
      const config = createConfig({
        SMTP_PORT: undefined,
        SMTP_SECURE: undefined,
      });
      const secretCrud = createSecretCrud();
      const service = new EmailConfigService(config, secretCrud);

      const result = await service.resolveSmtpSettings();

      expect(result?.port).toBe(587);
      expect(result?.secure).toBe(false);
    });
  });

  describe('isConfigured', () => {
    it('returns true when host and from are present', async () => {
      const service = new EmailConfigService(
        createConfig(),
        createSecretCrud(),
      );

      await expect(service.isConfigured()).resolves.toBe(true);
    });

    it('returns false when host is absent', async () => {
      const config = createConfig({ SMTP_HOST: undefined });
      const service = new EmailConfigService(config, createSecretCrud());

      await expect(service.isConfigured()).resolves.toBe(false);
    });

    it('returns false when from is absent', async () => {
      const config = createConfig({ SMTP_FROM: '   ' });
      const service = new EmailConfigService(config, createSecretCrud());

      await expect(service.isConfigured()).resolves.toBe(false);
    });
  });

  describe('buildAcceptInviteLink', () => {
    it('builds an encoded link from PUBLIC_APP_URL', () => {
      const config = createConfig({ PUBLIC_APP_URL: 'http://localhost:3120' });
      const service = new EmailConfigService(config, createSecretCrud());

      const link = service.buildAcceptInviteLink('tok en/+');

      expect(link).toBe(
        'http://localhost:3120/accept-invite?token=tok%20en%2F%2B',
      );
    });

    it('does not double the slash when PUBLIC_APP_URL ends with /', () => {
      const config = createConfig({ PUBLIC_APP_URL: 'http://localhost:3120/' });
      const service = new EmailConfigService(config, createSecretCrud());

      const link = service.buildAcceptInviteLink('tok en/+');

      expect(link).toBe(
        'http://localhost:3120/accept-invite?token=tok%20en%2F%2B',
      );
    });

    it('falls back to a default origin when PUBLIC_APP_URL is unset', () => {
      const config = createConfig({ PUBLIC_APP_URL: undefined });
      const service = new EmailConfigService(config, createSecretCrud());

      const link = service.buildAcceptInviteLink('abc');

      expect(link).toBe('http://localhost:3120/accept-invite?token=abc');
    });
  });
});
