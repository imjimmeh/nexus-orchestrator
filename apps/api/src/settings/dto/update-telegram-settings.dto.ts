import { ApiPropertyOptional } from '@nestjs/swagger';
import type { UpdateTelegramSettingsRequestV1 } from '@nexus/core';
import {
  TELEGRAM_INGRESS_MODES,
  TELEGRAM_STATUS_MODES,
  updateTelegramSettingsSchema,
} from '@nexus/core';

export class UpdateTelegramSettingsDto implements UpdateTelegramSettingsRequestV1 {
  static get schema() {
    return updateTelegramSettingsSchema;
  }

  @ApiPropertyOptional({ enum: TELEGRAM_INGRESS_MODES })
  ingressMode?: 'webhook' | 'polling' | 'hybrid';

  @ApiPropertyOptional({
    description: 'Default agent profile for Telegram ingress',
  })
  defaultAgentProfile?: string;

  @ApiPropertyOptional({
    description: 'Optional default scope ID for Telegram ingress (null clears)',
    nullable: true,
  })
  defaultScopeId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Optional allowlist of Telegram user IDs. Empty list means allow all users.',
  })
  allowedUserIds?: string[];

  @ApiPropertyOptional({ minimum: 1 })
  pollTimeoutSeconds?: number;

  @ApiPropertyOptional({ minimum: 1 })
  pollRetryDelayMs?: number;

  @ApiPropertyOptional({ minimum: 1 })
  pollBackoffMaxMs?: number;

  @ApiPropertyOptional()
  outboundRelayEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 1 })
  outboundRelayIntervalMs?: number;

  @ApiPropertyOptional({ minimum: 1 })
  outboundRelayBatchSize?: number;

  @ApiPropertyOptional({
    description: 'Enable Telegram slash command handling',
  })
  commandsEnabled?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Allowed Telegram slash commands',
  })
  enabledCommands?: string[];

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Maximum sessions returned by /resume list mode',
  })
  commandResumeListLimit?: number;

  @ApiPropertyOptional({ description: 'Enable Telegram typing indicators' })
  uxTypingEnabled?: boolean;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Typing indicator heartbeat interval in milliseconds',
  })
  uxTypingHeartbeatMs?: number;

  @ApiPropertyOptional({
    description: 'Enable intermediate Telegram progress status updates',
  })
  uxStatusUpdatesEnabled?: boolean;

  @ApiPropertyOptional({ enum: TELEGRAM_STATUS_MODES })
  uxStatusMode?: 'single_message' | 'multi_message';

  @ApiPropertyOptional({
    description: 'Hide chain-of-thought style reasoning from Telegram users',
  })
  uxHideThinking?: boolean;

  @ApiPropertyOptional({
    description: 'Include tool names in Telegram progress messages',
  })
  uxExposeToolNames?: boolean;

  @ApiPropertyOptional({
    description: 'Enable synchronization of Telegram slash command menu',
  })
  uxCommandMenuSyncEnabled?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Allowlisted workflow event types eligible for progress relay',
  })
  uxProgressEventsAllowlist?: string[];

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Minimum delay between progress relay updates (ms)',
  })
  uxProgressUpdateThrottleMs?: number;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Maximum progress updates sent per run',
  })
  uxMaxProgressUpdatesPerRun?: number;

  @ApiPropertyOptional({
    description:
      'Telegram bot token. Provide to rotate token; omitted leaves unchanged.',
  })
  botToken?: string;

  @ApiPropertyOptional({
    description:
      'Telegram webhook secret. Provide to rotate secret; omitted leaves unchanged.',
  })
  webhookSecret?: string;

  @ApiPropertyOptional({
    description: 'Remove stored bot token from encrypted store',
  })
  clearBotToken?: boolean;

  @ApiPropertyOptional({
    description: 'Remove stored webhook secret from encrypted store',
  })
  clearWebhookSecret?: boolean;
}
