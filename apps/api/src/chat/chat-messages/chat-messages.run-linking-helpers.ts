import { randomUUID } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import { extractPendingQuestions } from '../chat-actions/chat-run-questions.util';
import { TERMINAL_RUN_STATUSES } from './chat-messages.constants';
import {
  mapSendResult,
  mergeMessageMetadata,
} from './chat-messages.message-helpers';
import type {
  SendChatMessageResult,
  SendChatMessageOptions,
} from './chat-messages.types';
import type { ChatMemoryContextResult } from '../memory/chat-memory.types';
import type {
  ChatActionRunLink,
  ChatActionWorkflowRunEvent,
} from '../chat-actions/chat-actions.types';
import type { WorkflowRunStatusV1 } from '@nexus/core';
import { toActionMemoryContext } from './chat-messages.memory-helpers';
import { forwardQuestionAnswerFromMessage } from './chat-messages.question-answer-bridge';

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readWorkflowStatusCorrelationId(status: {
  metadata?: { correlation_id?: unknown; correlationId?: unknown } | null;
}): string | null {
  return (
    readNonEmptyString(status.metadata?.correlation_id) ??
    readNonEmptyString(status.metadata?.correlationId)
  );
}

export async function findPendingQuestionRun(params: {
  chatId: string;
  correlationId: string | null;
  deps: {
    findPendingRunLinks: (
      chatId: string,
    ) => Promise<
      Array<{ run_id?: string | null; correlation_id?: string | null }>
    >;
    getWorkflowRunStatus: (
      runId: string,
      correlationId: string,
    ) => Promise<{
      status: string;
      metadata: { correlation_id?: string | null };
    }>;
    getWorkflowRunEvents: (
      runId: string,
      correlationId: string,
    ) => Promise<ChatActionWorkflowRunEvent[]>;
  };
}): Promise<{
  runId: string;
  runStatus: string;
  correlationId: string;
} | null> {
  const pendingMessages = await params.deps.findPendingRunLinks(params.chatId);
  if (pendingMessages.length === 0) {
    return null;
  }

  const candidates = [...pendingMessages].reverse();
  for (const candidate of candidates) {
    if (!candidate.run_id) {
      continue;
    }

    const fallbackCorrelationId =
      readNonEmptyString(candidate.correlation_id) ??
      params.correlationId ??
      randomUUID();
    const status = await params.deps.getWorkflowRunStatus(
      candidate.run_id,
      fallbackCorrelationId,
    );
    const resolvedCorrelationId =
      readWorkflowStatusCorrelationId(status) ?? fallbackCorrelationId;

    if (TERMINAL_RUN_STATUSES.has(status.status)) {
      continue;
    }

    const events = await params.deps.getWorkflowRunEvents(
      candidate.run_id,
      resolvedCorrelationId,
    );
    const pendingQuestions = extractPendingQuestions(events);
    if (!pendingQuestions || pendingQuestions.length === 0) {
      continue;
    }

    return {
      runId: candidate.run_id,
      runStatus: status.status,
      correlationId: resolvedCorrelationId,
    };
  }

  return null;
}

export async function tryForwardQuestionAnswerFromMessage(params: {
  chatId: string;
  message: string;
  correlationId: string | null;
  createdMessageId: string;
  createdMetadata: Record<string, unknown> | null | undefined;
  deps: {
    findPendingRunLinks: (
      chatId: string,
    ) => Promise<
      Array<{ run_id?: string | null; correlation_id?: string | null }>
    >;
    getWorkflowRunStatus: (
      runId: string,
      correlationId: string,
    ) => Promise<WorkflowRunStatusV1>;
    getWorkflowRunEvents: (
      runId: string,
      correlationId: string,
    ) => Promise<ChatActionWorkflowRunEvent[]>;
    submitWorkflowRunQuestionAnswers: (
      runId: string,
      correlationId: string,
      answers: {
        questionIndex: number;
        selectedOption: string | null;
        freeTextAnswer: string | null;
      }[],
    ) => Promise<void>;
    updateMessage: (
      messageId: string,
      values: {
        event_type: 'user_question_answers';
        run_id: string;
        run_status: string;
        correlation_id: string;
        metadata: Record<string, unknown> | null;
      },
    ) => Promise<{
      id: string;
      run_id?: string | null;
      run_status?: string | null;
    } | null>;
  };
}): Promise<SendChatMessageResult | null> {
  const forwardedAnswer = await forwardQuestionAnswerFromMessage({
    chatId: params.chatId,
    message: params.message,
    correlationId: params.correlationId,
    deps: {
      findPendingRunLinks: params.deps.findPendingRunLinks,
      getWorkflowRunStatus: params.deps.getWorkflowRunStatus,
      getWorkflowRunEvents: params.deps.getWorkflowRunEvents,
      submitWorkflowRunQuestionAnswers:
        params.deps.submitWorkflowRunQuestionAnswers,
    },
  });
  if (!forwardedAnswer) {
    return null;
  }

  const updated = await params.deps.updateMessage(
    params.createdMessageId,
    buildForwardedAnswerUpdate(params.createdMetadata, forwardedAnswer),
  );
  if (updated) {
    return mapSendResult(updated);
  }

  return {
    acknowledged: true,
    messageId: params.createdMessageId,
    runId: forwardedAnswer.runId,
    runStatus: forwardedAnswer.runStatus,
  };
}

function buildForwardedAnswerUpdate(
  createdMetadata: Record<string, unknown> | null | undefined,
  forwardedAnswer: {
    runId: string;
    runStatus: string;
    correlationId: string;
    answers: {
      questionIndex: number;
      selectedOption: string | null;
      freeTextAnswer: string | null;
    }[];
  },
): {
  event_type: 'user_question_answers';
  run_id: string;
  run_status: string;
  correlation_id: string;
  metadata: Record<string, unknown> | null;
} {
  return {
    event_type: 'user_question_answers',
    run_id: forwardedAnswer.runId,
    run_status: forwardedAnswer.runStatus,
    correlation_id: forwardedAnswer.correlationId,
    metadata: mergeMessageMetadata(createdMetadata, {
      answers: forwardedAnswer.answers,
      questionAnswerForRunId: forwardedAnswer.runId,
      questionAnswerForwardedAt: new Date().toISOString(),
    }),
  };
}

export async function tryForwardAnswersViaWebSocket(params: {
  chatId: string;
  answers: {
    questionIndex: number;
    selectedOption: string | null;
    freeTextAnswer: string | null;
  }[];
  messageId: string;
  deps: {
    sendQuestionResponseCommand: (
      scopeId: string,
      runId: string,
      answers: {
        questionIndex: number;
        selectedOption: string | null;
        freeTextAnswer: string | null;
      }[],
    ) => Promise<void>;
    updateMessage: (
      messageId: string,
      values: { metadata: Record<string, unknown> },
    ) => Promise<unknown>;
  };
  logger: Logger;
}): Promise<void> {
  try {
    await params.deps.sendQuestionResponseCommand(
      params.chatId,
      params.chatId,
      params.answers,
    );
    await params.deps.updateMessage(params.messageId, {
      metadata: {
        answers: params.answers,
        questionAnswerForwardedViaChatSocket: true,
        questionAnswerForwardedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    params.logger.warn(
      `Failed to forward question answers via WebSocket for chat ${params.chatId}: ${(error as Error).message}`,
    );
  }
}

export async function tryForwardTextAsAnswerViaWebSocket(params: {
  chatId: string;
  message: string;
  created: { id: string; metadata?: Record<string, unknown> | null };
  deps: {
    hasActiveAgentSocket: (scopeId: string, runId: string) => boolean;
    sendQuestionResponseCommand: (
      scopeId: string,
      runId: string,
      answers: {
        questionIndex: number;
        selectedOption: string | null;
        freeTextAnswer: string | null;
      }[],
    ) => Promise<void>;
    updateMessage: (
      messageId: string,
      values: {
        event_type: 'user_question_answers';
        metadata: Record<string, unknown> | null;
      },
    ) => Promise<{
      id: string;
      run_id?: string | null;
      run_status?: string | null;
    } | null>;
  };
  logger: Logger;
}): Promise<SendChatMessageResult | null> {
  if (!params.deps.hasActiveAgentSocket(params.chatId, params.chatId)) {
    return null;
  }

  try {
    const answers = [
      {
        questionIndex: 0,
        selectedOption: null,
        freeTextAnswer: params.message,
      },
    ];
    await params.deps.sendQuestionResponseCommand(
      params.chatId,
      params.chatId,
      answers,
    );

    const updated = await params.deps.updateMessage(params.created.id, {
      event_type: 'user_question_answers',
      metadata: mergeMessageMetadata(params.created.metadata ?? null, {
        answers,
        questionAnswerForwardedViaChatSocket: true,
        questionAnswerForwardedAt: new Date().toISOString(),
      }),
    });
    return mapSendResult(updated ?? params.created);
  } catch (error) {
    params.logger.warn(
      `Failed to forward text as answer via WebSocket for chat ${params.chatId}: ${(error as Error).message}`,
    );
    return null;
  }
}

export async function requestActionRunLink(params: {
  chatId: string;
  message: string;
  options: SendChatMessageOptions;
  channel: string;
  providerMessageId: string | null;
  createdMessageId: string;
  session: {
    scope_id?: string | null;
    agent_profile_name: string;
    workflow_run_id?: string | null;
  };
  memoryContext: ChatMemoryContextResult | null;
  deps: {
    continueWorkflowRunWithMessage: (input: {
      runId: string;
      message: string;
      correlationId: string | null;
    }) => Promise<ChatActionRunLink>;
    requestAction: (input: {
      chatSessionId: string;
      messageId: string;
      message: string;
      channel: string;
      scopeId: string | null;
      agentProfileName: string;
      externalUserId: string | null;
      requestedBy: string | null;
      idempotencyKey: string | null;
      memoryContext: ReturnType<typeof toActionMemoryContext>;
    }) => Promise<ChatActionRunLink>;
    persistWorkflowRunId: (
      chatId: string,
      workflowRunId: string,
    ) => Promise<void>;
    markMessageFailed: (messageId: string) => Promise<void>;
  };
  logger: Logger;
}): Promise<ChatActionRunLink> {
  const existingWorkflowRunId =
    typeof params.session.workflow_run_id === 'string'
      ? params.session.workflow_run_id.trim()
      : '';
  if (existingWorkflowRunId) {
    try {
      const continued = await params.deps.continueWorkflowRunWithMessage({
        runId: existingWorkflowRunId,
        message: params.message,
        correlationId: params.options.correlationId ?? null,
      });
      await params.deps.persistWorkflowRunId(
        params.chatId,
        readChatActionRunId(continued),
      );
      return continued;
    } catch (error) {
      params.logger.warn(
        `Failed to continue workflow run ${existingWorkflowRunId} for chat ${params.chatId}: ${(error as Error).message}; creating a new run`,
      );
    }
  }

  try {
    const runLink = await params.deps.requestAction({
      chatSessionId: params.chatId,
      messageId: params.createdMessageId,
      message: params.message,
      channel: params.channel,
      scopeId: params.session.scope_id ?? null,
      agentProfileName: params.session.agent_profile_name,
      externalUserId: params.options.externalUserId ?? null,
      requestedBy: params.options.requestedBy ?? null,
      idempotencyKey: params.providerMessageId
        ? `${params.channel}:${params.providerMessageId}`
        : null,
      memoryContext: toActionMemoryContext(params.memoryContext),
    });
    await params.deps.persistWorkflowRunId(
      params.chatId,
      readChatActionRunId(runLink),
    );
    return runLink;
  } catch (error) {
    await params.deps.markMessageFailed(params.createdMessageId);
    throw error;
  }
}

export function readChatActionRunId(runLink: ChatActionRunLink): string {
  const runId = runLink.runId ?? runLink.run_id;
  if (!runId) {
    throw new Error('Chat action run link is missing run id');
  }

  return runId;
}

export function readChatActionCorrelationId(
  runLink: ChatActionRunLink,
): string | null {
  return runLink.correlation_id ?? runLink.correlationId ?? null;
}
