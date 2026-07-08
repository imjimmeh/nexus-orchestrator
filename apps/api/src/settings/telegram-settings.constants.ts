import type { TelegramSettingsV1 } from '@nexus/core';

export const TELEGRAM_DEFAULT_ENABLED_COMMANDS = [
  'help',
  'new',
  'resume',
  'agent',
];

export const TELEGRAM_DEFAULT_PROGRESS_EVENTS_ALLOWLIST = [
  'job_start',
  'agent_prompt_sent',
  'tool_execution_start',
  'tool_execution_end',
  'container_starting',
  'container_started',
  'container_ready',
  'capability_preflight_failed',
];

export const TELEGRAM_SETTING_KEYS = {
  ingressMode: 'telegram_ingress_mode',
  defaultAgentProfile: 'telegram_default_agent_profile',
  defaultScopeId: 'telegram_default_scope_id',
  allowedUserIds: 'telegram_allowed_user_ids',
  pollTimeoutSeconds: 'telegram_poll_timeout_seconds',
  pollRetryDelayMs: 'telegram_poll_retry_delay_ms',
  pollBackoffMaxMs: 'telegram_poll_backoff_max_ms',
  outboundRelayEnabled: 'telegram_outbound_relay_enabled',
  outboundRelayIntervalMs: 'telegram_outbound_relay_interval_ms',
  outboundRelayBatchSize: 'telegram_outbound_relay_batch_size',
  commandsEnabled: 'telegram_commands_enabled',
  enabledCommands: 'telegram_enabled_commands',
  commandResumeListLimit: 'telegram_command_resume_list_limit',
  uxTypingEnabled: 'telegram_ux_typing_enabled',
  uxTypingHeartbeatMs: 'telegram_ux_typing_heartbeat_ms',
  uxStatusUpdatesEnabled: 'telegram_ux_status_updates_enabled',
  uxStatusMode: 'telegram_ux_status_mode',
  uxHideThinking: 'telegram_ux_hide_thinking',
  uxExposeToolNames: 'telegram_ux_expose_tool_names',
  uxCommandMenuSyncEnabled: 'telegram_ux_command_menu_sync_enabled',
  uxProgressEventsAllowlist: 'telegram_ux_progress_events_allowlist',
  uxProgressUpdateThrottleMs: 'telegram_ux_progress_update_throttle_ms',
  uxMaxProgressUpdatesPerRun: 'telegram_ux_max_progress_updates_per_run',
} as const;

export const TELEGRAM_SECRET_NAMES = {
  botToken: 'telegram_bot_token',
  webhookSecret: 'telegram_webhook_secret',
} as const;

export const TELEGRAM_UNSET_DEFAULT_SCOPE_ID_VALUE = '';

export const TELEGRAM_SETTINGS_DEFAULTS: TelegramSettingsV1 = {
  ingressMode: 'webhook',
  defaultAgentProfile: 'friendly-general-assistant',
  defaultScopeId: null,
  allowedUserIds: [],
  pollTimeoutSeconds: 50,
  pollRetryDelayMs: 1000,
  pollBackoffMaxMs: 30000,
  outboundRelayEnabled: true,
  outboundRelayIntervalMs: 3000,
  outboundRelayBatchSize: 20,
  commandsEnabled: true,
  enabledCommands: TELEGRAM_DEFAULT_ENABLED_COMMANDS,
  commandResumeListLimit: 8,
  uxTypingEnabled: true,
  uxTypingHeartbeatMs: 4000,
  uxStatusUpdatesEnabled: true,
  uxStatusMode: 'single_message',
  uxHideThinking: true,
  uxExposeToolNames: false,
  uxCommandMenuSyncEnabled: true,
  uxProgressEventsAllowlist: TELEGRAM_DEFAULT_PROGRESS_EVENTS_ALLOWLIST,
  uxProgressUpdateThrottleMs: 1500,
  uxMaxProgressUpdatesPerRun: 40,
};

export const TELEGRAM_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [TELEGRAM_SETTING_KEYS.ingressMode]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.ingressMode,
    description:
      'Telegram ingress mode for chat adapter: webhook, polling, or hybrid',
  },
  [TELEGRAM_SETTING_KEYS.defaultAgentProfile]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.defaultAgentProfile,
    description:
      'Default agent profile used for inbound Telegram messages when no override is provided',
  },
  [TELEGRAM_SETTING_KEYS.defaultScopeId]: {
    value: TELEGRAM_UNSET_DEFAULT_SCOPE_ID_VALUE,
    description:
      'Optional default scope ID for Telegram inbound sessions; null keeps sessions scope-agnostic',
  },
  [TELEGRAM_SETTING_KEYS.allowedUserIds]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.allowedUserIds,
    description:
      'Optional Telegram user ID allowlist for inbound messages; empty allows all users',
  },
  [TELEGRAM_SETTING_KEYS.pollTimeoutSeconds]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.pollTimeoutSeconds,
    description: 'Telegram getUpdates long-poll timeout in seconds',
  },
  [TELEGRAM_SETTING_KEYS.pollRetryDelayMs]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.pollRetryDelayMs,
    description:
      'Initial retry delay in milliseconds after Telegram polling errors',
  },
  [TELEGRAM_SETTING_KEYS.pollBackoffMaxMs]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.pollBackoffMaxMs,
    description:
      'Maximum exponential backoff delay in milliseconds for Telegram polling retries',
  },
  [TELEGRAM_SETTING_KEYS.outboundRelayEnabled]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.outboundRelayEnabled,
    description:
      'Enable relay of terminal workflow outcomes back to Telegram users',
  },
  [TELEGRAM_SETTING_KEYS.outboundRelayIntervalMs]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.outboundRelayIntervalMs,
    description:
      'Polling interval in milliseconds for scanning pending Telegram relay candidates',
  },
  [TELEGRAM_SETTING_KEYS.outboundRelayBatchSize]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.outboundRelayBatchSize,
    description:
      'Maximum number of inbound Telegram messages processed per relay polling cycle',
  },
  [TELEGRAM_SETTING_KEYS.commandsEnabled]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.commandsEnabled,
    description: 'Enable Telegram slash command handling',
  },
  [TELEGRAM_SETTING_KEYS.enabledCommands]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.enabledCommands,
    description:
      'Allowed Telegram slash commands for runtime command routing and menu sync',
  },
  [TELEGRAM_SETTING_KEYS.commandResumeListLimit]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.commandResumeListLimit,
    description:
      'Maximum number of recent sessions returned by /resume without explicit target',
  },
  [TELEGRAM_SETTING_KEYS.uxTypingEnabled]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.uxTypingEnabled,
    description:
      'Enable Telegram typing indicators during active workflow runs',
  },
  [TELEGRAM_SETTING_KEYS.uxTypingHeartbeatMs]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.uxTypingHeartbeatMs,
    description: 'Typing indicator heartbeat cadence in milliseconds',
  },
  [TELEGRAM_SETTING_KEYS.uxStatusUpdatesEnabled]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.uxStatusUpdatesEnabled,
    description: 'Enable intermediate Telegram progress status updates',
  },
  [TELEGRAM_SETTING_KEYS.uxStatusMode]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.uxStatusMode,
    description:
      'Telegram progress status mode: single_message edits or multi_message posts',
  },
  [TELEGRAM_SETTING_KEYS.uxHideThinking]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.uxHideThinking,
    description:
      'Suppress internal reasoning artifacts from Telegram outbound responses',
  },
  [TELEGRAM_SETTING_KEYS.uxExposeToolNames]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.uxExposeToolNames,
    description:
      'When true, include tool names in user-facing Telegram progress messages',
  },
  [TELEGRAM_SETTING_KEYS.uxCommandMenuSyncEnabled]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.uxCommandMenuSyncEnabled,
    description: 'Enable Telegram slash command menu synchronization',
  },
  [TELEGRAM_SETTING_KEYS.uxProgressEventsAllowlist]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.uxProgressEventsAllowlist,
    description:
      'Allowlisted workflow event types eligible for Telegram progress relay',
  },
  [TELEGRAM_SETTING_KEYS.uxProgressUpdateThrottleMs]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.uxProgressUpdateThrottleMs,
    description: 'Minimum delay between relayed Telegram progress updates',
  },
  [TELEGRAM_SETTING_KEYS.uxMaxProgressUpdatesPerRun]: {
    value: TELEGRAM_SETTINGS_DEFAULTS.uxMaxProgressUpdatesPerRun,
    description: 'Maximum Telegram progress updates emitted per workflow run',
  },
};
