import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  ChatTelegramIngressMode,
  ChatTelegramRuntimeSettings,
  ChatTelegramStatusMode,
} from '../../chat-actions/chat-telegram-settings.types';
import {
  normalizeTelegramAllowedUserIds,
  normalizeTelegramEnabledCommands,
  normalizeTelegramProgressEventAllowlist,
} from './telegram-runtime-settings.parsers';
import type { TelegramChannelRuntimeSettings } from './telegram-runtime-settings.types';
import { TelegramSettingsClient } from './telegram-settings.client';

const DEFAULT_SETTINGS_CACHE_TTL_MS = 5000;
const DEFAULT_ENABLED_COMMANDS = ['help', 'new', 'resume', 'agent'];
const DEFAULT_COMMAND_RESUME_LIST_LIMIT = 8;
const DEFAULT_UX_PROGRESS_EVENTS_ALLOWLIST = [
  'job_start',
  'agent_prompt_sent',
  'tool_execution_start',
  'tool_execution_end',
  'container_starting',
  'container_started',
  'container_ready',
  'capability_preflight_failed',
];

@Injectable()
export class TelegramRuntimeSettingsService {
  private readonly logger = new Logger(TelegramRuntimeSettingsService.name);
  private readonly cacheTtlMs = this.readPositiveInt(
    'CHAT_TELEGRAM_SETTINGS_CACHE_TTL_MS',
    DEFAULT_SETTINGS_CACHE_TTL_MS,
  );

  private cacheExpiresAt = 0;
  private cachedSettings: TelegramChannelRuntimeSettings | null = null;
  private inFlight: Promise<TelegramChannelRuntimeSettings> | null = null;

  constructor(private readonly telegramSettings: TelegramSettingsClient) {}

  async getSettings(
    forceRefresh = false,
  ): Promise<TelegramChannelRuntimeSettings> {
    const now = Date.now();
    if (!forceRefresh && this.cachedSettings && now < this.cacheExpiresAt) {
      return this.cachedSettings;
    }

    if (this.inFlight !== null) {
      return this.inFlight;
    }

    this.inFlight = this.refreshSettings();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async refreshSettings(): Promise<TelegramChannelRuntimeSettings> {
    const fallback = this.readFromEnv();

    try {
      const remote =
        await this.telegramSettings.getTelegramRuntimeSettings(randomUUID());
      const normalized = this.normalizeSettings(remote, fallback);
      this.setCache(normalized);
      return normalized;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Telegram runtime settings from core API: ${(error as Error).message}`,
      );
      this.setCache(fallback);
      return fallback;
    }
  }

  private setCache(settings: TelegramChannelRuntimeSettings): void {
    this.cachedSettings = settings;
    this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
  }

  private normalizeSettings(
    remote: ChatTelegramRuntimeSettings,
    fallback: TelegramChannelRuntimeSettings,
  ): TelegramChannelRuntimeSettings {
    return {
      ingressMode:
        this.readIngressMode(remote.ingressMode) ?? fallback.ingressMode,
      defaultAgentProfile:
        this.readNonEmptyString(remote.defaultAgentProfile) ??
        fallback.defaultAgentProfile,
      defaultScopeId: this.readNonEmptyString(remote.defaultScopeId),
      allowedUserIds: normalizeTelegramAllowedUserIds(remote.allowedUserIds),
      pollTimeoutSeconds:
        this.readPositiveNumber(remote.pollTimeoutSeconds) ??
        fallback.pollTimeoutSeconds,
      pollRetryDelayMs:
        this.readPositiveNumber(remote.pollRetryDelayMs) ??
        fallback.pollRetryDelayMs,
      pollBackoffMaxMs:
        this.readPositiveNumber(remote.pollBackoffMaxMs) ??
        fallback.pollBackoffMaxMs,
      outboundRelayEnabled:
        typeof remote.outboundRelayEnabled === 'boolean'
          ? remote.outboundRelayEnabled
          : fallback.outboundRelayEnabled,
      outboundRelayIntervalMs:
        this.readPositiveNumber(remote.outboundRelayIntervalMs) ??
        fallback.outboundRelayIntervalMs,
      outboundRelayBatchSize:
        this.readPositiveNumber(remote.outboundRelayBatchSize) ??
        fallback.outboundRelayBatchSize,
      botToken: this.readNonEmptyString(remote.botToken),
      webhookSecret: this.readNonEmptyString(remote.webhookSecret),
      ...this.readNormalizedCommandAndUxSettings(remote, fallback),
    };
  }

  private readFromEnv(): TelegramChannelRuntimeSettings {
    return {
      ingressMode:
        this.readIngressMode(
          this.readOptionalEnv('CHAT_TELEGRAM_INGRESS_MODE'),
        ) ?? 'webhook',
      defaultAgentProfile:
        this.readNonEmptyString(
          this.readOptionalEnv('CHAT_TELEGRAM_DEFAULT_AGENT_PROFILE'),
        ) ?? 'friendly-general-assistant',
      defaultScopeId: this.readNonEmptyString(
        this.readOptionalEnv('CHAT_TELEGRAM_DEFAULT_SCOPE_ID') ??
          this.readOptionalEnv(
            ['CHAT_TELEGRAM_DEFAULT', 'project', 'id'].join('_'),
          ),
      ),
      allowedUserIds: normalizeTelegramAllowedUserIds(
        this.readOptionalEnv('CHAT_TELEGRAM_ALLOWED_USER_IDS'),
      ),
      pollTimeoutSeconds: this.readPositiveInt(
        'CHAT_TELEGRAM_POLL_TIMEOUT_SECONDS',
        50,
      ),
      pollRetryDelayMs: this.readPositiveInt(
        'CHAT_TELEGRAM_POLL_RETRY_DELAY_MS',
        1000,
      ),
      pollBackoffMaxMs: this.readPositiveInt(
        'CHAT_TELEGRAM_POLL_BACKOFF_MAX_MS',
        30000,
      ),
      outboundRelayEnabled: this.readBoolean(
        this.readOptionalEnv('CHAT_TELEGRAM_OUTBOUND_RELAY_ENABLED'),
        true,
      ),
      outboundRelayIntervalMs: this.readPositiveInt(
        'CHAT_TELEGRAM_OUTBOUND_RELAY_INTERVAL_MS',
        3000,
      ),
      outboundRelayBatchSize: this.readPositiveInt(
        'CHAT_TELEGRAM_OUTBOUND_RELAY_BATCH_SIZE',
        20,
      ),
      botToken: this.readNonEmptyString(
        this.readOptionalEnv('CHAT_TELEGRAM_BOT_TOKEN'),
      ),
      webhookSecret: this.readNonEmptyString(
        this.readOptionalEnv('CHAT_TELEGRAM_WEBHOOK_SECRET'),
      ),
      ...this.readCommandAndUxFromEnv(),
    };
  }

  private readNormalizedCommandAndUxSettings(
    remote: ChatTelegramRuntimeSettings,
    fallback: TelegramChannelRuntimeSettings,
  ): Pick<
    TelegramChannelRuntimeSettings,
    | 'commandsEnabled'
    | 'enabledCommands'
    | 'commandResumeListLimit'
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
  > {
    return {
      commandsEnabled: this.readBoolean(
        remote.commandsEnabled,
        fallback.commandsEnabled,
      ),
      enabledCommands: normalizeTelegramEnabledCommands(
        remote.enabledCommands,
        fallback.enabledCommands,
      ),
      commandResumeListLimit:
        this.readPositiveNumber(remote.commandResumeListLimit) ??
        fallback.commandResumeListLimit,
      uxTypingEnabled: this.readBoolean(
        remote.uxTypingEnabled,
        fallback.uxTypingEnabled,
      ),
      uxTypingHeartbeatMs:
        this.readPositiveNumber(remote.uxTypingHeartbeatMs) ??
        fallback.uxTypingHeartbeatMs,
      uxStatusUpdatesEnabled: this.readBoolean(
        remote.uxStatusUpdatesEnabled,
        fallback.uxStatusUpdatesEnabled,
      ),
      uxStatusMode:
        this.readStatusMode(remote.uxStatusMode) ?? fallback.uxStatusMode,
      uxHideThinking: this.readBoolean(
        remote.uxHideThinking,
        fallback.uxHideThinking,
      ),
      uxExposeToolNames: this.readBoolean(
        remote.uxExposeToolNames,
        fallback.uxExposeToolNames,
      ),
      uxCommandMenuSyncEnabled: this.readBoolean(
        remote.uxCommandMenuSyncEnabled,
        fallback.uxCommandMenuSyncEnabled,
      ),
      uxProgressEventsAllowlist: normalizeTelegramProgressEventAllowlist(
        remote.uxProgressEventsAllowlist,
        fallback.uxProgressEventsAllowlist,
      ),
      uxProgressUpdateThrottleMs:
        this.readPositiveNumber(remote.uxProgressUpdateThrottleMs) ??
        fallback.uxProgressUpdateThrottleMs,
      uxMaxProgressUpdatesPerRun:
        this.readPositiveNumber(remote.uxMaxProgressUpdatesPerRun) ??
        fallback.uxMaxProgressUpdatesPerRun,
    };
  }

  private readCommandAndUxFromEnv(): Pick<
    TelegramChannelRuntimeSettings,
    | 'commandsEnabled'
    | 'enabledCommands'
    | 'commandResumeListLimit'
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
  > {
    return {
      commandsEnabled: this.readBoolean(
        this.readOptionalEnv('CHAT_TELEGRAM_COMMANDS_ENABLED'),
        true,
      ),
      enabledCommands: normalizeTelegramEnabledCommands(
        this.readOptionalEnv('CHAT_TELEGRAM_ENABLED_COMMANDS'),
        DEFAULT_ENABLED_COMMANDS,
      ),
      commandResumeListLimit: this.readPositiveInt(
        'CHAT_TELEGRAM_COMMAND_RESUME_LIST_LIMIT',
        DEFAULT_COMMAND_RESUME_LIST_LIMIT,
      ),
      uxTypingEnabled: this.readBoolean(
        this.readOptionalEnv('CHAT_TELEGRAM_UX_TYPING_ENABLED'),
        true,
      ),
      uxTypingHeartbeatMs: this.readPositiveInt(
        'CHAT_TELEGRAM_UX_TYPING_HEARTBEAT_MS',
        4000,
      ),
      uxStatusUpdatesEnabled: this.readBoolean(
        this.readOptionalEnv('CHAT_TELEGRAM_UX_STATUS_UPDATES_ENABLED'),
        true,
      ),
      uxStatusMode:
        this.readStatusMode(
          this.readOptionalEnv('CHAT_TELEGRAM_UX_STATUS_MODE'),
        ) ?? 'single_message',
      uxHideThinking: this.readBoolean(
        this.readOptionalEnv('CHAT_TELEGRAM_UX_HIDE_THINKING'),
        true,
      ),
      uxExposeToolNames: this.readBoolean(
        this.readOptionalEnv('CHAT_TELEGRAM_UX_EXPOSE_TOOL_NAMES'),
        false,
      ),
      uxCommandMenuSyncEnabled: this.readBoolean(
        this.readOptionalEnv('CHAT_TELEGRAM_UX_COMMAND_MENU_SYNC_ENABLED'),
        true,
      ),
      uxProgressEventsAllowlist: normalizeTelegramProgressEventAllowlist(
        this.readOptionalEnv('CHAT_TELEGRAM_UX_PROGRESS_EVENTS_ALLOWLIST'),
        DEFAULT_UX_PROGRESS_EVENTS_ALLOWLIST,
      ),
      uxProgressUpdateThrottleMs: this.readPositiveInt(
        'CHAT_TELEGRAM_UX_PROGRESS_UPDATE_THROTTLE_MS',
        1500,
      ),
      uxMaxProgressUpdatesPerRun: this.readPositiveInt(
        'CHAT_TELEGRAM_UX_MAX_PROGRESS_UPDATES_PER_RUN',
        40,
      ),
    };
  }

  private readIngressMode(value: unknown): ChatTelegramIngressMode | null {
    if (value === 'webhook' || value === 'polling' || value === 'hybrid') {
      return value;
    }

    return null;
  }

  private readStatusMode(value: unknown): ChatTelegramStatusMode | null {
    if (value === 'single_message' || value === 'multi_message') {
      return value;
    }

    return null;
  }

  private readBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }

    return fallback;
  }

  private readPositiveNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }

    return null;
  }

  private readPositiveInt(key: string, fallback: number): number {
    const value = this.readOptionalEnv(key);
    if (!value) {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }

  private readNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
