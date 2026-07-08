export type TelegramIngressModeV1 = "webhook" | "polling" | "hybrid";

export type TelegramStatusMessageModeV1 = "single_message" | "multi_message";

export interface TelegramSettingsV1 {
  ingressMode: TelegramIngressModeV1;
  defaultAgentProfile: string;
  defaultScopeId: string | null;
  allowedUserIds: string[];
  pollTimeoutSeconds: number;
  pollRetryDelayMs: number;
  pollBackoffMaxMs: number;
  outboundRelayEnabled: boolean;
  outboundRelayIntervalMs: number;
  outboundRelayBatchSize: number;
  commandsEnabled: boolean;
  enabledCommands: string[];
  commandResumeListLimit: number;
  uxTypingEnabled: boolean;
  uxTypingHeartbeatMs: number;
  uxStatusUpdatesEnabled: boolean;
  uxStatusMode: TelegramStatusMessageModeV1;
  uxHideThinking: boolean;
  uxExposeToolNames: boolean;
  uxCommandMenuSyncEnabled: boolean;
  uxProgressEventsAllowlist: string[];
  uxProgressUpdateThrottleMs: number;
  uxMaxProgressUpdatesPerRun: number;
}

export interface TelegramSettingsViewV1 extends TelegramSettingsV1 {
  hasBotToken: boolean;
  hasWebhookSecret: boolean;
}

export interface TelegramRuntimeSettingsV1 extends TelegramSettingsV1 {
  botToken: string | null;
  webhookSecret: string | null;
}

export interface UpdateTelegramSettingsRequestV1 {
  ingressMode?: TelegramIngressModeV1;
  defaultAgentProfile?: string;
  defaultScopeId?: string | null;
  allowedUserIds?: string[];
  pollTimeoutSeconds?: number;
  pollRetryDelayMs?: number;
  pollBackoffMaxMs?: number;
  outboundRelayEnabled?: boolean;
  outboundRelayIntervalMs?: number;
  outboundRelayBatchSize?: number;
  commandsEnabled?: boolean;
  enabledCommands?: string[];
  commandResumeListLimit?: number;
  uxTypingEnabled?: boolean;
  uxTypingHeartbeatMs?: number;
  uxStatusUpdatesEnabled?: boolean;
  uxStatusMode?: TelegramStatusMessageModeV1;
  uxHideThinking?: boolean;
  uxExposeToolNames?: boolean;
  uxCommandMenuSyncEnabled?: boolean;
  uxProgressEventsAllowlist?: string[];
  uxProgressUpdateThrottleMs?: number;
  uxMaxProgressUpdatesPerRun?: number;
  botToken?: string;
  webhookSecret?: string;
  clearBotToken?: boolean;
  clearWebhookSecret?: boolean;
}
