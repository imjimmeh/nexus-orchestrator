import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChatToCoreActionService } from '../chat-actions/chat-to-core-action.service';
import { ChatMessageRepository } from '../database/repositories/chat-message.repository';
import { ChatSessionRepository } from '../database/repositories/chat-session.repository';
import { ChatMemoryLifecycleService } from '../memory/chat-memory-lifecycle.service';
import { isMemoryContextInjectionEnabled } from '../memory/chat-memory.config';
import {
  type ITelemetryGateway,
  TELEMETRY_GATEWAY,
} from '../../shared/interfaces/telemetry-gateway.interface';
import { AttachmentsService } from '../../attachments/attachments.service';
import {
  buildMemoryContextSafe,
  buildMemoryRetrievalMetadata,
  recordInboundMemorySafe,
  recordOutboundMemorySafe,
} from './chat-messages.memory-helpers';
import { TERMINAL_RUN_STATUSES } from './chat-messages.constants';
import type {
  AppendOutboundMessageInput,
  ChatEventHistoryItem,
  ChatQuestionAnswerInput,
  SendChatMessageOptions,
  SendChatMessageResult,
} from './chat-messages.types';
import {
  buildInboundMetadata,
  mapSendResult,
  mergeMessageMetadata,
} from './chat-messages.message-helpers';
import {
  findPendingQuestionRun,
  readChatActionCorrelationId,
  readChatActionRunId,
  requestActionRunLink,
  tryForwardAnswersViaWebSocket,
  tryForwardQuestionAnswerFromMessage,
  tryForwardTextAsAnswerViaWebSocket,
} from './chat-messages.run-linking-helpers';

@Injectable()
export class ChatMessagesService {
  private readonly logger = new Logger(ChatMessagesService.name);

  constructor(
    private readonly chatSessions: ChatSessionRepository,
    private readonly chatMessages: ChatMessageRepository,
    private readonly chatActions: ChatToCoreActionService,
    private readonly memoryLifecycle: ChatMemoryLifecycleService,
    @Inject(TELEMETRY_GATEWAY)
    private readonly telemetryGateway: ITelemetryGateway,
    private readonly attachments: AttachmentsService,
  ) {}

  async sendChatMessage(
    chatId: string,
    message: string,
    options: SendChatMessageOptions = {},
  ): Promise<SendChatMessageResult> {
    const session = await this.requireSession(chatId);
    const channel = this.resolveChannel(options.channel);
    const providerMessageId = options.providerMessageId ?? null;

    const existing = await this.findExistingProviderMessage(
      channel,
      providerMessageId,
    );
    if (existing) {
      return mapSendResult(existing);
    }

    const created = await this.createInboundMessage({
      chatId,
      channel,
      providerMessageId,
      message,
      options,
    });

    await this.linkAttachments(created.id, options.attachmentIds ?? []);

    await recordInboundMemorySafe({
      memoryLifecycle: this.memoryLifecycle,
      logger: this.logger,
      chatSessionId: chatId,
      profileId: session.agent_profile_id,
      sourceMessageId: created.id,
      content: message,
      correlationId: options.correlationId ?? null,
      channel,
      metadata: options.metadata ?? null,
    });

    const earlyForwardResult = await this.tryEarlyInboundForwarding({
      chatId,
      message,
      correlationId: options.correlationId ?? null,
      created,
    });
    if (earlyForwardResult) {
      return earlyForwardResult;
    }

    return this.linkMessageToWorkflowRun({
      chatId,
      message,
      options,
      channel,
      providerMessageId,
      session,
      created,
    });
  }

  private async linkMessageToWorkflowRun(params: {
    chatId: string;
    message: string;
    options: SendChatMessageOptions;
    channel: string;
    providerMessageId: string | null;
    session: {
      scope_id?: string | null;
      agent_profile_id: string;
      agent_profile_name: string;
      workflow_run_id?: string | null;
    };
    created: { id: string; metadata?: Record<string, unknown> | null };
  }): Promise<SendChatMessageResult> {
    const memoryContext = await buildMemoryContextSafe({
      memoryLifecycle: this.memoryLifecycle,
      logger: this.logger,
      chatSessionId: params.chatId,
      profileId: params.session.agent_profile_id,
      prompt: params.message,
      enabled: isMemoryContextInjectionEnabled(),
    });

    const runLink = await requestActionRunLink({
      chatId: params.chatId,
      message: params.message,
      options: params.options,
      channel: params.channel,
      providerMessageId: params.providerMessageId,
      session: params.session,
      createdMessageId: params.created.id,
      memoryContext,
      deps: {
        continueWorkflowRunWithMessage:
          this.chatActions.continueWorkflowRunWithMessage.bind(
            this.chatActions,
          ),
        requestAction: this.chatActions.requestAction.bind(this.chatActions),
        persistWorkflowRunId: this.persistWorkflowRunId.bind(this),
        markMessageFailed: async (messageId) => {
          await this.chatMessages.update(messageId, {
            run_status: 'FAILED',
          });
        },
      },
      logger: this.logger,
    });

    const updated = await this.chatMessages.update(params.created.id, {
      run_id: readChatActionRunId(runLink),
      run_status: runLink.runStatus,
      correlation_id: readChatActionCorrelationId(runLink),
      metadata: mergeMessageMetadata(params.created.metadata, {
        memory: buildMemoryRetrievalMetadata(memoryContext),
      }),
    });

    return mapSendResult(updated ?? params.created);
  }

  private async tryEarlyInboundForwarding(params: {
    chatId: string;
    message: string;
    correlationId: string | null;
    created: { id: string; metadata?: Record<string, unknown> | null };
  }): Promise<SendChatMessageResult | null> {
    const forwardedResult = await tryForwardQuestionAnswerFromMessage({
      chatId: params.chatId,
      message: params.message,
      correlationId: params.correlationId,
      createdMessageId: params.created.id,
      createdMetadata: params.created.metadata,
      deps: {
        findPendingRunLinks: this.chatMessages.findPendingRunLinks.bind(
          this.chatMessages,
        ),
        getWorkflowRunStatus: this.chatActions.getWorkflowRunStatus.bind(
          this.chatActions,
        ),
        getWorkflowRunEvents: this.chatActions.getWorkflowRunEvents.bind(
          this.chatActions,
        ),
        submitWorkflowRunQuestionAnswers:
          this.chatActions.submitWorkflowRunQuestionAnswers.bind(
            this.chatActions,
          ),
        updateMessage: this.chatMessages.update.bind(this.chatMessages),
      },
    });
    if (forwardedResult) {
      return forwardedResult;
    }

    return tryForwardTextAsAnswerViaWebSocket({
      chatId: params.chatId,
      message: params.message,
      created: params.created,
      deps: {
        hasActiveAgentSocket: this.telemetryGateway.hasActiveAgentSocket.bind(
          this.telemetryGateway,
        ),
        sendQuestionResponseCommand:
          this.telemetryGateway.sendQuestionResponseCommand.bind(
            this.telemetryGateway,
          ),
        updateMessage: this.chatMessages.update.bind(this.chatMessages),
      },
      logger: this.logger,
    });
  }

  async submitQuestionAnswers(
    chatId: string,
    answers: ChatQuestionAnswerInput[],
  ): Promise<{ acknowledged: true }> {
    await this.requireSession(chatId);

    const normalizedAnswers = answers.map((answer) => ({
      questionIndex: answer.questionIndex,
      selectedOption: answer.selectedOption ?? null,
      freeTextAnswer: answer.freeTextAnswer ?? null,
    }));

    const created = await this.chatMessages.create({
      chat_session_id: chatId,
      direction: 'inbound',
      sender: 'user',
      channel: 'api',
      event_type: 'user_question_answers',
      text: JSON.stringify(normalizedAnswers),
      metadata: { answers: normalizedAnswers },
    });

    const pendingRun = await findPendingQuestionRun({
      chatId,
      correlationId: null,
      deps: {
        findPendingRunLinks: this.chatMessages.findPendingRunLinks.bind(
          this.chatMessages,
        ),
        getWorkflowRunStatus: this.chatActions.getWorkflowRunStatus.bind(
          this.chatActions,
        ),
        getWorkflowRunEvents: this.chatActions.getWorkflowRunEvents.bind(
          this.chatActions,
        ),
      },
    });

    if (!pendingRun) {
      await tryForwardAnswersViaWebSocket({
        chatId,
        answers: normalizedAnswers,
        messageId: created.id,
        deps: {
          sendQuestionResponseCommand:
            this.telemetryGateway.sendQuestionResponseCommand.bind(
              this.telemetryGateway,
            ),
          updateMessage: this.chatMessages.update.bind(this.chatMessages),
        },
        logger: this.logger,
      });
      return { acknowledged: true };
    }

    await this.chatActions.submitWorkflowRunQuestionAnswers(
      pendingRun.runId,
      pendingRun.correlationId,
      normalizedAnswers,
    );
    await this.persistWorkflowRunId(chatId, pendingRun.runId);

    await this.chatMessages.update(created.id, {
      run_id: pendingRun.runId,
      run_status: pendingRun.runStatus,
      correlation_id: pendingRun.correlationId,
      metadata: mergeMessageMetadata(created.metadata, {
        answers: normalizedAnswers,
        questionAnswerForRunId: pendingRun.runId,
        questionAnswerForwardedAt: new Date().toISOString(),
      }),
    });

    return { acknowledged: true };
  }

  async appendOutboundMessage(
    params: AppendOutboundMessageInput,
  ): Promise<{ messageId: string }> {
    await this.requireSession(params.chatId);

    const created = await this.chatMessages.create({
      chat_session_id: params.chatId,
      direction: 'outbound',
      sender: 'assistant',
      channel: params.channel,
      provider_message_id: params.providerMessageId ?? null,
      event_type: 'assistant_message',
      text: params.text,
      metadata: params.metadata ?? null,
    });

    const profileId = await this.resolveProfileId(params.chatId);
    if (profileId) {
      await recordOutboundMemorySafe({
        memoryLifecycle: this.memoryLifecycle,
        logger: this.logger,
        chatSessionId: params.chatId,
        profileId,
        sourceMessageId: created.id,
        content: params.text,
        channel: params.channel,
        metadata: params.metadata ?? null,
      });
    }

    return { messageId: created.id };
  }

  async getEventHistory(chatId: string): Promise<ChatEventHistoryItem[]> {
    await this.requireSession(chatId);
    await this.syncPendingRunStatuses(chatId);

    const messages = await this.chatMessages.findBySessionId(chatId);
    return messages.map((message) => ({
      event_type: message.event_type,
      timestamp: message.created_at.toISOString(),
      payload: {
        chatSessionId: chatId,
        messageId: message.id,
        direction: message.direction,
        sender: message.sender,
        channel: message.channel,
        text: message.text,
        runId: message.run_id ?? null,
        runStatus: message.run_status ?? null,
        metadata: message.metadata ?? {},
      },
    }));
  }

  async syncPendingRunStatuses(chatId: string): Promise<void> {
    const pending = await this.chatMessages.findPendingRunLinks(chatId);

    for (const message of pending) {
      if (!message.run_id) {
        continue;
      }

      const correlationId = message.correlation_id ?? randomUUID();
      const status = await this.chatActions.getWorkflowRunStatus(
        message.run_id,
        correlationId,
      );

      if (
        TERMINAL_RUN_STATUSES.has(status.status) ||
        status.status !== message.run_status
      ) {
        await this.chatMessages.update(message.id, {
          run_status: status.status,
          correlation_id: status.metadata.correlation_id,
        });
      }
    }
  }

  private async requireSession(chatId: string) {
    const session = await this.chatSessions.findById(chatId);
    if (!session) {
      throw new NotFoundException(`Chat session '${chatId}' not found`);
    }
    return session;
  }

  private async findExistingProviderMessage(
    channel: string,
    providerMessageId: string | null,
  ) {
    if (!providerMessageId) {
      return null;
    }

    return this.chatMessages.findByProviderMessage({
      channel,
      providerMessageId,
    });
  }

  private resolveChannel(channel: string | undefined): string {
    return channel ?? 'api';
  }

  private async createInboundMessage(params: {
    chatId: string;
    channel: string;
    providerMessageId: string | null;
    message: string;
    options: SendChatMessageOptions;
  }) {
    return this.chatMessages.create({
      chat_session_id: params.chatId,
      direction: 'inbound',
      sender: 'user',
      channel: params.channel,
      provider_message_id: params.providerMessageId,
      correlation_id: params.options.correlationId ?? null,
      event_type: 'user_message',
      text: params.message,
      metadata: buildInboundMetadata(params.options.metadata),
    });
  }

  private async linkAttachments(
    messageId: string,
    attachmentIds: string[],
  ): Promise<void> {
    for (const attachmentId of attachmentIds) {
      try {
        await this.attachments.link(attachmentId, 'chat_message', messageId);
      } catch (error) {
        this.logger.warn(
          `Failed to link attachment ${attachmentId} to message ${messageId}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async persistWorkflowRunId(
    chatId: string,
    workflowRunId: string,
  ): Promise<void> {
    try {
      await this.chatSessions.update(chatId, {
        workflow_run_id: workflowRunId,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist workflow run linkage for chat ${chatId}: ${(error as Error).message}`,
      );
    }
  }

  private async resolveProfileId(chatId: string): Promise<string | null> {
    const session = await this.chatSessions.findById(chatId);
    return session?.agent_profile_id ?? null;
  }
}
