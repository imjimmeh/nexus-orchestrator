import type { UserQuestion } from "@/lib/api/settings.types";
import type { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { getToolName, asString } from "./active-session.chat-helpers";
import { getQuestionsFromToolArgs } from "./active-session.question-utils";
import type { SessionChatMessage } from "./active-session.utils.types";
import {
  appendMessage,
  appendQuestionMessage,
  clearAllStreams,
} from "./active-session.chat-builder";
import type { SessionChatBuildState } from "./active-session.chat-builder.types";
import {
  summarizeToolCall,
  type ToolStatus,
} from "@/components/chat/tools/summarize-tool-call";
import { extractErrorText } from "@/components/chat/tools/extract-error-text";

function getToolMessageKey(event: WorkflowTelemetryEvent): string {
  const toolCallId = asString(event.payload.toolCallId);
  if (toolCallId) {
    return `tool-call:${toolCallId}`;
  }

  const callId = asString(event.payload.callId);
  if (callId) {
    return `call-id:${callId}`;
  }

  const toolName = getToolName(event.payload);
  const stepId = asString(event.payload.stepId) ?? "unknown-step";
  return `fallback:${stepId}:${toolName}`;
}

function formatQuestionContent(questions: UserQuestion[]): string {
  return questions
    .map((question, index) => {
      const optionsSuffix =
        question.options.length > 0 ? ` [${question.options.join(" / ")}]` : "";
      return `Q${index + 1}: ${question.question}${optionsSuffix}`;
    })
    .join("\n");
}

export function handleToolEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  const toolName = getToolName(event.payload);
  if (
    event.event_type === "tool_execution_start" &&
    toolName === "ask_user_questions"
  ) {
    const questions = getQuestionsFromToolArgs(event.payload);
    if (questions) {
      appendQuestionMessage(state, {
        id,
        role: "event",
        label: "Questions from Agent",
        content: formatQuestionContent(questions),
        timestamp: event.timestamp,
        category: "question",
        questions,
      });
      return;
    }
  }

  const toolKey = getToolMessageKey(event);
  const status = statusFromEventType(event.event_type);
  const state_ = computeToolState(event, toolName, status);
  const existingMessageIndex = state.activeToolMessageByKey.get(toolKey);
  if (existingMessageIndex !== undefined) {
    updateExistingToolMessage(
      state,
      existingMessageIndex,
      event,
      status,
      toolKey,
      state_,
    );
    return;
  }

  const callId = (asString(event.payload.toolCallId) ??
    asString(event.payload.callId) ??
    toolKey) as string;
  appendMessage(state, {
    id,
    role: "agent",
    label: "Tool",
    content: state_.summary,
    timestamp: event.timestamp,
    category: "tool",
    collapsedByDefault: status !== "finished",
    metadata: {
      type: "tool_call",
      toolName,
      callId,
      status,
      summary: state_.summary,
      argsObj: state_.argsObj,
      partialResults: [],
      resultObj: state_.resultObj,
      isError: state_.isError,
      errorText: state_.errorText,
      startedAt: Date.now(),
    },
  });

  if (status !== "finished") {
    state.activeToolMessageByKey.set(toolKey, state.messages.length - 1);
  }
}

interface ComputedToolState {
  isError: boolean;
  argsObj: unknown;
  resultObj: unknown;
  errorText: string | undefined;
  summary: string;
}

function computeToolState(
  event: WorkflowTelemetryEvent,
  toolName: string,
  status: ToolStatus,
): ComputedToolState {
  const isError =
    event.event_type === "tool_execution_end" && event.payload.isError === true;
  const argsObj =
    status === "started" && event.payload.args !== undefined
      ? event.payload.args
      : undefined;
  const resultObj =
    status === "finished" && event.payload.result !== undefined
      ? event.payload.result
      : undefined;
  const errorText = isError
    ? extractErrorText(event.payload.result)
    : undefined;
  const summary = summarizeToolCall(
    toolName,
    event.payload.args ?? event.payload.result,
    status,
    isError,
  );
  return { isError, argsObj, resultObj, errorText, summary };
}

function updateExistingToolMessage(
  state: SessionChatBuildState,
  messageIndex: number,
  event: WorkflowTelemetryEvent,
  status: ToolStatus,
  toolKey: string,
  toolState: ComputedToolState,
): void {
  const current = state.messages[messageIndex];
  if (!current) return;

  const meta = current.metadata as
    | Extract<SessionChatMessage["metadata"], { type: "tool_call" }>
    | undefined;
  if (meta && meta.type === "tool_call") {
    if (status === "updated" && event.payload.partialResult !== undefined) {
      meta.partialResults.push(event.payload.partialResult);
    }
    meta.status = status;
    if (toolState.argsObj !== undefined) meta.argsObj = toolState.argsObj;
    if (toolState.resultObj !== undefined) meta.resultObj = toolState.resultObj;
    meta.isError = toolState.isError;
    if (toolState.errorText !== undefined) meta.errorText = toolState.errorText;
    meta.summary = toolState.summary;
    if (status === "finished") {
      meta.endedAt = Date.now();
      meta.durationMs = meta.endedAt - meta.startedAt;
    }
  }

  current.content = toolState.summary;
  current.timestamp = event.timestamp;
  current.category = "tool";
  current.collapsedByDefault = status !== "finished";
  if (status === "finished") {
    state.activeToolMessageByKey.delete(toolKey);
  }
}

function statusFromEventType(
  eventType: WorkflowTelemetryEvent["event_type"],
): ToolStatus {
  if (eventType === "tool_execution_start") return "started";
  if (eventType === "tool_execution_update") return "updated";
  return "finished";
}
