import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { WorkflowRunExecutionStatusV1 } from '@nexus/core';
import type { ChatOutboundRelay } from '../chat-outbound-relay.types';
import type { ChatChannelProvider } from '../chat-channel-provider.types';
import { ChatToCoreActionService } from '../../chat-actions/chat-to-core-action.service';
import { ChatMessagesService } from '../../chat-messages/chat-messages.service';
import { ChatMessageRepository } from '../../database/repositories/chat-message.repository';
import { ChatSessionRepository } from '../../database/repositories/chat-session.repository';
import { TelegramOutboundRelayActiveRunHelper } from './telegram-outbound-relay-active-run.helper';
import { tryEditTelegramStatusMessage } from './telegram-outbound-relay-status-edit.utils';
import { buildTelegramTerminalOutboundText } from './telegram-outbound-relay-terminal-text.utils';
import {
  DEFAULT_RELAY_BATCH_SIZE,
  type RelayCandidateMessage,
  TELEGRAM_OUTBOUND_RELAY_SOURCE,
  TERMINAL_RUN_STATUSES,
} from './telegram-outbound-relay.types';
import type { TelegramChannelRuntimeSettings } from './telegram-runtime-settings.types';
import { TelegramRuntimeSettingsService } from './telegram-runtime-settings.service';
import { TelegramSenderService } from './telegram-sender.service';

@Injectable()
export class TelegramOutboundRelayService
  implements OnModuleInit, OnModuleDestroy, ChatOutboundRelay
{
  /**
   * Curated `ChatChannelProvider` discriminant for this relay. Matches the
   * literal that the runtime `channel` column on outbound messages is
   * tagged with (see `telegram-sender.service.ts`), so the
   * `CHAT_OUTBOUND_RELAYS` map in `ChannelAdaptersModule` can be keyed by
   * the same string callers already use to identify the channel. The
   * explicit `ChatChannelProvider` annotation keeps the field narrow while
   * honouring the `(string & {})` open extension in the curated
   * discriminant — using `satisfies` here would only validate the literal
   * but leave the field's declared type widened to `string`, defeating
   * the type check at the `Map.set` call site in the module factory.
   */
  readonly provider: ChatChannelProvider = 'telegram';
  private readonly logger = new Logger(TelegramOutboundRelayService.name);

  private isRunning = false;
  private waitHandle: NodeJS.Timeout | null = null;
  private isPolling = false;
  private missingTokenWarned = false;
  private readonly activeRunHelper: TelegramOutboundRelayActiveRunHelper;

  constructor(
    private readonly settings: TelegramRuntimeSettingsService,
    private readonly chatActions: ChatToCoreActionService,
    private readonly chatMessageRepo: ChatMessageRepository,
    private readonly chatSessionRepo: ChatSessionRepository,
    private readonly chatMessages: ChatMessagesService,
    private readonly telegramSender: TelegramSenderService,
  ) {
    this.activeRunHelper = new TelegramOutboundRelayActiveRunHelper({
      chatActions: this.chatActions,
      chatMessageRepo: this.chatMessageRepo,
      chatMessages: this.chatMessages,
      telegramSender: this.telegramSender,
      logger: this.logger,
      resolveExternalThreadId: (message) =>
        this.resolveExternalThreadId(message),
      mergeMetadata: (metadata, additions) =>
        this.mergeMetadata(metadata, additions),
      readNonEmptyString: (value) => this.readNonEmptyString(value),
    });
  }

  onModuleInit(): void {
    this.isRunning = true;
    this.logger.log('Telegram outbound relay supervisor started');
    void this.pollLoop();
  }

  onModuleDestroy(): void {
    this.isRunning = false;
    if (this.waitHandle) {
      clearTimeout(this.waitHandle);
      this.waitHandle = null;
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      const runtimeSettings = await this.settings.getSettings();
      await this.activeRunHelper.syncTelegramCommandMenu(runtimeSettings);

      if (!runtimeSettings.outboundRelayEnabled) {
        await this.wait(runtimeSettings.outboundRelayIntervalMs);
        continue;
      }

      if (!runtimeSettings.botToken) {
        if (!this.missingTokenWarned) {
          this.logger.warn(
            'Telegram outbound relay is enabled, but bot token is not configured',
          );
          this.missingTokenWarned = true;
        }
        await this.wait(runtimeSettings.outboundRelayIntervalMs);
        continue;
      }

      this.missingTokenWarned = false;
      await this.pollOnce(
        runtimeSettings.outboundRelayBatchSize,
        runtimeSettings,
      );
      await this.wait(runtimeSettings.outboundRelayIntervalMs);
    }
  }

  async pollOnce(
    batchSize = DEFAULT_RELAY_BATCH_SIZE,
    runtimeSettings?: TelegramChannelRuntimeSettings,
  ): Promise<void> {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    try {
      const settings = runtimeSettings ?? (await this.settings.getSettings());
      await this.processPendingRelayCandidates(batchSize, settings);
    } catch (error) {
      this.logger.warn(
        `Telegram outbound relay iteration failed: ${(error as Error).message}`,
      );
    } finally {
      this.isPolling = false;
    }
  }

  private async processPendingRelayCandidates(
    batchSize: number,
    runtimeSettings: TelegramChannelRuntimeSettings,
  ): Promise<void> {
    const candidates = await this.chatMessageRepo.findPendingRelayCandidates(
      this.provider,
      batchSize,
    );

    for (const candidate of candidates) {
      try {
        await this.processCandidate(candidate, runtimeSettings);
      } catch (error) {
        this.logger.warn(
          `Failed to process Telegram relay candidate ${candidate.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async processCandidate(
    candidate: RelayCandidateMessage,
    runtimeSettings: TelegramChannelRuntimeSettings,
  ): Promise<void> {
    if (!candidate.run_id) {
      return;
    }

    const correlationId = candidate.correlation_id ?? randomUUID();
    const status = await this.chatActions.getWorkflowRunStatus(
      candidate.run_id,
      correlationId,
    );
    const resolvedCorrelationId =
      this.readNonEmptyString(status.metadata.correlation_id) ?? correlationId;
    const workingMessage = await this.syncRunStatus(
      candidate,
      status.status,
      resolvedCorrelationId,
    );

    if (!TERMINAL_RUN_STATUSES.has(status.status)) {
      const waitingForInput = await this.activeRunHelper.relayPendingQuestions({
        message: workingMessage,
        runId: candidate.run_id,
        correlationId: resolvedCorrelationId,
      });

      if (waitingForInput) {
        return;
      }

      const progressMessage =
        await this.activeRunHelper.relayProgressStatusUpdate({
          message: workingMessage,
          runId: candidate.run_id,
          correlationId: resolvedCorrelationId,
          settings: runtimeSettings,
        });
      await this.activeRunHelper.relayTypingHeartbeat({
        message: progressMessage,
        settings: runtimeSettings,
      });
      return;
    }

    await this.relayTerminalCandidate({
      message: workingMessage,
      runId: candidate.run_id,
      terminalStatus: status.status,
      correlationId: resolvedCorrelationId,
      settings: runtimeSettings,
    });
  }

  private async syncRunStatus(
    message: RelayCandidateMessage,
    status: WorkflowRunExecutionStatusV1,
    correlationId: string,
  ): Promise<RelayCandidateMessage> {
    if (
      message.run_status === status &&
      message.correlation_id === correlationId
    ) {
      return message;
    }
    const updated = await this.chatMessageRepo.update(message.id, {
      run_status: status,
      correlation_id: correlationId,
    });
    return updated ?? message;
  }

  private async relayTerminalCandidate(params: {
    message: RelayCandidateMessage;
    runId: string;
    terminalStatus: WorkflowRunExecutionStatusV1;
    correlationId: string;
    settings: TelegramChannelRuntimeSettings;
  }): Promise<void> {
    const existingRelay =
      await this.chatMessageRepo.findTelegramRelayOutboundByInboundMessageId(
        params.message.id,
      );
    if (existingRelay) {
      await this.markRelaySent(params.message, {
        terminalStatus: params.terminalStatus,
        outboundMessageId: existingRelay.id,
        providerMessageId: existingRelay.provider_message_id ?? null,
        externalThreadId: this.resolveExistingExternalThreadId(
          existingRelay.metadata,
        ),
      });
      return;
    }
    const externalThreadId = await this.resolveExternalThreadId(params.message);
    if (!externalThreadId) {
      await this.markRelaySkipped(
        params.message,
        params.terminalStatus,
        'missing_external_thread_id',
      );
      return;
    }
    const runDetails =
      params.terminalStatus === 'COMPLETED'
        ? await this.chatActions.getWorkflowRunDetails(
            params.runId,
            params.correlationId,
          )
        : null;
    const text = buildTelegramTerminalOutboundText({
      status: params.terminalStatus,
      settings: params.settings,
      runDetails,
    });
    if (!text) {
      await this.markRelaySkipped(
        params.message,
        params.terminalStatus,
        'empty_outbound_text',
      );
      return;
    }
    const statusEditResult = await tryEditTelegramStatusMessage({
      metadata: params.message.metadata,
      externalThreadId,
      text,
      telegramSender: this.telegramSender,
      warn: (message) => {
        this.logger.warn(message);
      },
    });
    if (statusEditResult.edited) {
      await this.chatMessageRepo.update(statusEditResult.statusMessageId, {
        text,
      });
      await this.markRelaySent(params.message, {
        terminalStatus: params.terminalStatus,
        outboundMessageId: statusEditResult.statusMessageId,
        providerMessageId: statusEditResult.statusProviderMessageId,
        externalThreadId,
      });
      return;
    }
    await this.sendRelayMessage({
      message: params.message,
      runId: params.runId,
      terminalStatus: params.terminalStatus,
      externalThreadId,
      text,
    });
  }

  private async sendRelayMessage(params: {
    message: RelayCandidateMessage;
    runId: string;
    terminalStatus: WorkflowRunExecutionStatusV1;
    externalThreadId: string;
    text: string;
  }): Promise<void> {
    const sendResult = await this.telegramSender.sendMessage({
      channel: 'telegram',
      externalThreadId: params.externalThreadId,
      text: params.text,
    });

    const outbound = await this.chatMessages.appendOutboundMessage({
      chatId: params.message.chat_session_id,
      text: params.text,
      channel: 'telegram',
      providerMessageId: sendResult.providerMessageId,
      metadata: {
        runId: params.runId,
        terminalStatus: params.terminalStatus,
        relayInboundMessageId: params.message.id,
        relaySource: TELEGRAM_OUTBOUND_RELAY_SOURCE,
      },
    });

    await this.markRelaySent(params.message, {
      terminalStatus: params.terminalStatus,
      outboundMessageId: outbound.messageId,
      providerMessageId: sendResult.providerMessageId,
      externalThreadId: params.externalThreadId,
    });
  }

  private async resolveExternalThreadId(message: {
    chat_session_id: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<string | null> {
    const metadataThreadId = this.readNonEmptyString(
      message.metadata?.externalThreadId,
    );
    if (metadataThreadId) {
      return metadataThreadId;
    }

    const session = await this.chatSessionRepo.findById(
      message.chat_session_id,
    );
    const displayName = this.readNonEmptyString(session?.display_name);
    if (!displayName) {
      return null;
    }
    if (!displayName.startsWith('telegram:')) {
      return null;
    }

    const threadId = displayName.slice('telegram:'.length).trim();
    return threadId.length > 0 ? threadId : null;
  }

  private async markRelaySent(
    message: { id: string; metadata?: Record<string, unknown> | null },
    params: {
      terminalStatus: WorkflowRunExecutionStatusV1;
      outboundMessageId: string;
      providerMessageId: string | null;
      externalThreadId: string | null;
    },
  ): Promise<void> {
    await this.chatMessageRepo.update(message.id, {
      metadata: this.mergeMetadata(message.metadata, {
        telegramRelaySentAt: new Date().toISOString(),
        telegramRelayStatus: params.terminalStatus,
        telegramRelayOutboundMessageId: params.outboundMessageId,
        telegramRelayProviderMessageId: params.providerMessageId,
        telegramRelayExternalThreadId: params.externalThreadId,
      }),
    });
  }

  private async markRelaySkipped(
    message: { id: string; metadata?: Record<string, unknown> | null },
    status: WorkflowRunExecutionStatusV1,
    reason: string,
  ): Promise<void> {
    await this.chatMessageRepo.update(message.id, {
      metadata: this.mergeMetadata(message.metadata, {
        telegramRelaySkippedAt: new Date().toISOString(),
        telegramRelayStatus: status,
        telegramRelaySkipReason: reason,
      }),
    });
  }

  private resolveExistingExternalThreadId(
    metadata: Record<string, unknown> | null | undefined,
  ): string | null {
    return this.readNonEmptyString(
      metadata?.telegramRelayExternalThreadId ??
        metadata?.relayExternalThreadId,
    );
  }

  private mergeMetadata(
    metadata: Record<string, unknown> | null | undefined,
    additions: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!metadata) {
      return { ...additions };
    }

    return {
      ...metadata,
      ...additions,
    };
  }

  private async wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.waitHandle = setTimeout(() => {
        this.waitHandle = null;
        resolve();
      }, ms);
    });
  }
  private readNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
