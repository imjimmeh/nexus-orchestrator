import { ChatSessionRetryMetadata } from "@/lib/api/chat-sessions.types";
import { QuestionAnswer, UserQuestion } from "@/lib/api/settings.types";

export function isTerminalStatus(status: string | undefined): boolean {
  return (
    status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"
  );
}

export function isRateLimitRetry(session: {
  executionState?: string;
  retryMetadata?: { reasonCode?: string } | null;
}): boolean {
  return (
    session.executionState === "retry_scheduled" &&
    session.retryMetadata?.reasonCode === "provider_rate_limit_429"
  );
}

export function formatRetryCountdown(
  nextRetryAt: string,
  now = new Date(),
): string {
  const diffMs = new Date(nextRetryAt).getTime() - now.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "any moment";
  const minutes = Math.ceil(diffMs / 60000);
  return minutes === 1 ? "1 min" : `${minutes} min`;
}

export function formatRetryTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function formatUsageLimit(
  usageLimit: ChatSessionRetryMetadata["usageLimit"],
): string | null {
  if (!usageLimit) {
    return null;
  }

  if (usageLimit.used === undefined || usageLimit.limit === undefined) {
    return null;
  }

  return `${usageLimit.used}/${usageLimit.limit}`;
}

function matchQuestionOption(
  question: UserQuestion,
  responseText: string,
): string | null {
  const normalized = responseText.trim().toLowerCase();
  return (
    question.options.find(
      (option) => option.trim().toLowerCase() === normalized,
    ) ?? null
  );
}

export function buildAnswerFromMessage(
  questions: UserQuestion[] | null,
  message: string,
): QuestionAnswer[] | null {
  const responseText = message.trim();
  const firstQuestion = questions?.[0];
  if (!firstQuestion || responseText.length === 0) {
    return null;
  }

  const selectedOption = matchQuestionOption(firstQuestion, responseText);
  return [
    {
      questionIndex: 0,
      selectedOption,
      freeTextAnswer: selectedOption ? null : responseText,
    },
  ];
}

export function resolvePaneTitle(
  isChatSession: boolean,
  chatDisplayName: string | undefined,
  workflowName: string | undefined,
  workflowRunId: string | undefined,
): string {
  if (isChatSession) {
    return chatDisplayName || "Chat";
  }

  if (workflowName) {
    return workflowName;
  }

  if (workflowRunId) {
    return `Run ${workflowRunId.slice(0, 8)}`;
  }

  return "Workflow Run";
}
