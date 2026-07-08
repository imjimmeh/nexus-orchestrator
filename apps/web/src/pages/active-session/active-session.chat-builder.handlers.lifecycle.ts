import type { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import {
  asString,
  getOrchestrationSkipMessage,
  getTurnEndResponse,
} from "./active-session.chat-helpers";
import {
  buildUserQuestionAnswersMessage,
  buildUserQuestionsPosedMessage,
} from "./active-session.chat-builder.questions";
import { formatLifecycleEvent } from "./active-session.chat-lifecycle";
import {
  appendMessage,
  appendQuestionMessage,
  clearAllStreams,
  resolveAgentLabel,
} from "./active-session.chat-builder";
import type { SessionChatBuildState } from "./active-session.chat-builder.types";

export function handleUserMessage(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  const content = asString(event.payload.message);
  if (!content) {
    return;
  }

  appendMessage(state, {
    id,
    role: "user",
    content,
    timestamp: event.timestamp,
    category: "user",
  });
}

export function handleWorkflowControlEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  appendMessage(state, {
    id,
    role: "event",
    label: "System",
    content:
      asString(event.payload.action)?.toUpperCase() ||
      JSON.stringify(event.payload),
    timestamp: event.timestamp,
    category: "system",
  });
}

export function handleLifecycleEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  const formatted = formatLifecycleEvent(event);
  if (!formatted) {
    return;
  }

  clearAllStreams(state);
  appendMessage(state, {
    id,
    role: "event",
    label: formatted.label,
    content: formatted.content,
    timestamp: event.timestamp,
    category: formatted.label === "Container" ? "container" : "system",
  });
}

export function handleAgentPromptSentEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  const message = asString(event.payload.message);
  if (!message) {
    return;
  }

  appendMessage(state, {
    id,
    role: "user",
    label: "You",
    content: message,
    timestamp: event.timestamp,
    category: "user",
  });
}

export function handleTurnEndEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  const response = getTurnEndResponse(event);
  if (response) {
    const targetIndex =
      state.activeAgentStream?.messageIndex ??
      state.lastCompletedAgentStreamIndex ??
      null;
    clearAllStreams(state);
    if (targetIndex !== null) {
      const existing = state.messages[targetIndex];
      if (existing?.role === "agent" && existing.category === "agent") {
        existing.content = response;
        return;
      }
    }
    appendMessage(state, {
      id,
      role: "agent",
      label: resolveAgentLabel(event.payload),
      content: response,
      timestamp: event.timestamp,
      category: "agent",
    });
    return;
  }

  const orchestrationSkipMessage = getOrchestrationSkipMessage(event);
  if (!orchestrationSkipMessage) {
    return;
  }

  clearAllStreams(state);
  appendMessage(state, {
    id,
    role: "event",
    label: "System",
    content: orchestrationSkipMessage,
    timestamp: event.timestamp,
    category: "system",
  });
}

export function handleAgentErrorEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  const errorMessage =
    asString(event.payload.message) ||
    asString(event.payload.error) ||
    "Agent error occurred.";

  appendMessage(state, {
    id,
    role: "event",
    label: "Error",
    content: errorMessage,
    timestamp: event.timestamp,
    category: "system",
  });
}

export function handleUserQuestionsPosedEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  const message = buildUserQuestionsPosedMessage(event, id);
  if (!message) {
    return;
  }
  message.timestamp = event.timestamp;
  message.category = "question";
  appendQuestionMessage(state, message);
}

export function handleUserQuestionAnswersEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  const message = buildUserQuestionAnswersMessage(event, id);
  if (!message) {
    return;
  }
  message.timestamp = event.timestamp;
  message.category = "question";
  appendMessage(state, message);
}

export function handleUserMessageDeliveryFailedEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);

  const reason = asString(event.payload.reason);
  const failedMessage = asString(event.payload.message);
  const baseContent = failedMessage
    ? `Operator guidance was not delivered: ${failedMessage}`
    : "Operator guidance was not delivered.";
  const content = reason ? `${baseContent}\n\nReason: ${reason}` : baseContent;

  appendMessage(state, {
    id,
    role: "event",
    label: "Delivery Failed",
    content,
    timestamp: event.timestamp,
    category: "system",
  });
}
