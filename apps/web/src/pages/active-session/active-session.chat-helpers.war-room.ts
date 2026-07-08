import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";

type LifecycleMessage = {
  label: string;
  content: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function firstStringFromPayload(
  payload: Record<string, unknown>,
  fields: string[],
): string | undefined {
  for (const field of fields) {
    const value = asString(payload[field]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function formatWarRoomSessionContext(event: WorkflowTelemetryEvent): string {
  const sessionId = firstStringFromPayload(event.payload, [
    "session_id",
    "sessionId",
  ]);
  return sessionId ? ` (session: ${sessionId})` : "";
}

export function formatWarRoomOpened(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  return {
    label: "War Room",
    content: `War room opened${formatWarRoomSessionContext(event)}`,
  };
}

export function formatWarRoomParticipantInvited(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const participant = firstStringFromPayload(event.payload, [
    "agent_profile",
    "participant_profile",
    "participant",
  ]);
  return {
    label: "War Room",
    content: participant
      ? `Participant invited: ${participant}${formatWarRoomSessionContext(event)}`
      : `Participant invited${formatWarRoomSessionContext(event)}`,
  };
}

export function formatWarRoomMessagePosted(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const messageKind = firstStringFromPayload(event.payload, [
    "message_kind",
    "messageKind",
  ]);
  return {
    label: "War Room",
    content: messageKind
      ? `Message posted (${messageKind})${formatWarRoomSessionContext(event)}`
      : `Message posted${formatWarRoomSessionContext(event)}`,
  };
}

export function formatWarRoomBlackboardUpdated(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const consensusState = firstStringFromPayload(event.payload, [
    "consensus_state",
    "consensusState",
  ]);
  return {
    label: "War Room",
    content: consensusState
      ? `Blackboard updated${formatWarRoomSessionContext(event)} · consensus ${consensusState}`
      : `Blackboard updated${formatWarRoomSessionContext(event)}`,
  };
}

export function formatWarRoomSignoffSubmitted(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const role = firstStringFromPayload(event.payload, ["role"]);
  const decision = firstStringFromPayload(event.payload, ["decision"]);
  return {
    label: "War Room",
    content:
      role && decision
        ? `Signoff submitted (${role}: ${decision})${formatWarRoomSessionContext(event)}`
        : `Signoff submitted${formatWarRoomSessionContext(event)}`,
  };
}

export function formatWarRoomTieBreakApplied(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  return {
    label: "War Room",
    content: `CEO tie-break applied${formatWarRoomSessionContext(event)}`,
  };
}

export function formatWarRoomDeadlocked(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  return {
    label: "War Room",
    content: `War room deadlocked${formatWarRoomSessionContext(event)}`,
  };
}

export function formatWarRoomConsensusReached(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  return {
    label: "War Room",
    content: `Consensus reached${formatWarRoomSessionContext(event)}`,
  };
}

export function formatWarRoomClosed(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const resolutionType = firstStringFromPayload(event.payload, [
    "resolution_type",
    "resolutionType",
  ]);
  const resolutionNote = firstStringFromPayload(event.payload, [
    "resolution_note",
    "resolutionNote",
    "note",
  ]);
  const base = resolutionType
    ? `War room closed (${resolutionType})${formatWarRoomSessionContext(event)}`
    : `War room closed${formatWarRoomSessionContext(event)}`;
  return {
    label: "War Room",
    content: resolutionNote ? `${base} · ${resolutionNote}` : base,
  };
}
