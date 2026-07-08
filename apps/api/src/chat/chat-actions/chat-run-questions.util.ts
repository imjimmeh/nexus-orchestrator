import type {
  ChatActionQuestionAnswer,
  ChatActionUserQuestion,
  ChatActionWorkflowRunEvent,
} from './chat-actions.types';

const TOOL_ASK_USER_QUESTIONS = 'ask_user_questions';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toQuestions(value: unknown): ChatActionUserQuestion[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const questions: ChatActionUserQuestion[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }

    const question = asString(record.question);
    if (!question) {
      continue;
    }

    const options = Array.isArray(record.options)
      ? record.options.filter(
          (option): option is string =>
            typeof option === 'string' && option.trim().length > 0,
        )
      : [];

    questions.push({ question, options });
  }

  return questions.length > 0 ? questions : null;
}

function readTurnStopReason(event: ChatActionWorkflowRunEvent): string | null {
  const payload = asRecord(event.payload);
  if (!payload) {
    return null;
  }

  const output = asRecord(payload.output);
  if (!output) {
    return null;
  }

  return asString(output.stopReason) ?? asString(output.stop_reason);
}

function getToolName(payload: Record<string, unknown>): string | null {
  return asString(payload.toolName) ?? asString(payload.tool_name);
}

function getQuestionsFromToolArgs(
  payload: Record<string, unknown>,
): ChatActionUserQuestion[] | null {
  const args = asRecord(payload.args);
  if (!args) {
    return null;
  }

  return toQuestions(args.questions);
}

interface PendingQuestionsState {
  pendingQuestions: ChatActionUserQuestion[] | null;
  pendingFromAskTool: boolean;
  pendingToolCallId: string | null;
}

function clearPending(state: PendingQuestionsState): void {
  state.pendingQuestions = null;
  state.pendingFromAskTool = false;
  state.pendingToolCallId = null;
}

function isTerminalSessionEvent(eventType: string): boolean {
  return (
    eventType === 'step_complete' ||
    eventType === 'session_completed' ||
    eventType === 'session_failed' ||
    eventType === 'session_cancelled'
  );
}

function handleQuestionsPosedEvent(
  state: PendingQuestionsState,
  event: ChatActionWorkflowRunEvent,
): void {
  const payload = asRecord(event.payload);
  const questions = payload ? toQuestions(payload.questions) : null;
  if (!questions) {
    return;
  }

  state.pendingQuestions = questions;
  state.pendingFromAskTool = false;
  state.pendingToolCallId = null;
}

function handleAskToolStartEvent(
  state: PendingQuestionsState,
  event: ChatActionWorkflowRunEvent,
): void {
  const payload = asRecord(event.payload);
  if (!payload || getToolName(payload) !== TOOL_ASK_USER_QUESTIONS) {
    return;
  }

  const questions = getQuestionsFromToolArgs(payload);
  if (!questions) {
    return;
  }

  state.pendingQuestions = questions;
  state.pendingFromAskTool = true;
  state.pendingToolCallId = asString(payload.toolCallId);
}

function handleAskToolEndEvent(
  state: PendingQuestionsState,
  event: ChatActionWorkflowRunEvent,
): void {
  if (!state.pendingFromAskTool) {
    return;
  }

  const payload = asRecord(event.payload);
  if (!payload || getToolName(payload) !== TOOL_ASK_USER_QUESTIONS) {
    return;
  }

  const endToolCallId = asString(payload.toolCallId);
  if (
    state.pendingToolCallId &&
    endToolCallId &&
    state.pendingToolCallId !== endToolCallId
  ) {
    return;
  }

  if (payload.isError === true) {
    clearPending(state);
  }
}

function applyEventToPendingState(
  state: PendingQuestionsState,
  event: ChatActionWorkflowRunEvent,
): void {
  if (event.event_type === 'user_question_answers') {
    clearPending(state);
    return;
  }

  if (event.event_type === 'turn_end' && readTurnStopReason(event) === 'stop') {
    clearPending(state);
    return;
  }

  if (isTerminalSessionEvent(event.event_type)) {
    clearPending(state);
    return;
  }

  if (event.event_type === 'user_questions_posed') {
    handleQuestionsPosedEvent(state, event);
    return;
  }

  if (event.event_type === 'tool_execution_start') {
    handleAskToolStartEvent(state, event);
    return;
  }

  if (event.event_type === 'tool_execution_end') {
    handleAskToolEndEvent(state, event);
  }
}

export function extractPendingQuestions(
  events: ChatActionWorkflowRunEvent[],
): ChatActionUserQuestion[] | null {
  const state: PendingQuestionsState = {
    pendingQuestions: null,
    pendingFromAskTool: false,
    pendingToolCallId: null,
  };

  for (const event of events) {
    applyEventToPendingState(state, event);
  }

  return state.pendingQuestions;
}

function matchSelectedOption(
  options: string[],
  message: string,
): string | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const option of options) {
    if (option.trim().toLowerCase() === normalized) {
      return option;
    }
  }

  return null;
}

export function buildQuestionAnswersFromFreeText(
  questions: ChatActionUserQuestion[],
  message: string,
): ChatActionQuestionAnswer[] {
  const responseText = message.trim();
  const firstQuestion = questions[0];
  const selectedOption = firstQuestion
    ? matchSelectedOption(firstQuestion.options ?? [], responseText)
    : null;

  return [
    {
      questionIndex: 0,
      selectedOption,
      freeTextAnswer: selectedOption
        ? null
        : responseText || '(empty response)',
    },
  ];
}

export function buildQuestionRelayText(
  questions: ChatActionUserQuestion[],
): string {
  const lines = ['I need your input to continue:'];

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const optionsSuffix =
      question.options && question.options.length > 0
        ? ` [${question.options.join(' / ')}]`
        : '';

    lines.push(`Q${index + 1}: ${question.question}${optionsSuffix}`);
  }

  lines.push('Reply with your answer.');
  return lines.join('\n');
}

export function buildQuestionRelayKey(
  questions: ChatActionUserQuestion[],
): string {
  return JSON.stringify(
    questions.map((question) => ({
      question: question.question,
      options: question.options,
    })),
  );
}
