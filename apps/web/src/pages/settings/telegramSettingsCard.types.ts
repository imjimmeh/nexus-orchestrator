import { TelegramIngressMode, TelegramStatusMode } from "@/lib/api/settings.types";

export type TelegramSettingsDraft = {
  ingressMode: TelegramIngressMode;
  defaultAgentProfile: string;
  defaultScopeId: string;
  allowedUserIdsText: string;
  pollTimeoutSeconds: number;
  pollRetryDelayMs: number;
  pollBackoffMaxMs: number;
  outboundRelayEnabled: boolean;
  outboundRelayIntervalMs: number;
  outboundRelayBatchSize: number;
  commandsEnabled: boolean;
  enabledCommandsText: string;
  commandResumeListLimit: number;
  uxTypingEnabled: boolean;
  uxTypingHeartbeatMs: number;
  uxStatusUpdatesEnabled: boolean;
  uxStatusMode: TelegramStatusMode;
  uxHideThinking: boolean;
  uxExposeToolNames: boolean;
  uxCommandMenuSyncEnabled: boolean;
  uxProgressEventsAllowlistText: string;
  uxProgressUpdateThrottleMs: number;
  uxMaxProgressUpdatesPerRun: number;
};

export type TelegramSecretDraft = {
  botToken: string;
  webhookSecret: string;
  clearBotToken: boolean;
  clearWebhookSecret: boolean;
};
