import type { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import {
  getAgentStreamKey,
  getTelemetryText,
  isStreamEndTelemetryType,
  isTextStreamTelemetry,
  asString,
} from "./active-session.chat-helpers";
import {
  appendMessage,
  clearAgentStream,
  clearThoughtStream,
  resolveAgentLabel,
} from "./active-session.chat-builder";
import type { SessionChatBuildState } from "./active-session.chat-builder.types";

function handleThoughtTelemetry(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
  telemetryType: string,
  thoughtStreamType: "thinking" | "reasoning",
  hideThinking: boolean,
): void {
  if (hideThinking) {
    if (isStreamEndTelemetryType(telemetryType)) {
      clearThoughtStream(state);
    }
    return;
  }

  const thought = getTelemetryText(event);
  if (!thought) {
    if (isStreamEndTelemetryType(telemetryType)) {
      clearThoughtStream(state);
    }
    return;
  }

  clearAgentStream(state);
  const streamKey = `${thoughtStreamType}:${getAgentStreamKey(event)}`;
  if (state.activeThoughtStream?.streamKey === streamKey) {
    const current = state.messages[state.activeThoughtStream.messageIndex];
    if (current) {
      current.content += thought;
    }
  } else {
    appendMessage(state, {
      id,
      role: "event",
      label: "Thought",
      content: thought,
      timestamp: event.timestamp,
      category: "thought",
      collapsedByDefault: true,
    });
    state.activeThoughtStream = {
      messageIndex: state.messages.length - 1,
      streamKey,
    };
  }

  if (isStreamEndTelemetryType(telemetryType)) {
    clearThoughtStream(state);
  }
}

function getThoughtStreamType(
  telemetryType: string | null,
): "thinking" | "reasoning" | null {
  if (!telemetryType) {
    return null;
  }

  if (telemetryType.includes("thinking")) {
    return "thinking";
  }

  if (telemetryType.includes("reasoning")) {
    return "reasoning";
  }

  return null;
}

function appendAgentTextTelemetry(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
  text: string,
): void {
  const streamKey = getAgentStreamKey(event);
  if (state.activeAgentStream?.streamKey === streamKey) {
    const current = state.messages[state.activeAgentStream.messageIndex];
    if (current) {
      current.content += text;
    }
    return;
  }

  appendMessage(state, {
    id,
    role: "agent",
    label: resolveAgentLabel(event.payload),
    content: text,
    timestamp: event.timestamp,
    category: "agent",
  });
  state.activeAgentStream = {
    messageIndex: state.messages.length - 1,
    streamKey,
  };
}

export function handleAgentTelemetryMessage(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
  hideThinking: boolean,
): void {
  const telemetryType = asString(event.payload.type);
  const thoughtStreamType = getThoughtStreamType(telemetryType ?? null);

  if (thoughtStreamType && telemetryType) {
    handleThoughtTelemetry(
      state,
      event,
      id,
      telemetryType,
      thoughtStreamType,
      hideThinking,
    );
    return;
  }

  if (!isTextStreamTelemetry(telemetryType ?? undefined)) {
    return;
  }

  clearThoughtStream(state);

  const text = getTelemetryText(event);
  if (!text) {
    if (telemetryType === "text_end") {
      clearAgentStream(state);
    }
    return;
  }

  appendAgentTextTelemetry(state, event, id, text);

  if (telemetryType === "text_end") {
    clearAgentStream(state);
  }
}
