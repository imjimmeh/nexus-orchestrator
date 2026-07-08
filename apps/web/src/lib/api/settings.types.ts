/**
 * Settings types shared by web client and (eventually) the backend API.
 *
 * Extracted from `./types.ts` as part of the api-types god-file split.
 * Foundational types (`Timestamps`, `AuthType`) come from `./common.types`.
 * The `KanbanSetting` alias is a single-purpose re-export of
 * `KanbanSettingContract` from `@nexus/kanban-contracts` — do not bundle
 * other config types in here. `ProviderPreset` / `ModelPreset` /
 * `EffectiveConfig*` are owned by `child-3`. `child-7` will sweep the
 * re-exports in `./types.ts` once the rest of the extraction work lands.
 */

import type { KanbanSetting as KanbanSettingContract } from "@nexus/kanban-contracts";

export interface UserQuestion {
  question: string;
  options: string[];
}

export interface QuestionAnswer {
  questionIndex: number;
  selectedOption: string | null;
  freeTextAnswer: string | null;
}

export interface SystemSetting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

export type KanbanSetting = KanbanSettingContract;

export type TelegramIngressMode = "webhook" | "polling" | "hybrid";
export type TelegramStatusMode = "single_message" | "multi_message";

export interface TelegramSettings {
  ingressMode: TelegramIngressMode;
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
  uxStatusMode: TelegramStatusMode;
  uxHideThinking: boolean;
  uxExposeToolNames: boolean;
  uxCommandMenuSyncEnabled: boolean;
  uxProgressEventsAllowlist: string[];
  uxProgressUpdateThrottleMs: number;
  uxMaxProgressUpdatesPerRun: number;
  hasBotToken: boolean;
  hasWebhookSecret: boolean;
}

export interface UpdateTelegramSettingsRequest {
  ingressMode?: TelegramIngressMode;
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
  uxStatusMode?: TelegramStatusMode;
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
