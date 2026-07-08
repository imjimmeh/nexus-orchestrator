import { randomUUID } from 'node:crypto';
import type { WorkflowRunStatusV1 } from '@nexus/core';
import type {
  ChatActionQuestionAnswer,
  ChatActionWorkflowRunEvent,
} from '../chat-actions/chat-actions.types';
import {
  buildQuestionAnswersFromFreeText,
  extractPendingQuestions,
} from '../chat-actions/chat-run-questions.util';
import type { ForwardedQuestionAnswer } from './chat-messages.question-answer-bridge.types';

const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

interface PendingRunLink {
  run_id?: string | null;
  correlation_id?: string | null;
}

interface QuestionAnswerBridgeDeps {
  findPendingRunLinks: (chatId: string) => Promise<PendingRunLink[]>;
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
    answers: ChatActionQuestionAnswer[],
  ) => Promise<void>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStatusCorrelationId(status: WorkflowRunStatusV1): string | null {
  const metadata = status.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const record = metadata as {
    correlation_id?: unknown;
    correlationId?: unknown;
  };
  return (
    readNonEmptyString(record.correlation_id) ??
    readNonEmptyString(record.correlationId)
  );
}

async function tryForwardCandidate(params: {
  pendingMessage: PendingRunLink;
  message: string;
  correlationId: string | null;
  deps: QuestionAnswerBridgeDeps;
}): Promise<ForwardedQuestionAnswer | null> {
  const runId = readNonEmptyString(params.pendingMessage.run_id);
  if (!runId) {
    return null;
  }

  const correlationId =
    readNonEmptyString(params.pendingMessage.correlation_id) ??
    params.correlationId ??
    randomUUID();

  const status = await params.deps.getWorkflowRunStatus(runId, correlationId);
  const resolvedCorrelationId =
    readStatusCorrelationId(status) ?? correlationId;

  if (TERMINAL_RUN_STATUSES.has(status.status)) {
    return null;
  }

  const runEvents = await params.deps.getWorkflowRunEvents(
    runId,
    resolvedCorrelationId,
  );
  const pendingQuestions = extractPendingQuestions(runEvents);
  if (!pendingQuestions || pendingQuestions.length === 0) {
    return null;
  }

  const answers = buildQuestionAnswersFromFreeText(
    pendingQuestions,
    params.message,
  );
  await params.deps.submitWorkflowRunQuestionAnswers(
    runId,
    resolvedCorrelationId,
    answers,
  );

  return {
    runId,
    runStatus: status.status,
    correlationId: resolvedCorrelationId,
    answers,
  };
}

export async function forwardQuestionAnswerFromMessage(params: {
  chatId: string;
  message: string;
  correlationId: string | null;
  deps: QuestionAnswerBridgeDeps;
}): Promise<ForwardedQuestionAnswer | null> {
  const pendingMessages = await params.deps.findPendingRunLinks(params.chatId);
  if (pendingMessages.length === 0) {
    return null;
  }

  const candidates = [...pendingMessages].reverse();
  for (const pendingMessage of candidates) {
    const forwarded = await tryForwardCandidate({
      pendingMessage,
      message: params.message,
      correlationId: params.correlationId,
      deps: params.deps,
    });
    if (forwarded) {
      return forwarded;
    }
  }

  return null;
}
