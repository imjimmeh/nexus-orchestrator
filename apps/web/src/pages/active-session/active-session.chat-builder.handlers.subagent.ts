import type { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { asString } from "./active-session.chat-helpers";
import { appendMessage, clearAllStreams } from "./active-session.chat-builder";
import type { SessionChatBuildState } from "./active-session.chat-builder.types";

export function handleSubagentLifecycleEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  const eventName = event.event_type;
  const subagentExecutionId = asString(event.payload.subagentExecutionId);
  if (!subagentExecutionId) {
    return;
  }

  const agentProfile = asString(event.payload.agent_profile);
  const status = asString(event.payload.status);
  const taskPrompt = asString(event.payload.task_prompt);
  const chatSessionId = asString(event.payload.subagent_chat_session_id);
  if (
    updateExistingSubagentMessage(state, subagentExecutionId, event, {
      agentProfile,
      chatSessionId,
      eventName,
      status,
      taskPrompt,
    })
  ) {
    return;
  }

  appendMessage(state, {
    id,
    role: "agent",
    label: "Subagent",
    content: `${agentProfile || "subagent"} spawn ${eventName.split(".")[1] || eventName}`,
    timestamp: event.timestamp,
    category: "subagent",
    metadata: {
      type: "subagent_spawn",
      subagentExecutionId,
      chatSessionId,
      agentProfile: agentProfile || "subagent",
      status: status || "spawning",
      taskPrompt: taskPrompt || "",
    },
  });

  state.activeSubagentMessageByKey.set(
    subagentExecutionId,
    state.messages.length - 1,
  );
}

function updateExistingSubagentMessage(
  state: SessionChatBuildState,
  subagentExecutionId: string,
  event: WorkflowTelemetryEvent,
  details: {
    agentProfile: string | undefined;
    chatSessionId: string | undefined;
    eventName: string;
    status: string | undefined;
    taskPrompt: string | undefined;
  },
): boolean {
  const existingIndex =
    state.activeSubagentMessageByKey.get(subagentExecutionId);
  const existing =
    existingIndex === undefined ? undefined : state.messages[existingIndex];
  if (!existing || existing.metadata?.type !== "subagent_spawn") {
    return false;
  }

  existing.timestamp = event.timestamp;
  existing.content = `${existing.metadata.agentProfile} spawn ${details.eventName.split(".")[1] || details.eventName}`;
  if (details.agentProfile) {
    existing.metadata.agentProfile = details.agentProfile;
  }
  if (details.status) {
    existing.metadata.status = details.status;
  }
  if (details.taskPrompt) {
    existing.metadata.taskPrompt = details.taskPrompt;
  }
  if (details.chatSessionId) {
    existing.metadata.chatSessionId = details.chatSessionId;
  }
  return true;
}
