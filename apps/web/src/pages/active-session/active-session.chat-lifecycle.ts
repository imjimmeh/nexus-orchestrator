import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import {
  asString,
  firstStringFromPayload,
  formatMeshTargetContext,
  formatMeshThreadContext,
  getNumberPayloadField,
} from "./active-session.chat-helpers";
import {
  formatSessionCancelledLifecycleMessage,
  formatSessionCompletedLifecycleMessage,
  formatSessionFailedLifecycleMessage,
} from "./active-session.chat-helpers.session-lifecycle";
import {
  formatWarRoomBlackboardUpdated,
  formatWarRoomClosed,
  formatWarRoomConsensusReached,
  formatWarRoomDeadlocked,
  formatWarRoomMessagePosted,
  formatWarRoomOpened,
  formatWarRoomParticipantInvited,
  formatWarRoomSignoffSubmitted,
  formatWarRoomTieBreakApplied,
} from "./active-session.chat-helpers.war-room";
import type { LifecycleMessage } from "./active-session.chat-lifecycle.types";

type LifecycleFormatter = (event: WorkflowTelemetryEvent) => LifecycleMessage;

function formatSessionStepStart(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const stepId = asString(event.payload.stepId);
  return {
    label: "Session",
    content: stepId ? `Session step ${stepId} started` : "Session started",
  };
}

function formatContainerStarting(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const stepId = asString(event.payload.stepId);
  return {
    label: "Container",
    content: stepId
      ? `Container is starting for ${stepId}`
      : "Container is starting",
  };
}

function formatContainerStopped(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const exitCode = getNumberPayloadField(event.payload, "exitCode");
  return {
    label: "Container",
    content:
      exitCode === null
        ? "Container stopped"
        : `Container stopped (exit code ${exitCode})`,
  };
}

function formatAgentRuntimeReady(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const stepId = asString(event.payload.stepId);
  return {
    label: "Agent Runtime",
    content: stepId
      ? `Agent runtime connected for ${stepId}`
      : "Agent runtime connected",
  };
}

function formatAgentMentionRequested(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  return {
    label: "Agent Mesh",
    content: `Requested assistance from${formatMeshTargetContext(event)}${formatMeshThreadContext(event)}`,
  };
}

function formatAgentMentionReceived(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  return {
    label: "Agent Mesh",
    content: `Peer assistance request received${formatMeshThreadContext(event)}`,
  };
}

function formatAgentMentionResponded(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  return {
    label: "Agent Mesh",
    content: `Peer response received${formatMeshThreadContext(event)}`,
  };
}

function formatAgentMentionTimeout(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  return {
    label: "Agent Mesh",
    content: `Peer assistance request timed out${formatMeshThreadContext(event)}`,
  };
}

function formatAgentThreadResolved(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const resolutionNote = firstStringFromPayload(event.payload, [
    "resolution_note",
    "resolutionNote",
    "note",
  ]);
  return {
    label: "Agent Mesh",
    content: resolutionNote
      ? `Agent thread resolved${formatMeshThreadContext(event)} - ${resolutionNote}`
      : `Agent thread resolved${formatMeshThreadContext(event)}`,
  };
}

function formatAgentMentionDenied(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const reason = firstStringFromPayload(event.payload, [
    "reason",
    "denial_reason",
    "denialReason",
    "message",
  ]);
  return {
    label: "Agent Mesh",
    content: reason
      ? `Peer assistance request denied${formatMeshThreadContext(event)} - ${reason}`
      : `Peer assistance request denied${formatMeshThreadContext(event)}`,
  };
}

function formatChatParticipantInvited(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const agentProfile = firstStringFromPayload(event.payload, [
    "agent_profile",
    "agentProfile",
  ]);
  const role = firstStringFromPayload(event.payload, ["role"]);
  const invitedBy = firstStringFromPayload(event.payload, [
    "invited_by",
    "invitedBy",
  ]);

  const participantText = agentProfile ?? "agent";
  const roleText = role ? ` as ${role}` : "";
  const invitedByText = invitedBy ? ` by ${invitedBy}` : "";

  return {
    label: "Chat",
    content: `Invited ${participantText}${roleText}${invitedByText}`,
  };
}

function formatChatParticipantJoined(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const agentProfile = firstStringFromPayload(event.payload, [
    "agent_profile",
    "agentProfile",
  ]);

  return {
    label: "Chat",
    content: `${agentProfile ?? "Agent"} joined the chat`,
  };
}

function formatChatParticipantInviteDenied(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const agentProfile = firstStringFromPayload(event.payload, [
    "agent_profile",
    "agentProfile",
  ]);
  const reason = firstStringFromPayload(event.payload, [
    "denial_reason",
    "denialReason",
    "reason",
  ]);

  return {
    label: "Chat",
    content: reason
      ? `Invite denied for ${agentProfile ?? "agent"} - ${reason}`
      : `Invite denied for ${agentProfile ?? "agent"}`,
  };
}

function formatChatParticipantLeft(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const agentProfile = firstStringFromPayload(event.payload, [
    "agent_profile",
    "agentProfile",
  ]);

  return {
    label: "Chat",
    content: `${agentProfile ?? "Agent"} left the chat`,
  };
}

function formatChatParticipantRemoved(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const agentProfile = firstStringFromPayload(event.payload, [
    "agent_profile",
    "agentProfile",
  ]);

  return {
    label: "Chat",
    content: `${agentProfile ?? "Agent"} was removed from the chat`,
  };
}

function formatWorkflowRunStarted(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const workflowId = firstStringFromPayload(event.payload, [
    "workflowId",
    "workflow_id",
  ]);
  const workflowRunId = firstStringFromPayload(event.payload, [
    "workflowRunId",
    "workflow_run_id",
    "workflowRun",
  ]);
  const context = [workflowId, workflowRunId].filter(Boolean).join(" / ");
  return {
    label: "Workflow",
    content: context
      ? `Workflow run started (${context})`
      : "Workflow run started",
  };
}

function formatJobStart(event: WorkflowTelemetryEvent): LifecycleMessage {
  const jobId = firstStringFromPayload(event.payload, ["jobId", "job_id"]);
  return {
    label: "Workflow",
    content: jobId ? `Job ${jobId} started` : "Job started",
  };
}

function formatInvokeWorkflowChildStarted(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const childRunId = firstStringFromPayload(event.payload, [
    "childRunId",
    "child_run_id",
  ]);
  const invokedWorkflowId = firstStringFromPayload(event.payload, [
    "invokedWorkflowId",
    "invoked_workflow_id",
    "workflowId",
    "workflow_id",
  ]);
  const parts = [
    childRunId ? `child run ${childRunId}` : undefined,
    invokedWorkflowId ? `workflow ${invokedWorkflowId}` : undefined,
  ].filter(Boolean);

  return {
    label: "Workflow",
    content:
      parts.length > 0
        ? `Invoked ${parts.join(" via ")}`
        : "Workflow invocation started",
  };
}

const LIFECYCLE_EVENT_FORMATTERS: Partial<
  Record<WorkflowTelemetryEvent["event_type"], LifecycleFormatter>
> = {
  step_start: formatSessionStepStart,
  container_starting: formatContainerStarting,
  container_started: () => ({
    label: "Container",
    content: "Container started",
  }),
  agent_runtime_ready: formatAgentRuntimeReady,
  container_stopped: formatContainerStopped,
  session_completed: formatSessionCompletedLifecycleMessage,
  session_failed: formatSessionFailedLifecycleMessage,
  session_cancelled: formatSessionCancelledLifecycleMessage,
  container_removing: () => ({
    label: "Container",
    content: "Removing container",
  }),
  container_removed: () => ({
    label: "Container",
    content: "Container removed",
  }),
  "execution.reaped": (event) => {
    const reason = asString(event.payload.failure_reason);
    const message = asString(event.payload.error_message);
    return {
      label: "Container",
      content: reason
        ? `Execution interrupted: ${reason}${message ? ` — ${message}` : ""}`
        : "Execution interrupted",
    };
  },
  "workflow.retry_scheduled": (event) => {
    const reason = asString(event.payload.reason);
    return {
      label: "Workflow",
      content: reason
        ? `Workflow retry scheduled (${reason})`
        : "Workflow retry scheduled",
    };
  },
  agent_mention_requested: formatAgentMentionRequested,
  agent_mention_received: formatAgentMentionReceived,
  agent_mention_responded: formatAgentMentionResponded,
  agent_mention_timeout: formatAgentMentionTimeout,
  agent_thread_resolved: formatAgentThreadResolved,
  agent_mention_denied: formatAgentMentionDenied,
  chat_participant_invited: formatChatParticipantInvited,
  chat_participant_joined: formatChatParticipantJoined,
  chat_participant_invite_denied: formatChatParticipantInviteDenied,
  chat_participant_left: formatChatParticipantLeft,
  chat_participant_removed: formatChatParticipantRemoved,
  job_start: formatJobStart,
  "workflow.run.started": formatWorkflowRunStarted,
  "invoke_workflow.child_started": formatInvokeWorkflowChildStarted,
  war_room_opened: formatWarRoomOpened,
  war_room_participant_invited: formatWarRoomParticipantInvited,
  war_room_message_posted: formatWarRoomMessagePosted,
  war_room_blackboard_updated: formatWarRoomBlackboardUpdated,
  war_room_signoff_submitted: formatWarRoomSignoffSubmitted,
  war_room_tie_break_applied: formatWarRoomTieBreakApplied,
  war_room_deadlocked: formatWarRoomDeadlocked,
  war_room_consensus_reached: formatWarRoomConsensusReached,
  war_room_closed: formatWarRoomClosed,
};

export function formatLifecycleEvent(
  event: WorkflowTelemetryEvent,
): LifecycleMessage | null {
  const formatter = LIFECYCLE_EVENT_FORMATTERS[event.event_type];
  return formatter ? formatter(event) : null;
}
