import {
  buildQuestionRelayKey,
  buildQuestionRelayText,
  extractPendingQuestions,
} from '../../chat-actions/chat-run-questions.util';
import {
  buildProgressRelayText,
  selectLatestProgressRelayEvent,
} from './telegram-outbound-relay-progress.utils';
import { resolveTelegramCommandMenu } from './telegram-outbound-relay-command-menu.utils';
import {
  type ActiveRunHelperDependencies,
  type ActiveRunRuntimeSettings,
  type RelayCandidateMessage,
  TELEGRAM_PROGRESS_COUNT_METADATA_KEY,
  TELEGRAM_PROGRESS_CURSOR_METADATA_KEY,
  TELEGRAM_PROGRESS_LAST_AT_METADATA_KEY,
  TELEGRAM_PROGRESS_LAST_EVENT_METADATA_KEY,
  TELEGRAM_STATUS_MESSAGE_ID_METADATA_KEY,
  TELEGRAM_STATUS_PROVIDER_MESSAGE_ID_METADATA_KEY,
  TELEGRAM_TYPING_LAST_AT_METADATA_KEY,
} from './telegram-outbound-relay-active-run.types';

export class TelegramOutboundRelayActiveRunHelper {
  private lastCommandMenuSignature: string | null = null;

  constructor(private readonly deps: ActiveRunHelperDependencies) {}

  async syncTelegramCommandMenu(
    runtimeSettings: ActiveRunRuntimeSettings,
  ): Promise<void> {
    if (!runtimeSettings.botToken) {
      return;
    }

    const commandMenu = resolveTelegramCommandMenu({
      commandsEnabled: runtimeSettings.commandsEnabled,
      uxCommandMenuSyncEnabled: runtimeSettings.uxCommandMenuSyncEnabled,
      enabledCommands: runtimeSettings.enabledCommands,
    });
    if (commandMenu.signature === this.lastCommandMenuSignature) {
      return;
    }

    try {
      if (commandMenu.commands === null) {
        await this.deps.telegramSender.clearMyCommands();
      } else {
        await this.deps.telegramSender.setMyCommands(commandMenu.commands);
      }

      this.lastCommandMenuSignature = commandMenu.signature;
    } catch (error) {
      this.deps.logger.warn(
        `Failed to sync Telegram command menu: ${(error as Error).message}`,
      );
    }
  }

  async relayPendingQuestions(params: {
    message: RelayCandidateMessage;
    runId: string;
    correlationId: string;
  }): Promise<boolean> {
    const runEvents = await this.deps.chatActions.getWorkflowRunEvents(
      params.runId,
      params.correlationId,
    );
    const pendingQuestions = extractPendingQuestions(runEvents);
    if (!pendingQuestions || pendingQuestions.length === 0) {
      return false;
    }

    const questionKey = buildQuestionRelayKey(pendingQuestions);
    const existingQuestionKey = this.deps.readNonEmptyString(
      params.message.metadata?.telegramQuestionRelayQuestionKey,
    );
    if (existingQuestionKey === questionKey) {
      return true;
    }

    const externalThreadId = await this.deps.resolveExternalThreadId(
      params.message,
    );
    if (!externalThreadId) {
      return false;
    }

    const text = buildQuestionRelayText(pendingQuestions);
    const sendResult = await this.deps.telegramSender.sendMessage({
      channel: 'telegram',
      externalThreadId,
      text,
    });

    const outbound = await this.deps.chatMessages.appendOutboundMessage({
      chatId: params.message.chat_session_id,
      text,
      channel: 'telegram',
      providerMessageId: sendResult.providerMessageId,
      metadata: {
        runId: params.runId,
        relayInboundMessageId: params.message.id,
        relaySource: 'telegram_question_relay',
        questionRelayKey: questionKey,
        questionCount: pendingQuestions.length,
      },
    });

    await this.deps.chatMessageRepo.update(params.message.id, {
      metadata: this.deps.mergeMetadata(params.message.metadata, {
        telegramQuestionRelaySentAt: new Date().toISOString(),
        telegramQuestionRelayQuestionKey: questionKey,
        telegramQuestionRelayOutboundMessageId: outbound.messageId,
        telegramQuestionRelayProviderMessageId: sendResult.providerMessageId,
        telegramQuestionRelayExternalThreadId: externalThreadId,
        telegramQuestionRelayQuestionCount: pendingQuestions.length,
      }),
    });

    return true;
  }

  async relayProgressStatusUpdate(params: {
    message: RelayCandidateMessage;
    runId: string;
    correlationId: string;
    settings: ActiveRunRuntimeSettings;
  }): Promise<RelayCandidateMessage> {
    if (!params.settings.uxStatusUpdatesEnabled) {
      return params.message;
    }

    if (this.hasReachedProgressRelayLimit(params.message, params.settings)) {
      return params.message;
    }

    if (this.isProgressRelayThrottled(params.message, params.settings)) {
      return params.message;
    }

    const runEvents = await this.deps.chatActions.getWorkflowRunEvents(
      params.runId,
      params.correlationId,
    );
    const progressEvents = runEvents.map((event) => ({
      event_type: event.event_type,
      timestamp: event.timestamp,
      payload: event.payload,
    }));

    const progressEvent = selectLatestProgressRelayEvent({
      events: progressEvents,
      allowlistedEventTypes: this.buildProgressEventAllowlist(params.settings),
      afterCursor: this.deps.readNonEmptyString(
        params.message.metadata?.[TELEGRAM_PROGRESS_CURSOR_METADATA_KEY],
      ),
    });

    if (!progressEvent) {
      return params.message;
    }

    const text = buildProgressRelayText({
      eventType: progressEvent.eventType,
      payload: progressEvent.event.payload,
      exposeToolNames: params.settings.uxExposeToolNames,
    });
    if (!text) {
      return params.message;
    }

    const externalThreadId = await this.deps.resolveExternalThreadId(
      params.message,
    );
    if (!externalThreadId) {
      return params.message;
    }

    return this.publishProgressStatusUpdate({
      message: params.message,
      runId: params.runId,
      externalThreadId,
      text,
      eventCursor: progressEvent.cursor,
      eventType: progressEvent.eventType,
      statusMode: params.settings.uxStatusMode,
    });
  }

  async relayTypingHeartbeat(params: {
    message: RelayCandidateMessage;
    settings: ActiveRunRuntimeSettings;
  }): Promise<void> {
    if (!params.settings.uxTypingEnabled) {
      return;
    }

    const lastTypingAtMs = this.readIsoDateToMs(
      params.message.metadata?.[TELEGRAM_TYPING_LAST_AT_METADATA_KEY],
    );
    if (
      lastTypingAtMs !== null &&
      Date.now() - lastTypingAtMs < params.settings.uxTypingHeartbeatMs
    ) {
      return;
    }

    const externalThreadId = await this.deps.resolveExternalThreadId(
      params.message,
    );
    if (!externalThreadId) {
      return;
    }

    await this.deps.telegramSender.sendChatAction({
      externalThreadId,
      action: 'typing',
    });

    await this.updateRelayMetadata(params.message, {
      [TELEGRAM_TYPING_LAST_AT_METADATA_KEY]: new Date().toISOString(),
    });
  }

  private async publishProgressStatusUpdate(params: {
    message: RelayCandidateMessage;
    runId: string;
    externalThreadId: string;
    text: string;
    eventCursor: string;
    eventType: string;
    statusMode: 'single_message' | 'multi_message';
  }): Promise<RelayCandidateMessage> {
    if (params.statusMode === 'single_message') {
      const edited = await this.tryEditExistingStatusMessage(params);
      if (edited) {
        return edited;
      }
    }

    return this.sendNewProgressStatusMessage(params);
  }

  private async tryEditExistingStatusMessage(params: {
    message: RelayCandidateMessage;
    externalThreadId: string;
    text: string;
    eventCursor: string;
    eventType: string;
  }): Promise<RelayCandidateMessage | null> {
    const providerMessageId = this.deps.readNonEmptyString(
      params.message.metadata?.[
        TELEGRAM_STATUS_PROVIDER_MESSAGE_ID_METADATA_KEY
      ],
    );
    if (!providerMessageId) {
      return null;
    }

    const existing = this.deps.readNonEmptyString(
      params.message.metadata?.telegramUxStatusText,
    );
    const accumulatedText = buildAccumulatedStatusText(existing, params.text);
    const edited = await this.deps.telegramSender.editMessageText({
      externalThreadId: params.externalThreadId,
      providerMessageId,
      text: accumulatedText,
    });
    if (!edited) {
      return null;
    }

    return this.updateRelayMetadata(params.message, {
      [TELEGRAM_PROGRESS_CURSOR_METADATA_KEY]: params.eventCursor,
      [TELEGRAM_PROGRESS_LAST_EVENT_METADATA_KEY]: params.eventType,
      [TELEGRAM_PROGRESS_COUNT_METADATA_KEY]:
        this.readProgressRelayCount(params.message) + 1,
      [TELEGRAM_PROGRESS_LAST_AT_METADATA_KEY]: new Date().toISOString(),
      telegramUxStatusText: accumulatedText,
    });
  }

  private async sendNewProgressStatusMessage(params: {
    message: RelayCandidateMessage;
    runId: string;
    externalThreadId: string;
    text: string;
    eventCursor: string;
    eventType: string;
  }): Promise<RelayCandidateMessage> {
    const sendResult = await this.deps.telegramSender.sendMessage({
      channel: 'telegram',
      externalThreadId: params.externalThreadId,
      text: params.text,
    });

    const outbound = await this.deps.chatMessages.appendOutboundMessage({
      chatId: params.message.chat_session_id,
      text: params.text,
      channel: 'telegram',
      providerMessageId: sendResult.providerMessageId,
      metadata: {
        runId: params.runId,
        relayInboundMessageId: params.message.id,
        relaySource: 'telegram_status_relay',
        statusEventType: params.eventType,
      },
    });

    return this.updateRelayMetadata(params.message, {
      [TELEGRAM_STATUS_MESSAGE_ID_METADATA_KEY]: outbound.messageId,
      [TELEGRAM_STATUS_PROVIDER_MESSAGE_ID_METADATA_KEY]:
        sendResult.providerMessageId,
      [TELEGRAM_PROGRESS_CURSOR_METADATA_KEY]: params.eventCursor,
      [TELEGRAM_PROGRESS_LAST_EVENT_METADATA_KEY]: params.eventType,
      [TELEGRAM_PROGRESS_COUNT_METADATA_KEY]:
        this.readProgressRelayCount(params.message) + 1,
      [TELEGRAM_PROGRESS_LAST_AT_METADATA_KEY]: new Date().toISOString(),
      telegramUxStatusText: params.text,
    });
  }

  private hasReachedProgressRelayLimit(
    message: RelayCandidateMessage,
    settings: ActiveRunRuntimeSettings,
  ): boolean {
    return (
      this.readProgressRelayCount(message) >=
      settings.uxMaxProgressUpdatesPerRun
    );
  }

  private isProgressRelayThrottled(
    message: RelayCandidateMessage,
    settings: ActiveRunRuntimeSettings,
  ): boolean {
    const lastProgressAtMs = this.readIsoDateToMs(
      message.metadata?.[TELEGRAM_PROGRESS_LAST_AT_METADATA_KEY],
    );
    if (lastProgressAtMs === null) {
      return false;
    }

    return Date.now() - lastProgressAtMs < settings.uxProgressUpdateThrottleMs;
  }

  private readProgressRelayCount(message: RelayCandidateMessage): number {
    const value = message.metadata?.[TELEGRAM_PROGRESS_COUNT_METADATA_KEY];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isInteger(parsed) && parsed >= 0) {
        return parsed;
      }
    }

    return 0;
  }

  private buildProgressEventAllowlist(
    settings: ActiveRunRuntimeSettings,
  ): Set<string> {
    const allowlist = new Set<string>();

    for (const eventType of settings.uxProgressEventsAllowlist) {
      const normalized = eventType.trim().toLowerCase();
      if (normalized.length > 0) {
        allowlist.add(normalized);
      }
    }

    return allowlist;
  }

  private async updateRelayMetadata(
    message: RelayCandidateMessage,
    additions: Record<string, unknown>,
  ): Promise<RelayCandidateMessage> {
    const metadata = this.deps.mergeMetadata(message.metadata, additions);
    const updated = await this.deps.chatMessageRepo.update(message.id, {
      metadata,
    });

    if (updated) {
      return updated;
    }

    return {
      ...message,
      metadata,
    };
  }

  private readIsoDateToMs(value: unknown): number | null {
    if (typeof value !== 'string') {
      return null;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

function buildAccumulatedStatusText(
  existing: string | null,
  newText: string,
): string {
  return existing ? `${existing}\n${newText}` : newText;
}
