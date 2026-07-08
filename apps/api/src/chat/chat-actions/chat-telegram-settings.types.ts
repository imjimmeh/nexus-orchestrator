export type ChatTelegramIngressMode = 'webhook' | 'polling' | 'hybrid';
export type ChatTelegramStatusMode = 'single_message' | 'multi_message';

export interface ChatTelegramRuntimeSettings {
  ingressMode: ChatTelegramIngressMode;
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
  uxStatusMode: ChatTelegramStatusMode;
  uxHideThinking: boolean;
  uxExposeToolNames: boolean;
  uxCommandMenuSyncEnabled: boolean;
  uxProgressEventsAllowlist: string[];
  uxProgressUpdateThrottleMs: number;
  uxMaxProgressUpdatesPerRun: number;
  botToken: string | null;
  webhookSecret: string | null;
}
