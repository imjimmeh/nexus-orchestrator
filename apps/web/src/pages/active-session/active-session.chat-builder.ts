import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type { SessionChatMessage } from "./active-session.utils.types";
import { asString } from "./active-session.chat-helpers";
import { handleAgentTelemetryMessage } from "./active-session.chat-builder.handlers.agent";
import { handleToolEvent } from "./active-session.chat-builder.handlers.tool";
import {
  handleAgentErrorEvent,
  handleAgentPromptSentEvent,
  handleLifecycleEvent,
  handleTurnEndEvent,
} from "./active-session.chat-builder.handlers.lifecycle";
import { deepEqual } from "@/lib/deep-equal";
import {
  handleUserMessage,
  handleUserMessageDeliveryFailedEvent,
  handleUserQuestionAnswersEvent,
  handleUserQuestionsPosedEvent,
  handleWorkflowControlEvent,
} from "./active-session.chat-builder.handlers.lifecycle";
import { handleSubagentLifecycleEvent } from "./active-session.chat-builder.handlers.subagent";
import {
  handleSteeringPlanApprovedEvent,
  handleSteeringPlanProposedEvent,
  handleSteeringPlanRejectedEvent,
} from "./active-session.chat-builder.handlers.steering";
import { handleCommandEvent } from "./active-session.chat-builder.handlers.command";
import type {
  EventHandler,
  SessionChatBuildState,
} from "./active-session.chat-builder.types";

interface SessionChatBuildOptions {
  initialUserMessage?: string;
  hideThinking?: boolean;
}

export function appendMessage(
  state: SessionChatBuildState,
  message: SessionChatMessage,
): void {
  state.messages.push(message);
}

function areSameQuestions(
  left: SessionChatMessage["questions"],
  right: SessionChatMessage["questions"],
): boolean {
  if (!left || !right) {
    return false;
  }

  return deepEqual(left, right);
}

export function appendQuestionMessage(
  state: SessionChatBuildState,
  message: SessionChatMessage,
): void {
  const previous = state.messages[state.messages.length - 1];
  if (
    previous?.category === "question" &&
    areSameQuestions(previous.questions, message.questions)
  ) {
    previous.timestamp = message.timestamp;
    return;
  }

  appendMessage(state, message);
}

export function clearAgentStream(state: SessionChatBuildState): void {
  if (state.activeAgentStream !== null) {
    state.lastCompletedAgentStreamIndex = state.activeAgentStream.messageIndex;
  }
  state.activeAgentStream = null;
}

export function clearThoughtStream(state: SessionChatBuildState): void {
  state.activeThoughtStream = null;
}

export function clearAllStreams(state: SessionChatBuildState): void {
  clearAgentStream(state);
  clearThoughtStream(state);
  state.lastCompletedAgentStreamIndex = null;
}
export function resolveAgentLabel(payload: Record<string, unknown>): string {
  return (
    asString(payload.agentName) ||
    asString(payload.agentProfileName) ||
    asString(payload.agent_profile) ||
    asString(payload.agentProfile) ||
    asString(payload.sender_profile) ||
    "Agent"
  );
}

const EVENT_HANDLERS: Partial<
  Record<WorkflowTelemetryEvent["event_type"], EventHandler>
> = {
  user_message: handleUserMessage,
  "spawn.requested": handleSubagentLifecycleEvent,
  "spawn.succeeded": handleSubagentLifecycleEvent,
  "spawn.failed": handleSubagentLifecycleEvent,
  "execution.completed": handleSubagentLifecycleEvent,
  "execution.failed": handleSubagentLifecycleEvent,
  "execution.reaped": handleLifecycleEvent,
  tool_execution_start: handleToolEvent,
  tool_execution_end: handleToolEvent,
  tool_execution_update: handleToolEvent,
  workflow_control: handleWorkflowControlEvent,
  "workflow.run.started": handleLifecycleEvent,
  "workflow.retry_scheduled": handleLifecycleEvent,
  job_start: handleLifecycleEvent,
  "invoke_workflow.child_started": handleLifecycleEvent,
  step_start: handleLifecycleEvent,
  container_starting: handleLifecycleEvent,
  container_started: handleLifecycleEvent,
  container_stopped: handleLifecycleEvent,
  container_removing: handleLifecycleEvent,
  container_removed: handleLifecycleEvent,
  session_completed: handleLifecycleEvent,
  session_failed: handleLifecycleEvent,
  session_cancelled: handleLifecycleEvent,
  agent_runtime_ready: handleLifecycleEvent,
  agent_prompt_sent: handleAgentPromptSentEvent,
  agent_mention_requested: handleLifecycleEvent,
  agent_mention_received: handleLifecycleEvent,
  agent_mention_responded: handleLifecycleEvent,
  agent_mention_timeout: handleLifecycleEvent,
  agent_thread_resolved: handleLifecycleEvent,
  agent_mention_denied: handleLifecycleEvent,
  chat_participant_invited: handleLifecycleEvent,
  chat_participant_joined: handleLifecycleEvent,
  chat_participant_invite_denied: handleLifecycleEvent,
  chat_participant_left: handleLifecycleEvent,
  chat_participant_removed: handleLifecycleEvent,
  war_room_opened: handleLifecycleEvent,
  war_room_participant_invited: handleLifecycleEvent,
  war_room_message_posted: handleLifecycleEvent,
  war_room_blackboard_updated: handleLifecycleEvent,
  war_room_signoff_submitted: handleLifecycleEvent,
  war_room_tie_break_applied: handleLifecycleEvent,
  war_room_deadlocked: handleLifecycleEvent,
  war_room_consensus_reached: handleLifecycleEvent,
  war_room_closed: handleLifecycleEvent,
  turn_end: handleTurnEndEvent,
  agent_error: handleAgentErrorEvent,
  user_message_delivery_failed: handleUserMessageDeliveryFailedEvent,
  user_questions_posed: handleUserQuestionsPosedEvent,
  user_question_answers: handleUserQuestionAnswersEvent,
  steering_plan_proposed: handleSteeringPlanProposedEvent,
  steering_plan_approved: handleSteeringPlanApprovedEvent,
  steering_plan_rejected: handleSteeringPlanRejectedEvent,
  command_started: handleCommandEvent,
  command_output: handleCommandEvent,
  command_finished: handleCommandEvent,
};

export { getPendingQuestions } from "./active-session.chat-builder.questions";

export function toSessionChatMessages(
  events: WorkflowTelemetryEvent[],
  options?: SessionChatBuildOptions,
): SessionChatMessage[] {
  const hideThinking = options?.hideThinking ?? false;
  const state: SessionChatBuildState = {
    messages: [],
    activeAgentStream: null,
    lastCompletedAgentStreamIndex: null,
    activeThoughtStream: null,
    activeToolMessageByKey: new Map<string, number>(),
    activeSubagentMessageByKey: new Map<string, number>(),
    activeCommandMessageByKey: new Map<string, number>(),
    commandEventsByStepId: new Map<string, WorkflowTelemetryEvent[]>(),
  };

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.event_type === "agent_telemetry") {
      const id = `${event.timestamp}:${event.event_type}:${index}`;
      handleAgentTelemetryMessage(state, event, id, hideThinking);
      continue;
    }

    const handler = EVENT_HANDLERS[event.event_type];
    if (!handler) {
      continue;
    }

    const id = `${event.timestamp}:${event.event_type}:${index}`;
    handler(state, event, id);
  }

  const initialUserMessage =
    typeof options?.initialUserMessage === "string"
      ? options.initialUserMessage.trim()
      : "";

  if (initialUserMessage.length === 0) {
    return state.messages;
  }

  const hasMatchingUserMessage = state.messages.some(
    (message) =>
      message.role === "user" && message.content.trim() === initialUserMessage,
  );

  if (hasMatchingUserMessage) {
    return state.messages;
  }

  return [
    {
      id: `initial-user-message:${initialUserMessage}`,
      role: "user",
      content: initialUserMessage,
      category: "user",
    },
    ...state.messages,
  ];
}
