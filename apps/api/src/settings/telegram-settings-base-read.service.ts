import type { TelegramIngressModeV1, TelegramSettingsV1 } from '@nexus/core';
import {
  TELEGRAM_SETTING_KEYS,
  TELEGRAM_SETTINGS_DEFAULTS,
} from './telegram-settings.constants';
import {
  normalizeTelegramAllowedUserIds,
  readAllowedUserIdsEnv,
  readBooleanEnv,
  readIngressModeEnv,
  readIngressModeValue,
  readOptionalEnv,
  readOptionalTrimmedString,
  readPositiveIntegerEnv,
} from './telegram-settings.utils';
import {
  readBooleanSetting,
  readEnabledCommandsSetting,
  readPositiveIntegerSetting,
  readProgressEventsAllowlistSetting,
  readStatusModeSetting,
} from './telegram-settings-read-helpers';
import { SystemSettingsService } from './system-settings.service';
type CoreSettingsFields = Pick<
  TelegramSettingsV1,
  | 'ingressMode'
  | 'defaultAgentProfile'
  | 'defaultScopeId'
  | 'allowedUserIds'
  | 'pollTimeoutSeconds'
  | 'pollRetryDelayMs'
  | 'pollBackoffMaxMs'
  | 'outboundRelayEnabled'
  | 'outboundRelayIntervalMs'
  | 'outboundRelayBatchSize'
>;
type CoreIdentitySettingsFields = Pick<
  TelegramSettingsV1,
  'ingressMode' | 'defaultAgentProfile' | 'defaultScopeId' | 'allowedUserIds'
>;
type CorePollingAndRelaySettingsFields = Pick<
  TelegramSettingsV1,
  | 'pollTimeoutSeconds'
  | 'pollRetryDelayMs'
  | 'pollBackoffMaxMs'
  | 'outboundRelayEnabled'
  | 'outboundRelayIntervalMs'
  | 'outboundRelayBatchSize'
>;
type CommandSettingsFields = Pick<
  TelegramSettingsV1,
  'commandsEnabled' | 'enabledCommands' | 'commandResumeListLimit'
>;
type UxSettingsFields = Pick<
  TelegramSettingsV1,
  | 'uxTypingEnabled'
  | 'uxTypingHeartbeatMs'
  | 'uxStatusUpdatesEnabled'
  | 'uxStatusMode'
  | 'uxHideThinking'
  | 'uxExposeToolNames'
  | 'uxCommandMenuSyncEnabled'
  | 'uxProgressEventsAllowlist'
  | 'uxProgressUpdateThrottleMs'
  | 'uxMaxProgressUpdatesPerRun'
>;
type UxTypingAndStatusSettingsFields = Pick<
  TelegramSettingsV1,
  | 'uxTypingEnabled'
  | 'uxTypingHeartbeatMs'
  | 'uxStatusUpdatesEnabled'
  | 'uxStatusMode'
  | 'uxHideThinking'
  | 'uxExposeToolNames'
>;
type UxProgressAndMenuSettingsFields = Pick<
  TelegramSettingsV1,
  | 'uxCommandMenuSyncEnabled'
  | 'uxProgressEventsAllowlist'
  | 'uxProgressUpdateThrottleMs'
  | 'uxMaxProgressUpdatesPerRun'
>;
export class TelegramSettingsBaseReadService {
  constructor(private readonly settings: SystemSettingsService) {}

  async readBaseSettings(): Promise<TelegramSettingsV1> {
    const [coreFields, commandFields, uxFields] = await Promise.all([
      this.readCoreSettingsFields(),
      this.readCommandSettingsFields(),
      this.readUxSettingsFields(),
    ]);

    return {
      ...coreFields,
      ...commandFields,
      ...uxFields,
    };
  }

  private async readCoreSettingsFields(): Promise<CoreSettingsFields> {
    const [identityFields, pollingAndRelayFields] = await Promise.all([
      this.readCoreIdentityFields(),
      this.readCorePollingAndRelayFields(),
    ]);

    return {
      ...identityFields,
      ...pollingAndRelayFields,
    };
  }

  private async readCoreIdentityFields(): Promise<CoreIdentitySettingsFields> {
    const [ingressMode, defaultAgentProfile, defaultScopeId, allowedUserIds] =
      await Promise.all([
        this.readIngressMode(),
        this.readDefaultAgentProfile(),
        this.readDefaultScopeId(),
        this.readAllowedUserIds(),
      ]);

    return {
      ingressMode,
      defaultAgentProfile,
      defaultScopeId,
      allowedUserIds,
    };
  }

  private async readCorePollingAndRelayFields(): Promise<CorePollingAndRelaySettingsFields> {
    const [
      pollTimeoutSeconds,
      pollRetryDelayMs,
      pollBackoffMaxMs,
      outboundRelayEnabled,
      outboundRelayIntervalMs,
      outboundRelayBatchSize,
    ] = await Promise.all([
      readPositiveIntegerSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.pollTimeoutSeconds,
        readPositiveIntegerEnv(
          'CHAT_TELEGRAM_POLL_TIMEOUT_SECONDS',
          TELEGRAM_SETTINGS_DEFAULTS.pollTimeoutSeconds,
        ),
      ),
      readPositiveIntegerSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.pollRetryDelayMs,
        readPositiveIntegerEnv(
          'CHAT_TELEGRAM_POLL_RETRY_DELAY_MS',
          TELEGRAM_SETTINGS_DEFAULTS.pollRetryDelayMs,
        ),
      ),
      readPositiveIntegerSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.pollBackoffMaxMs,
        readPositiveIntegerEnv(
          'CHAT_TELEGRAM_POLL_BACKOFF_MAX_MS',
          TELEGRAM_SETTINGS_DEFAULTS.pollBackoffMaxMs,
        ),
      ),
      readBooleanSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.outboundRelayEnabled,
        readBooleanEnv(
          'CHAT_TELEGRAM_OUTBOUND_RELAY_ENABLED',
          TELEGRAM_SETTINGS_DEFAULTS.outboundRelayEnabled,
        ),
      ),
      readPositiveIntegerSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.outboundRelayIntervalMs,
        readPositiveIntegerEnv(
          'CHAT_TELEGRAM_OUTBOUND_RELAY_INTERVAL_MS',
          TELEGRAM_SETTINGS_DEFAULTS.outboundRelayIntervalMs,
        ),
      ),
      readPositiveIntegerSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.outboundRelayBatchSize,
        readPositiveIntegerEnv(
          'CHAT_TELEGRAM_OUTBOUND_RELAY_BATCH_SIZE',
          TELEGRAM_SETTINGS_DEFAULTS.outboundRelayBatchSize,
        ),
      ),
    ]);

    return {
      pollTimeoutSeconds,
      pollRetryDelayMs,
      pollBackoffMaxMs,
      outboundRelayEnabled,
      outboundRelayIntervalMs,
      outboundRelayBatchSize,
    };
  }

  private async readCommandSettingsFields(): Promise<CommandSettingsFields> {
    const [commandsEnabled, enabledCommands, commandResumeListLimit] =
      await Promise.all([
        readBooleanSetting(
          this.settings,
          TELEGRAM_SETTING_KEYS.commandsEnabled,
          readBooleanEnv(
            'CHAT_TELEGRAM_COMMANDS_ENABLED',
            TELEGRAM_SETTINGS_DEFAULTS.commandsEnabled,
          ),
        ),
        readEnabledCommandsSetting(this.settings),
        readPositiveIntegerSetting(
          this.settings,
          TELEGRAM_SETTING_KEYS.commandResumeListLimit,
          readPositiveIntegerEnv(
            'CHAT_TELEGRAM_COMMAND_RESUME_LIST_LIMIT',
            TELEGRAM_SETTINGS_DEFAULTS.commandResumeListLimit,
          ),
        ),
      ]);

    return {
      commandsEnabled,
      enabledCommands,
      commandResumeListLimit,
    };
  }

  private async readUxSettingsFields(): Promise<UxSettingsFields> {
    const [typingAndStatusFields, progressAndMenuFields] = await Promise.all([
      this.readUxTypingAndStatusFields(),
      this.readUxProgressAndMenuFields(),
    ]);

    return {
      ...typingAndStatusFields,
      ...progressAndMenuFields,
    };
  }

  private async readUxTypingAndStatusFields(): Promise<UxTypingAndStatusSettingsFields> {
    const [
      uxTypingEnabled,
      uxTypingHeartbeatMs,
      uxStatusUpdatesEnabled,
      uxStatusMode,
      uxHideThinking,
      uxExposeToolNames,
    ] = await Promise.all([
      readBooleanSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.uxTypingEnabled,
        readBooleanEnv(
          'CHAT_TELEGRAM_UX_TYPING_ENABLED',
          TELEGRAM_SETTINGS_DEFAULTS.uxTypingEnabled,
        ),
      ),
      readPositiveIntegerSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.uxTypingHeartbeatMs,
        readPositiveIntegerEnv(
          'CHAT_TELEGRAM_UX_TYPING_HEARTBEAT_MS',
          TELEGRAM_SETTINGS_DEFAULTS.uxTypingHeartbeatMs,
        ),
      ),
      readBooleanSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.uxStatusUpdatesEnabled,
        readBooleanEnv(
          'CHAT_TELEGRAM_UX_STATUS_UPDATES_ENABLED',
          TELEGRAM_SETTINGS_DEFAULTS.uxStatusUpdatesEnabled,
        ),
      ),
      readStatusModeSetting(this.settings),
      readBooleanSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.uxHideThinking,
        readBooleanEnv(
          'CHAT_TELEGRAM_UX_HIDE_THINKING',
          TELEGRAM_SETTINGS_DEFAULTS.uxHideThinking,
        ),
      ),
      readBooleanSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.uxExposeToolNames,
        readBooleanEnv(
          'CHAT_TELEGRAM_UX_EXPOSE_TOOL_NAMES',
          TELEGRAM_SETTINGS_DEFAULTS.uxExposeToolNames,
        ),
      ),
    ]);

    return {
      uxTypingEnabled,
      uxTypingHeartbeatMs,
      uxStatusUpdatesEnabled,
      uxStatusMode,
      uxHideThinking,
      uxExposeToolNames,
    };
  }

  private async readUxProgressAndMenuFields(): Promise<UxProgressAndMenuSettingsFields> {
    const [
      uxCommandMenuSyncEnabled,
      uxProgressEventsAllowlist,
      uxProgressUpdateThrottleMs,
      uxMaxProgressUpdatesPerRun,
    ] = await Promise.all([
      readBooleanSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.uxCommandMenuSyncEnabled,
        readBooleanEnv(
          'CHAT_TELEGRAM_UX_COMMAND_MENU_SYNC_ENABLED',
          TELEGRAM_SETTINGS_DEFAULTS.uxCommandMenuSyncEnabled,
        ),
      ),
      readProgressEventsAllowlistSetting(this.settings),
      readPositiveIntegerSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.uxProgressUpdateThrottleMs,
        readPositiveIntegerEnv(
          'CHAT_TELEGRAM_UX_PROGRESS_UPDATE_THROTTLE_MS',
          TELEGRAM_SETTINGS_DEFAULTS.uxProgressUpdateThrottleMs,
        ),
      ),
      readPositiveIntegerSetting(
        this.settings,
        TELEGRAM_SETTING_KEYS.uxMaxProgressUpdatesPerRun,
        readPositiveIntegerEnv(
          'CHAT_TELEGRAM_UX_MAX_PROGRESS_UPDATES_PER_RUN',
          TELEGRAM_SETTINGS_DEFAULTS.uxMaxProgressUpdatesPerRun,
        ),
      ),
    ]);

    return {
      uxCommandMenuSyncEnabled,
      uxProgressEventsAllowlist,
      uxProgressUpdateThrottleMs,
      uxMaxProgressUpdatesPerRun,
    };
  }

  private async readIngressMode(): Promise<TelegramIngressModeV1> {
    const fallback =
      readIngressModeEnv(
        'CHAT_TELEGRAM_INGRESS_MODE',
        TELEGRAM_SETTINGS_DEFAULTS.ingressMode,
      ) ?? TELEGRAM_SETTINGS_DEFAULTS.ingressMode;

    const value = await this.settings.get<unknown>(
      TELEGRAM_SETTING_KEYS.ingressMode,
      fallback,
    );
    return readIngressModeValue(value) ?? fallback;
  }

  private async readDefaultAgentProfile(): Promise<string> {
    const fallback =
      readOptionalTrimmedString(
        readOptionalEnv('CHAT_TELEGRAM_DEFAULT_AGENT_PROFILE'),
      ) ?? TELEGRAM_SETTINGS_DEFAULTS.defaultAgentProfile;

    const value = await this.settings.get<unknown>(
      TELEGRAM_SETTING_KEYS.defaultAgentProfile,
      fallback,
    );
    return readOptionalTrimmedString(value) ?? fallback;
  }

  private async readDefaultScopeId(): Promise<string | null> {
    const fallback = readOptionalTrimmedString(
      readOptionalEnv('CHAT_TELEGRAM_DEFAULT_SCOPE_ID'),
    );

    const value = await this.settings.get<unknown>(
      TELEGRAM_SETTING_KEYS.defaultScopeId,
      fallback,
    );
    return readOptionalTrimmedString(value);
  }

  private async readAllowedUserIds(): Promise<string[]> {
    const fallback = readAllowedUserIdsEnv('CHAT_TELEGRAM_ALLOWED_USER_IDS');
    const value = await this.settings.get<unknown>(
      TELEGRAM_SETTING_KEYS.allowedUserIds,
      fallback,
    );
    return normalizeTelegramAllowedUserIds(value);
  }
}
