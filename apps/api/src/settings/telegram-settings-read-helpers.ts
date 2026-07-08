import type { TelegramStatusMessageModeV1 } from '@nexus/core';
import {
  TELEGRAM_SETTING_KEYS,
  TELEGRAM_SETTINGS_DEFAULTS,
} from './telegram-settings.constants';
import type { SystemSettingsService } from './system-settings.service';
import {
  normalizeTelegramCommandNames,
  normalizeTelegramProgressEventAllowlist,
  readBoolean,
  readPositiveInteger,
  readTelegramCommandNamesEnv,
  readTelegramProgressEventAllowlistEnv,
  readTelegramStatusModeEnv,
  readTelegramStatusModeValue,
} from './telegram-settings.utils';

export async function readEnabledCommandsSetting(
  settings: SystemSettingsService,
): Promise<string[]> {
  const envCommands = readTelegramCommandNamesEnv(
    'CHAT_TELEGRAM_ENABLED_COMMANDS',
  );
  const fallback =
    envCommands.length > 0
      ? envCommands
      : TELEGRAM_SETTINGS_DEFAULTS.enabledCommands;

  const value = await settings.get<unknown>(
    TELEGRAM_SETTING_KEYS.enabledCommands,
    fallback,
  );
  const normalized = normalizeTelegramCommandNames(value);
  return normalized.length > 0 ? normalized : fallback;
}

export async function readProgressEventsAllowlistSetting(
  settings: SystemSettingsService,
): Promise<string[]> {
  const envAllowlist = readTelegramProgressEventAllowlistEnv(
    'CHAT_TELEGRAM_UX_PROGRESS_EVENTS_ALLOWLIST',
  );
  const fallback =
    envAllowlist.length > 0
      ? envAllowlist
      : TELEGRAM_SETTINGS_DEFAULTS.uxProgressEventsAllowlist;

  const value = await settings.get<unknown>(
    TELEGRAM_SETTING_KEYS.uxProgressEventsAllowlist,
    fallback,
  );
  const normalized = normalizeTelegramProgressEventAllowlist(value);
  return normalized.length > 0 ? normalized : fallback;
}

export async function readStatusModeSetting(
  settings: SystemSettingsService,
): Promise<TelegramStatusMessageModeV1> {
  const fallback = readTelegramStatusModeEnv(
    'CHAT_TELEGRAM_UX_STATUS_MODE',
    TELEGRAM_SETTINGS_DEFAULTS.uxStatusMode,
  );

  const value = await settings.get<unknown>(
    TELEGRAM_SETTING_KEYS.uxStatusMode,
    fallback,
  );
  return readTelegramStatusModeValue(value) ?? fallback;
}

export async function readPositiveIntegerSetting(
  settings: SystemSettingsService,
  key: string,
  fallback: number,
): Promise<number> {
  const value = await settings.get<unknown>(key, fallback);
  return readPositiveInteger(value) ?? fallback;
}

export async function readBooleanSetting(
  settings: SystemSettingsService,
  key: string,
  fallback: boolean,
): Promise<boolean> {
  const value = await settings.get<unknown>(key, fallback);
  return readBoolean(value) ?? fallback;
}
