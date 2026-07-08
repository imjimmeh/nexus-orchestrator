import type { Logger } from '@nestjs/common';
import type { AppendOutboundMessageInput } from '../../chat-messages/chat-messages.types';

export const TELEGRAM_PROGRESS_COUNT_METADATA_KEY =
  'telegramUxProgressRelayCount';
export const TELEGRAM_PROGRESS_LAST_AT_METADATA_KEY =
  'telegramUxLastProgressAt';
export const TELEGRAM_PROGRESS_LAST_EVENT_METADATA_KEY =
  'telegramUxLastProgressEventType';
export const TELEGRAM_PROGRESS_CURSOR_METADATA_KEY =
  'telegramUxLastRelayedEventCursor';
export const TELEGRAM_STATUS_MESSAGE_ID_METADATA_KEY =
  'telegramUxStatusMessageId';
export const TELEGRAM_STATUS_PROVIDER_MESSAGE_ID_METADATA_KEY =
  'telegramUxStatusProviderMessageId';
export const TELEGRAM_TYPING_LAST_AT_METADATA_KEY = 'telegramUxLastTypingAt';

export interface RelayCandidateMessage {
  id: string;
  chat_session_id: string;
  metadata?: Record<string, unknown> | null;
}

export interface TelegramProgressRelayEvent {
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface ActiveRunRuntimeSettings {
  botToken: string | null;
  commandsEnabled: boolean;
  enabledCommands: string[];
  uxCommandMenuSyncEnabled: boolean;
  uxStatusUpdatesEnabled: boolean;
  uxExposeToolNames: boolean;
  uxStatusMode: 'single_message' | 'multi_message';
  uxProgressEventsAllowlist: string[];
  uxProgressUpdateThrottleMs: number;
  uxMaxProgressUpdatesPerRun: number;
  uxTypingEnabled: boolean;
  uxTypingHeartbeatMs: number;
}

export interface ActiveRunHelperDependencies {
  chatActions: {
    getWorkflowRunEvents: (
      runId: string,
      correlationId: string,
    ) => Promise<TelegramProgressRelayEvent[]>;
  };
  chatMessageRepo: {
    update: (
      id: string,
      data: Record<string, unknown>,
    ) => Promise<RelayCandidateMessage | null>;
  };
  chatMessages: {
    appendOutboundMessage: (
      params: AppendOutboundMessageInput,
    ) => Promise<{ messageId: string }>;
  };
  telegramSender: {
    sendMessage: (params: {
      channel: string;
      externalThreadId: string;
      text: string;
    }) => Promise<{ providerMessageId: string | null }>;
    sendChatAction: (params: {
      externalThreadId: string;
      action: 'typing';
    }) => Promise<void>;
    editMessageText: (params: {
      externalThreadId: string;
      providerMessageId: string;
      text: string;
    }) => Promise<boolean>;
    setMyCommands: (
      commands: Array<{ command: string; description: string }>,
    ) => Promise<void>;
    clearMyCommands: () => Promise<void>;
  };
  logger: Pick<Logger, 'warn'>;
  resolveExternalThreadId: (
    message: RelayCandidateMessage,
  ) => Promise<string | null>;
  mergeMetadata: (
    metadata: Record<string, unknown> | null | undefined,
    additions: Record<string, unknown>,
  ) => Record<string, unknown>;
  readNonEmptyString: (value: unknown) => string | null;
}
