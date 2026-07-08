import type { OrchestrationNotification } from "@/components/notifications/OrchestrationNotificationFeed";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";

const WAR_ROOM_EVENT_TYPES = new Set([
  "war_room_opened",
  "war_room_participant_invited",
  "war_room_message_posted",
  "war_room_blackboard_updated",
  "war_room_signoff_submitted",
  "war_room_tie_break_applied",
  "war_room_deadlocked",
  "war_room_consensus_reached",
  "war_room_closed",
]);
const STATIC_EVENT_MESSAGES: Partial<Record<string, string>> = {
  war_room_opened: "War room opened",
  war_room_participant_invited: "Participant invited",
  war_room_message_posted: "Message posted to war room",
  war_room_tie_break_applied: "CEO tie-break applied",
  war_room_deadlocked: "War room reached deadlock",
  war_room_consensus_reached: "War room reached consensus",
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function firstString(
  payload: Record<string, unknown>,
  fields: string[],
): string {
  for (const field of fields) {
    const value = asString(payload[field]);
    if (value) {
      return value;
    }
  }

  return "";
}

function getWarRoomEventMessage(event: WorkflowTelemetryEvent): string {
  const sessionId = firstString(event.payload, ["session_id", "sessionId"]);
  const sessionSuffix = sessionId ? ` (session: ${sessionId})` : "";
  const consensusState = firstString(event.payload, [
    "consensus_state",
    "consensusState",
  ]);
  const resolutionType = firstString(event.payload, [
    "resolution_type",
    "resolutionType",
  ]);
  const resolutionNote = firstString(event.payload, [
    "resolution_note",
    "resolutionNote",
    "note",
  ]);
  const staticMessage = STATIC_EVENT_MESSAGES[event.event_type];
  if (staticMessage) {
    return `${staticMessage}${sessionSuffix}.`;
  }
  if (event.event_type === "war_room_blackboard_updated") {
    return formatConsensusMessage(
      "War-room blackboard updated",
      sessionSuffix,
      consensusState,
    );
  }
  if (event.event_type === "war_room_signoff_submitted") {
    return formatConsensusMessage(
      "Signoff submitted",
      sessionSuffix,
      consensusState,
    );
  }
  if (event.event_type === "war_room_closed") {
    return formatClosedMessage(sessionSuffix, resolutionType, resolutionNote);
  }
  return event.event_type;
}

function formatConsensusMessage(
  baseMessage: string,
  sessionSuffix: string,
  consensusState: string,
): string {
  return consensusState
    ? `${baseMessage}${sessionSuffix} (consensus: ${consensusState}).`
    : `${baseMessage}${sessionSuffix}.`;
}

function formatClosedMessage(
  sessionSuffix: string,
  resolutionType: string,
  resolutionNote: string,
): string {
  if (resolutionNote) {
    return `War room closed${sessionSuffix}: ${resolutionNote}`;
  }
  if (resolutionType) {
    return `War room closed${sessionSuffix} (${resolutionType}).`;
  }
  return `War room closed${sessionSuffix}.`;
}

function getWarRoomEventTitle(eventType: string): string {
  if (eventType === "war_room_opened") return "War Room Opened";
  if (eventType === "war_room_participant_invited")
    return "War Room Participant Invited";
  if (eventType === "war_room_message_posted") return "War Room Message Posted";
  if (eventType === "war_room_blackboard_updated")
    return "War Room Blackboard Updated";
  if (eventType === "war_room_signoff_submitted")
    return "War Room Signoff Submitted";
  if (eventType === "war_room_tie_break_applied")
    return "War Room Tie-Break Applied";
  if (eventType === "war_room_deadlocked") return "War Room Deadlocked";
  if (eventType === "war_room_consensus_reached")
    return "War Room Consensus Reached";
  if (eventType === "war_room_closed") return "War Room Closed";
  return "War Room Event";
}

export function addWarRoomNotifications(params: {
  notifications: OrchestrationNotification[];
  workflowEvents: WorkflowTelemetryEvent[];
}): void {
  const { notifications, workflowEvents } = params;
  for (const [index, event] of workflowEvents.entries()) {
    if (!WAR_ROOM_EVENT_TYPES.has(event.event_type)) {
      continue;
    }

    notifications.push({
      id: `war-room-${event.timestamp}-${event.event_type}-${index}`,
      category: "war_room",
      title: getWarRoomEventTitle(event.event_type),
      message: getWarRoomEventMessage(event),
      timestamp: event.timestamp,
      severity:
        event.event_type === "war_room_deadlocked" ||
        event.event_type === "war_room_tie_break_applied"
          ? "warning"
          : "info",
    });
  }
}
