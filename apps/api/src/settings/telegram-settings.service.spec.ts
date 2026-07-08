import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretVaultService } from '../security/secret-vault.service';
import type { SecretStoreRepository } from '../security/database/repositories/secret-store.repository';
import type { SystemSettingsService } from './system-settings.service';
import {
  TELEGRAM_SECRET_NAMES,
  TELEGRAM_SETTING_KEYS,
} from './telegram-settings.constants';
import { TelegramSettingsService } from './telegram-settings.service';
import { readPositiveInteger } from './telegram-settings.utils';

describe('TelegramSettingsService', () => {
  let service: TelegramSettingsService;

  const previousBotToken = process.env.CHAT_TELEGRAM_BOT_TOKEN;
  const previousWebhookSecret = process.env.CHAT_TELEGRAM_WEBHOOK_SECRET;
  const previousIngressMode = process.env.CHAT_TELEGRAM_INGRESS_MODE;
  const previousAllowedUserIds = process.env.CHAT_TELEGRAM_ALLOWED_USER_IDS;

  const getMock = vi.fn();
  const setMock = vi.fn();
  const findByNameMock = vi.fn();
  const updateMock = vi.fn();
  const createMock = vi.fn();
  const removeMock = vi.fn();
  const encryptMock = vi.fn();
  const decryptMock = vi.fn();

  const settings = {
    get: getMock,
    set: setMock,
  } as unknown as SystemSettingsService;

  const secretStore = {
    findByName: findByNameMock,
    update: updateMock,
    create: createMock,
    remove: removeMock,
  } as unknown as SecretStoreRepository;

  const secretVault = {
    encrypt: encryptMock,
    decrypt: decryptMock,
  } as unknown as SecretVaultService;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.CHAT_TELEGRAM_BOT_TOKEN;
    delete process.env.CHAT_TELEGRAM_WEBHOOK_SECRET;
    delete process.env.CHAT_TELEGRAM_INGRESS_MODE;
    delete process.env.CHAT_TELEGRAM_ALLOWED_USER_IDS;

    getMock.mockImplementation((_key: string, fallback: unknown) => fallback);
    setMock.mockResolvedValue(undefined);
    findByNameMock.mockResolvedValue(null);
    updateMock.mockResolvedValue(undefined);
    createMock.mockResolvedValue(undefined);
    removeMock.mockResolvedValue(undefined);
    encryptMock.mockImplementation((value: string) => `encrypted:${value}`);
    decryptMock.mockImplementation((value: string) => value);

    service = new TelegramSettingsService(settings, secretStore, secretVault);
  });

  afterEach(() => {
    if (previousBotToken === undefined) {
      delete process.env.CHAT_TELEGRAM_BOT_TOKEN;
    } else {
      process.env.CHAT_TELEGRAM_BOT_TOKEN = previousBotToken;
    }
    if (previousWebhookSecret === undefined) {
      delete process.env.CHAT_TELEGRAM_WEBHOOK_SECRET;
    } else {
      process.env.CHAT_TELEGRAM_WEBHOOK_SECRET = previousWebhookSecret;
    }
    if (previousIngressMode === undefined) {
      delete process.env.CHAT_TELEGRAM_INGRESS_MODE;
    } else {
      process.env.CHAT_TELEGRAM_INGRESS_MODE = previousIngressMode;
    }
    if (previousAllowedUserIds === undefined) {
      delete process.env.CHAT_TELEGRAM_ALLOWED_USER_IDS;
    } else {
      process.env.CHAT_TELEGRAM_ALLOWED_USER_IDS = previousAllowedUserIds;
    }
  });

  it('returns masked settings with secret presence indicators', async () => {
    getMock.mockImplementation((key: string, fallback: unknown) => {
      if (key === TELEGRAM_SETTING_KEYS.ingressMode) {
        return 'polling';
      }
      if (key === TELEGRAM_SETTING_KEYS.outboundRelayEnabled) {
        return false;
      }
      if (key === TELEGRAM_SETTING_KEYS.allowedUserIds) {
        return [' 1001 ', 'invalid', '1001', 1002, null];
      }
      return fallback;
    });

    findByNameMock.mockImplementation((name: string) => {
      if (name === TELEGRAM_SECRET_NAMES.botToken) {
        return {
          id: 'secret-1',
          name,
          encrypted_value: '"stored-bot"',
          metadata: {},
        };
      }
      return null;
    });
    decryptMock.mockReturnValue('"stored-bot"');
    process.env.CHAT_TELEGRAM_WEBHOOK_SECRET = 'env-secret';

    const result = await service.getSettingsView();

    expect(result.ingressMode).toBe('polling');
    expect(result.outboundRelayEnabled).toBe(false);
    expect(result.allowedUserIds).toEqual(['1001', '1002']);
    expect(result.commandsEnabled).toBe(true);
    expect(result.uxStatusMode).toBe('single_message');
    expect(result.hasBotToken).toBe(true);
    expect(result.hasWebhookSecret).toBe(true);
  });

  it('returns runtime settings with decrypted secret values', async () => {
    findByNameMock.mockImplementation((name: string) => {
      if (name === TELEGRAM_SECRET_NAMES.webhookSecret) {
        return {
          id: 'secret-2',
          name,
          encrypted_value: '"stored-webhook"',
          metadata: {},
        };
      }
      return null;
    });
    decryptMock.mockReturnValue('"stored-webhook"');
    process.env.CHAT_TELEGRAM_BOT_TOKEN = 'env-bot';
    process.env.CHAT_TELEGRAM_ALLOWED_USER_IDS = '42,invalid,42, 43';

    const result = await service.getRuntimeSettings();

    expect(result.allowedUserIds).toEqual(['42', '43']);
    expect(result.botToken).toBe('env-bot');
    expect(result.webhookSecret).toBe('stored-webhook');
  });

  it('falls back to env when secret decrypt fails', async () => {
    findByNameMock.mockImplementation((name: string) => {
      if (name === TELEGRAM_SECRET_NAMES.botToken) {
        return {
          id: 'secret-corrupt',
          name,
          encrypted_value: 'not-decryptable',
          metadata: {},
        };
      }
      return null;
    });
    decryptMock.mockImplementation(() => {
      throw new Error('Unsupported state or unable to authenticate data');
    });
    process.env.CHAT_TELEGRAM_BOT_TOKEN = 'env-token';
    delete process.env.CHAT_TELEGRAM_WEBHOOK_SECRET;

    const result = await service.getRuntimeSettings();

    expect(result.botToken).toBe('env-token');
  });

  it('persists non-secret and secret updates', async () => {
    findByNameMock.mockImplementation((name: string) => {
      if (name === TELEGRAM_SECRET_NAMES.botToken) {
        return {
          id: 'secret-bot',
          name,
          encrypted_value: '"old-bot"',
          metadata: { previous: true },
        };
      }
      if (name === TELEGRAM_SECRET_NAMES.webhookSecret) {
        return {
          id: 'secret-webhook',
          name,
          encrypted_value: '"old-webhook"',
          metadata: {},
        };
      }
      return null;
    });
    decryptMock.mockReturnValue('"new-bot"');

    await service.updateSettings({
      ingressMode: 'hybrid',
      allowedUserIds: ['1001', ' 1001 ', 'bad-user', '1002'],
      outboundRelayBatchSize: 10,
      botToken: 'new-bot',
      clearWebhookSecret: true,
    });

    expect(setMock).toHaveBeenCalledWith(
      TELEGRAM_SETTING_KEYS.ingressMode,
      'hybrid',
      expect.any(String),
    );
    expect(setMock).toHaveBeenCalledWith(
      TELEGRAM_SETTING_KEYS.outboundRelayBatchSize,
      10,
      expect.any(String),
    );
    expect(setMock).toHaveBeenCalledWith(
      TELEGRAM_SETTING_KEYS.allowedUserIds,
      ['1001', '1002'],
      expect.any(String),
    );
    expect(updateMock).toHaveBeenCalledWith(
      'secret-bot',
      expect.objectContaining({
        encrypted_value: 'encrypted:"new-bot"',
      }),
    );
    expect(removeMock).toHaveBeenCalledWith('secret-webhook');
  });

  it('rejects conflicting clear and update secret payload', async () => {
    await expect(
      service.updateSettings({
        botToken: 'next-token',
        clearBotToken: true,
      }),
    ).rejects.toThrow(/clearBotToken cannot be combined with botToken/i);
  });

  it('stores empty string when default project id is cleared', async () => {
    await service.updateSettings({
      defaultScopeId: null,
    });

    expect(setMock).toHaveBeenCalledWith(
      TELEGRAM_SETTING_KEYS.defaultScopeId,
      '',
      expect.any(String),
    );
  });

  it('persists command and UX settings updates', async () => {
    await service.updateSettings({
      commandsEnabled: false,
      enabledCommands: ['help', 'resume', 'help', 'Invalid'],
      commandResumeListLimit: 5,
      uxTypingEnabled: true,
      uxTypingHeartbeatMs: 2500,
      uxStatusUpdatesEnabled: true,
      uxStatusMode: 'multi_message',
      uxHideThinking: true,
      uxExposeToolNames: false,
      uxCommandMenuSyncEnabled: true,
      uxProgressEventsAllowlist: [
        'job_start',
        'tool_execution_start',
        'bad event',
      ],
      uxProgressUpdateThrottleMs: 1200,
      uxMaxProgressUpdatesPerRun: 30,
    });

    expect(setMock).toHaveBeenCalledWith(
      TELEGRAM_SETTING_KEYS.commandsEnabled,
      false,
      expect.any(String),
    );
    expect(setMock).toHaveBeenCalledWith(
      TELEGRAM_SETTING_KEYS.enabledCommands,
      ['help', 'resume'],
      expect.any(String),
    );
    expect(setMock).toHaveBeenCalledWith(
      TELEGRAM_SETTING_KEYS.commandResumeListLimit,
      5,
      expect.any(String),
    );
    expect(setMock).toHaveBeenCalledWith(
      TELEGRAM_SETTING_KEYS.uxStatusMode,
      'multi_message',
      expect.any(String),
    );
    expect(setMock).toHaveBeenCalledWith(
      TELEGRAM_SETTING_KEYS.uxProgressEventsAllowlist,
      ['job_start', 'tool_execution_start'],
      expect.any(String),
    );
    expect(setMock).toHaveBeenCalledWith(
      TELEGRAM_SETTING_KEYS.uxMaxProgressUpdatesPerRun,
      30,
      expect.any(String),
    );
  });

  describe('readPositiveInteger', () => {
    it('rejects partially numeric strings', () => {
      expect(readPositiveInteger('12abc')).toBeNull();
      expect(readPositiveInteger('1.5')).toBeNull();
      expect(readPositiveInteger('10ms')).toBeNull();
    });

    it('accepts valid positive integers', () => {
      expect(readPositiveInteger('5')).toBe(5);
      expect(readPositiveInteger('1')).toBe(1);
      expect(readPositiveInteger('999999')).toBe(999999);
    });

    it('rejects zero, negative, and non-numeric values', () => {
      expect(readPositiveInteger('0')).toBeNull();
      expect(readPositiveInteger('-5')).toBeNull();
      expect(readPositiveInteger('')).toBeNull();
      expect(readPositiveInteger(null)).toBeNull();
      expect(readPositiveInteger(undefined)).toBeNull();
    });

    it('accepts valid number inputs', () => {
      expect(readPositiveInteger(5)).toBe(5);
      expect(readPositiveInteger(1)).toBe(1);
    });

    it('rejects non-integer numbers', () => {
      expect(readPositiveInteger(1.5)).toBeNull();
      expect(readPositiveInteger(0)).toBeNull();
      expect(readPositiveInteger(-1)).toBeNull();
    });
  });
});
