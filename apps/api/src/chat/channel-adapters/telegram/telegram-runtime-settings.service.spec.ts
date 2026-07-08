import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramRuntimeSettingsService } from './telegram-runtime-settings.service';

describe('TelegramRuntimeSettingsService', () => {
  const previousMode = process.env.CHAT_TELEGRAM_INGRESS_MODE;
  const previousProfile = process.env.CHAT_TELEGRAM_DEFAULT_AGENT_PROFILE;
  const previousProject = process.env.CHAT_TELEGRAM_DEFAULT_SCOPE_ID;
  const previousAllowedUserIds = process.env.CHAT_TELEGRAM_ALLOWED_USER_IDS;
  const previousBotToken = process.env.CHAT_TELEGRAM_BOT_TOKEN;
  const previousWebhookSecret = process.env.CHAT_TELEGRAM_WEBHOOK_SECRET;
  const previousCommandsEnabled = process.env.CHAT_TELEGRAM_COMMANDS_ENABLED;
  const previousEnabledCommands = process.env.CHAT_TELEGRAM_ENABLED_COMMANDS;
  const previousResumeListLimit =
    process.env.CHAT_TELEGRAM_COMMAND_RESUME_LIST_LIMIT;
  const previousUxTypingEnabled = process.env.CHAT_TELEGRAM_UX_TYPING_ENABLED;
  const previousUxTypingHeartbeatMs =
    process.env.CHAT_TELEGRAM_UX_TYPING_HEARTBEAT_MS;
  const previousUxStatusUpdatesEnabled =
    process.env.CHAT_TELEGRAM_UX_STATUS_UPDATES_ENABLED;
  const previousUxStatusMode = process.env.CHAT_TELEGRAM_UX_STATUS_MODE;
  const previousUxHideThinking = process.env.CHAT_TELEGRAM_UX_HIDE_THINKING;
  const previousUxExposeToolNames =
    process.env.CHAT_TELEGRAM_UX_EXPOSE_TOOL_NAMES;
  const previousUxCommandMenuSyncEnabled =
    process.env.CHAT_TELEGRAM_UX_COMMAND_MENU_SYNC_ENABLED;
  const previousUxProgressEventsAllowlist =
    process.env.CHAT_TELEGRAM_UX_PROGRESS_EVENTS_ALLOWLIST;
  const previousUxProgressUpdateThrottleMs =
    process.env.CHAT_TELEGRAM_UX_PROGRESS_UPDATE_THROTTLE_MS;
  const previousUxMaxProgressUpdatesPerRun =
    process.env.CHAT_TELEGRAM_UX_MAX_PROGRESS_UPDATES_PER_RUN;

  const getTelegramRuntimeSettings = vi.fn();

  function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
      return;
    }

    process.env[key] = value;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CHAT_TELEGRAM_INGRESS_MODE = 'polling';
    process.env.CHAT_TELEGRAM_DEFAULT_AGENT_PROFILE = 'architect-agent';
    process.env.CHAT_TELEGRAM_DEFAULT_SCOPE_ID = 'project-1';
    process.env.CHAT_TELEGRAM_ALLOWED_USER_IDS = '5001,invalid,5001, 5002';
    process.env.CHAT_TELEGRAM_BOT_TOKEN = 'env-token';
    process.env.CHAT_TELEGRAM_WEBHOOK_SECRET = 'env-secret';
    process.env.CHAT_TELEGRAM_COMMANDS_ENABLED = 'true';
    process.env.CHAT_TELEGRAM_ENABLED_COMMANDS = 'help,new,resume,agent';
    process.env.CHAT_TELEGRAM_COMMAND_RESUME_LIST_LIMIT = '7';
    process.env.CHAT_TELEGRAM_UX_TYPING_ENABLED = 'true';
    process.env.CHAT_TELEGRAM_UX_TYPING_HEARTBEAT_MS = '4200';
    process.env.CHAT_TELEGRAM_UX_STATUS_UPDATES_ENABLED = 'true';
    process.env.CHAT_TELEGRAM_UX_STATUS_MODE = 'single_message';
    process.env.CHAT_TELEGRAM_UX_HIDE_THINKING = 'true';
    process.env.CHAT_TELEGRAM_UX_EXPOSE_TOOL_NAMES = 'false';
    process.env.CHAT_TELEGRAM_UX_COMMAND_MENU_SYNC_ENABLED = 'true';
    process.env.CHAT_TELEGRAM_UX_PROGRESS_EVENTS_ALLOWLIST =
      'job_start,tool_execution_start';
    process.env.CHAT_TELEGRAM_UX_PROGRESS_UPDATE_THROTTLE_MS = '1700';
    process.env.CHAT_TELEGRAM_UX_MAX_PROGRESS_UPDATES_PER_RUN = '32';
  });

  afterEach(() => {
    restoreEnv('CHAT_TELEGRAM_INGRESS_MODE', previousMode);
    restoreEnv('CHAT_TELEGRAM_DEFAULT_AGENT_PROFILE', previousProfile);
    restoreEnv('CHAT_TELEGRAM_DEFAULT_SCOPE_ID', previousProject);
    restoreEnv('CHAT_TELEGRAM_ALLOWED_USER_IDS', previousAllowedUserIds);
    restoreEnv('CHAT_TELEGRAM_BOT_TOKEN', previousBotToken);
    restoreEnv('CHAT_TELEGRAM_WEBHOOK_SECRET', previousWebhookSecret);
    restoreEnv('CHAT_TELEGRAM_COMMANDS_ENABLED', previousCommandsEnabled);
    restoreEnv('CHAT_TELEGRAM_ENABLED_COMMANDS', previousEnabledCommands);
    restoreEnv(
      'CHAT_TELEGRAM_COMMAND_RESUME_LIST_LIMIT',
      previousResumeListLimit,
    );
    restoreEnv('CHAT_TELEGRAM_UX_TYPING_ENABLED', previousUxTypingEnabled);
    restoreEnv(
      'CHAT_TELEGRAM_UX_TYPING_HEARTBEAT_MS',
      previousUxTypingHeartbeatMs,
    );
    restoreEnv(
      'CHAT_TELEGRAM_UX_STATUS_UPDATES_ENABLED',
      previousUxStatusUpdatesEnabled,
    );
    restoreEnv('CHAT_TELEGRAM_UX_STATUS_MODE', previousUxStatusMode);
    restoreEnv('CHAT_TELEGRAM_UX_HIDE_THINKING', previousUxHideThinking);
    restoreEnv('CHAT_TELEGRAM_UX_EXPOSE_TOOL_NAMES', previousUxExposeToolNames);
    restoreEnv(
      'CHAT_TELEGRAM_UX_COMMAND_MENU_SYNC_ENABLED',
      previousUxCommandMenuSyncEnabled,
    );
    restoreEnv(
      'CHAT_TELEGRAM_UX_PROGRESS_EVENTS_ALLOWLIST',
      previousUxProgressEventsAllowlist,
    );
    restoreEnv(
      'CHAT_TELEGRAM_UX_PROGRESS_UPDATE_THROTTLE_MS',
      previousUxProgressUpdateThrottleMs,
    );
    restoreEnv(
      'CHAT_TELEGRAM_UX_MAX_PROGRESS_UPDATES_PER_RUN',
      previousUxMaxProgressUpdatesPerRun,
    );
  });

  function createService() {
    return new TelegramRuntimeSettingsService({
      getTelegramRuntimeSettings,
    } as never);
  }

  it('falls back to environment settings when core API fetch fails', async () => {
    getTelegramRuntimeSettings.mockRejectedValue(new Error('network failure'));

    const service = createService();
    const settings = await service.getSettings(true);

    expect(settings.ingressMode).toBe('polling');
    expect(settings.defaultAgentProfile).toBe('architect-agent');
    expect(settings.defaultScopeId).toBe('project-1');
    expect(settings.allowedUserIds).toEqual(['5001', '5002']);
    expect(settings.botToken).toBe('env-token');
    expect(settings.webhookSecret).toBe('env-secret');
    expect(settings.commandsEnabled).toBe(true);
    expect(settings.enabledCommands).toEqual([
      'help',
      'new',
      'resume',
      'agent',
    ]);
    expect(settings.commandResumeListLimit).toBe(7);
    expect(settings.uxTypingEnabled).toBe(true);
    expect(settings.uxTypingHeartbeatMs).toBe(4200);
    expect(settings.uxStatusUpdatesEnabled).toBe(true);
    expect(settings.uxStatusMode).toBe('single_message');
    expect(settings.uxHideThinking).toBe(true);
    expect(settings.uxExposeToolNames).toBe(false);
    expect(settings.uxCommandMenuSyncEnabled).toBe(true);
    expect(settings.uxProgressEventsAllowlist).toEqual([
      'job_start',
      'tool_execution_start',
    ]);
    expect(settings.uxProgressUpdateThrottleMs).toBe(1700);
    expect(settings.uxMaxProgressUpdatesPerRun).toBe(32);
  });

  it('caches core runtime settings between reads', async () => {
    getTelegramRuntimeSettings.mockResolvedValue({
      ingressMode: 'hybrid',
      defaultAgentProfile: 'ceo-agent',
      defaultScopeId: null,
      allowedUserIds: ['9001', '9002'],
      pollTimeoutSeconds: 50,
      pollRetryDelayMs: 1000,
      pollBackoffMaxMs: 30000,
      outboundRelayEnabled: true,
      outboundRelayIntervalMs: 3000,
      outboundRelayBatchSize: 20,
      botToken: 'core-token',
      webhookSecret: 'core-secret',
      commandsEnabled: false,
      enabledCommands: ['help', 'resume'],
      commandResumeListLimit: 3,
      uxTypingEnabled: false,
      uxTypingHeartbeatMs: 5000,
      uxStatusUpdatesEnabled: false,
      uxStatusMode: 'multi_message',
      uxHideThinking: true,
      uxExposeToolNames: true,
      uxCommandMenuSyncEnabled: true,
      uxProgressEventsAllowlist: ['job_start', 'container_started'],
      uxProgressUpdateThrottleMs: 2000,
      uxMaxProgressUpdatesPerRun: 12,
    });

    const service = createService();
    const first = await service.getSettings();
    const second = await service.getSettings();

    expect(first.botToken).toBe('core-token');
    expect(second.botToken).toBe('core-token');
    expect(first.allowedUserIds).toEqual(['9001', '9002']);
    expect(first.commandsEnabled).toBe(false);
    expect(first.enabledCommands).toEqual(['help', 'resume']);
    expect(first.commandResumeListLimit).toBe(3);
    expect(first.uxTypingEnabled).toBe(false);
    expect(first.uxTypingHeartbeatMs).toBe(5000);
    expect(first.uxStatusUpdatesEnabled).toBe(false);
    expect(first.uxStatusMode).toBe('multi_message');
    expect(first.uxExposeToolNames).toBe(true);
    expect(first.uxProgressEventsAllowlist).toEqual([
      'job_start',
      'container_started',
    ]);
    expect(first.uxProgressUpdateThrottleMs).toBe(2000);
    expect(first.uxMaxProgressUpdatesPerRun).toBe(12);
    expect(getTelegramRuntimeSettings).toHaveBeenCalledTimes(1);
  });
});
