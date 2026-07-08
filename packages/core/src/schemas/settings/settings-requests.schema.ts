import { z } from "zod";

export const TELEGRAM_INGRESS_MODES = ["webhook", "polling", "hybrid"] as const;

export const TELEGRAM_STATUS_MODES = [
  "single_message",
  "multi_message",
] as const;

export const updateTelegramSettingsSchema = z.object({
  ingressMode: z.enum(TELEGRAM_INGRESS_MODES).optional(),
  defaultAgentProfile: z.string().optional(),
  defaultScopeId: z.string().nullable().optional(),
  allowedUserIds: z.array(z.string()).optional(),
  pollTimeoutSeconds: z.coerce.number().int().min(1).optional(),
  pollRetryDelayMs: z.coerce.number().int().min(1).optional(),
  pollBackoffMaxMs: z.coerce.number().int().min(1).optional(),
  outboundRelayEnabled: z.boolean().optional(),
  outboundRelayIntervalMs: z.coerce.number().int().min(1).optional(),
  outboundRelayBatchSize: z.coerce.number().int().min(1).optional(),
  commandsEnabled: z.boolean().optional(),
  enabledCommands: z.array(z.string()).optional(),
  commandResumeListLimit: z.coerce.number().int().min(1).optional(),
  uxTypingEnabled: z.boolean().optional(),
  uxTypingHeartbeatMs: z.coerce.number().int().min(1).optional(),
  uxStatusUpdatesEnabled: z.boolean().optional(),
  uxStatusMode: z.enum(TELEGRAM_STATUS_MODES).optional(),
  uxHideThinking: z.boolean().optional(),
  uxExposeToolNames: z.boolean().optional(),
  uxCommandMenuSyncEnabled: z.boolean().optional(),
  uxProgressEventsAllowlist: z.array(z.string()).optional(),
  uxProgressUpdateThrottleMs: z.coerce.number().int().min(1).optional(),
  uxMaxProgressUpdatesPerRun: z.coerce.number().int().min(1).optional(),
  botToken: z.string().optional(),
  webhookSecret: z.string().optional(),
  clearBotToken: z.boolean().optional(),
  clearWebhookSecret: z.boolean().optional(),
});

export const updateSystemSettingSchema = z.object({
  value: z.unknown(),
  description: z.string().optional(),
});

export type UpdateTelegramSettingsRequest = z.infer<
  typeof updateTelegramSettingsSchema
>;

export type UpdateSystemSettingRequest = z.infer<
  typeof updateSystemSettingSchema
>;
