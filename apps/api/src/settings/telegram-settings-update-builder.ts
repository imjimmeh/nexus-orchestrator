import type { UpdateTelegramSettingsRequestV1 } from '@nexus/core';
import {
  TELEGRAM_SETTING_KEYS,
  TELEGRAM_SETTINGS_DEFAULTS,
  TELEGRAM_UNSET_DEFAULT_SCOPE_ID_VALUE,
} from './telegram-settings.constants';
import {
  normalizeTelegramAllowedUserIds,
  normalizeTelegramCommandNames,
  normalizeTelegramProgressEventAllowlist,
  readOptionalTrimmedString,
  readTelegramStatusModeValue,
  requireTelegramTrimmedString,
} from './telegram-settings.utils';

type SettingUpdate = {
  key: string;
  value: unknown;
};

const DIRECT_SETTING_VALUE_READERS: Array<{
  key: string;
  readValue: (payload: UpdateTelegramSettingsRequestV1) => unknown;
}> = [
  {
    key: TELEGRAM_SETTING_KEYS.ingressMode,
    readValue: (payload) => payload.ingressMode,
  },
  {
    key: TELEGRAM_SETTING_KEYS.pollTimeoutSeconds,
    readValue: (payload) => payload.pollTimeoutSeconds,
  },
  {
    key: TELEGRAM_SETTING_KEYS.pollRetryDelayMs,
    readValue: (payload) => payload.pollRetryDelayMs,
  },
  {
    key: TELEGRAM_SETTING_KEYS.pollBackoffMaxMs,
    readValue: (payload) => payload.pollBackoffMaxMs,
  },
  {
    key: TELEGRAM_SETTING_KEYS.outboundRelayEnabled,
    readValue: (payload) => payload.outboundRelayEnabled,
  },
  {
    key: TELEGRAM_SETTING_KEYS.outboundRelayIntervalMs,
    readValue: (payload) => payload.outboundRelayIntervalMs,
  },
  {
    key: TELEGRAM_SETTING_KEYS.outboundRelayBatchSize,
    readValue: (payload) => payload.outboundRelayBatchSize,
  },
  {
    key: TELEGRAM_SETTING_KEYS.commandsEnabled,
    readValue: (payload) => payload.commandsEnabled,
  },
  {
    key: TELEGRAM_SETTING_KEYS.commandResumeListLimit,
    readValue: (payload) => payload.commandResumeListLimit,
  },
  {
    key: TELEGRAM_SETTING_KEYS.uxTypingEnabled,
    readValue: (payload) => payload.uxTypingEnabled,
  },
  {
    key: TELEGRAM_SETTING_KEYS.uxTypingHeartbeatMs,
    readValue: (payload) => payload.uxTypingHeartbeatMs,
  },
  {
    key: TELEGRAM_SETTING_KEYS.uxStatusUpdatesEnabled,
    readValue: (payload) => payload.uxStatusUpdatesEnabled,
  },
  {
    key: TELEGRAM_SETTING_KEYS.uxHideThinking,
    readValue: (payload) => payload.uxHideThinking,
  },
  {
    key: TELEGRAM_SETTING_KEYS.uxExposeToolNames,
    readValue: (payload) => payload.uxExposeToolNames,
  },
  {
    key: TELEGRAM_SETTING_KEYS.uxCommandMenuSyncEnabled,
    readValue: (payload) => payload.uxCommandMenuSyncEnabled,
  },
  {
    key: TELEGRAM_SETTING_KEYS.uxProgressUpdateThrottleMs,
    readValue: (payload) => payload.uxProgressUpdateThrottleMs,
  },
  {
    key: TELEGRAM_SETTING_KEYS.uxMaxProgressUpdatesPerRun,
    readValue: (payload) => payload.uxMaxProgressUpdatesPerRun,
  },
];

export function buildTelegramNonSecretSettingUpdates(
  payload: UpdateTelegramSettingsRequestV1,
): SettingUpdate[] {
  const updates = readDirectSettingUpdates(payload);
  updates.push(...readTransformedSettingUpdates(payload));

  return updates;
}

function readDirectSettingUpdates(
  payload: UpdateTelegramSettingsRequestV1,
): SettingUpdate[] {
  const updates: SettingUpdate[] = [];

  for (const reader of DIRECT_SETTING_VALUE_READERS) {
    const value = reader.readValue(payload);
    if (value !== undefined) {
      updates.push({ key: reader.key, value });
    }
  }

  return updates;
}

function readTransformedSettingUpdates(
  payload: UpdateTelegramSettingsRequestV1,
): SettingUpdate[] {
  const updates: SettingUpdate[] = [];

  if (payload.defaultAgentProfile !== undefined) {
    updates.push({
      key: TELEGRAM_SETTING_KEYS.defaultAgentProfile,
      value: requireTelegramTrimmedString(
        payload.defaultAgentProfile,
        'defaultAgentProfile',
      ),
    });
  }

  if ('defaultScopeId' in payload) {
    updates.push({
      key: TELEGRAM_SETTING_KEYS.defaultScopeId,
      value:
        readOptionalTrimmedString(payload.defaultScopeId) ??
        TELEGRAM_UNSET_DEFAULT_SCOPE_ID_VALUE,
    });
  }

  if (payload.allowedUserIds !== undefined) {
    updates.push({
      key: TELEGRAM_SETTING_KEYS.allowedUserIds,
      value: normalizeTelegramAllowedUserIds(payload.allowedUserIds),
    });
  }

  if (payload.enabledCommands !== undefined) {
    updates.push({
      key: TELEGRAM_SETTING_KEYS.enabledCommands,
      value: normalizeTelegramCommandNames(payload.enabledCommands),
    });
  }

  if (payload.uxProgressEventsAllowlist !== undefined) {
    updates.push({
      key: TELEGRAM_SETTING_KEYS.uxProgressEventsAllowlist,
      value: normalizeTelegramProgressEventAllowlist(
        payload.uxProgressEventsAllowlist,
      ),
    });
  }

  if (payload.uxStatusMode !== undefined) {
    updates.push({
      key: TELEGRAM_SETTING_KEYS.uxStatusMode,
      value:
        readTelegramStatusModeValue(payload.uxStatusMode) ??
        TELEGRAM_SETTINGS_DEFAULTS.uxStatusMode,
    });
  }

  return updates;
}
