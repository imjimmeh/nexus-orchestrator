import { QuestionAnswer, UserQuestion } from "@/lib/api/settings.types";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type { SessionChatMessage } from "./active-session.utils.types";
import {
  getQuestionsFromToolArgs,
  toUserQuestions,
} from "./active-session.question-utils";
import { asString, getToolName } from "./active-session.chat-helpers";

function readTurnStopReason(event: WorkflowTelemetryEvent): string | null {
  const output =
    event.payload.output && typeof event.payload.output === "object"
      ? (event.payload.output as { stopReason?: unknown })
      : null;
  return asString(output?.stopReason) ?? null;
}

export function buildUserQuestionsPosedMessage(
  event: WorkflowTelemetryEvent,
  id: string,
): SessionChatMessage | null {
  const questions = toUserQuestions(event.payload.questions);
  if (!questions) {
    return null;
  }

  const lines = questions.map((question, index) => {
    const optionsSuffix =
      question.options.length > 0 ? ` [${question.options.join(" / ")}]` : "";
    return `Q${index + 1}: ${question.question}${optionsSuffix}`;
  });

  return {
    id,
    role: "event",
    label: "Questions from Agent",
    content: lines.join("\n"),
    questions,
  };
}

export function buildUserQuestionAnswersMessage(
  event: WorkflowTelemetryEvent,
  id: string,
): SessionChatMessage | null {
  // Chat-session events nest answers under payload.metadata.answers;
  // workflow-run events have them directly at payload.answers.
  const metadata = event.payload.metadata;
  const rawAnswers =
    event.payload.answers ??
    (metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>).answers
      : undefined);
  if (!Array.isArray(rawAnswers) || rawAnswers.length === 0) {
    return null;
  }

  const lines = (rawAnswers as QuestionAnswer[]).map((answer) => {
    const parts: string[] = [];
    if (answer.selectedOption) {
      parts.push(`Selected: ${answer.selectedOption}`);
    }
    if (answer.freeTextAnswer) {
      parts.push(`Answer: ${answer.freeTextAnswer}`);
    }
    return `Q${answer.questionIndex + 1}: ${parts.join(" · ") || "(no answer)"}`;
  });

  return {
    id,
    role: "user",
    label: "Your Answers",
    content: lines.join("\n"),
  };
}

export function getPendingQuestions(
  events: WorkflowTelemetryEvent[],
): UserQuestion[] | null {
  type PendingQuestionsState = {
    lastQuestions: UserQuestion[] | null;
    pendingFromAskTool: boolean;
    pendingAskToolCallId: string | null;
  };

  const state: PendingQuestionsState = {
    lastQuestions: null,
    pendingFromAskTool: false,
    pendingAskToolCallId: null,
  };

  const clearPending = () => {
    state.lastQuestions = null;
    state.pendingFromAskTool = false;
    state.pendingAskToolCallId = null;
  };

  const handleQuestionsPosed = (event: WorkflowTelemetryEvent) => {
    const questions = toUserQuestions(event.payload.questions);
    if (!questions) {
      return;
    }

    state.lastQuestions = questions;
    state.pendingFromAskTool = false;
    state.pendingAskToolCallId = null;
  };

  const handleAskToolStart = (event: WorkflowTelemetryEvent) => {
    if (getToolName(event.payload) !== "ask_user_questions") {
      return;
    }

    const questions = getQuestionsFromToolArgs(event.payload);
    if (!questions) {
      return;
    }

    state.lastQuestions = questions;
    state.pendingFromAskTool = true;
    state.pendingAskToolCallId = asString(event.payload.toolCallId) ?? null;
  };

  const handleAskToolEnd = (event: WorkflowTelemetryEvent) => {
    if (!state.pendingFromAskTool) {
      return;
    }
    if (getToolName(event.payload) !== "ask_user_questions") {
      return;
    }

    const endToolCallId = asString(event.payload.toolCallId);
    if (
      state.pendingAskToolCallId &&
      endToolCallId &&
      state.pendingAskToolCallId !== endToolCallId
    ) {
      return;
    }
    if (event.payload.isError !== true) {
      return;
    }

    clearPending();
  };

  for (const event of events) {
    switch (event.event_type) {
      case "user_question_answers":
        clearPending();
        break;
      case "turn_end":
        if (readTurnStopReason(event) === "stop") {
          clearPending();
        }
        break;
      case "step_complete":
      case "session_completed":
      case "session_failed":
      case "session_cancelled":
        clearPending();
        break;
      case "user_questions_posed":
        handleQuestionsPosed(event);
        break;
      case "tool_execution_start":
        handleAskToolStart(event);
        break;
      case "tool_execution_end":
        handleAskToolEnd(event);
        break;
      default:
        break;
    }
  }

  return state.lastQuestions;
}
