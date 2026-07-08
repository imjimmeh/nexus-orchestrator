import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { formatDateSafe } from "@/lib/utils";

interface WarRoomSessionPanelProps {
  events: WorkflowTelemetryEvent[];
}

interface WarRoomSessionSummary {
  sessionId: string;
  status: string;
  lastEventType: string;
  updatedAt: string;
  consensusState: string | null;
  resolutionType: string | null;
  resolutionNote: string | null;
}

interface ParsedWarRoomEvent {
  sessionId: string;
  eventType: string;
  timestamp: string;
  consensusState: string | null;
  resolutionType: string | null;
  resolutionNote: string | null;
}

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

const STATUS_BY_EVENT_TYPE: Record<string, string> = {
  war_room_opened: "open",
  war_room_participant_invited: "active",
  war_room_message_posted: "active",
  war_room_blackboard_updated: "drafting",
  war_room_signoff_submitted: "signoff",
  war_room_tie_break_applied: "tie_break",
  war_room_deadlocked: "deadlocked",
  war_room_consensus_reached: "consensus",
  war_room_closed: "closed",
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function firstString(
  payload: Record<string, unknown>,
  fields: string[],
): string | null {
  for (const field of fields) {
    const value = asString(payload[field]);
    if (value) {
      return value;
    }
  }

  return null;
}

function toStatus(eventType: string): string {
  return STATUS_BY_EVENT_TYPE[eventType] ?? "unknown";
}

function getStatusVariant(status: string) {
  if (status === "deadlocked") {
    return "destructive" as const;
  }
  if (status === "consensus" || status === "closed" || status === "tie_break") {
    return "secondary" as const;
  }
  if (status === "open" || status === "active" || status === "drafting") {
    return "default" as const;
  }
  return "outline" as const;
}

function parseSessionSummaries(
  events: WorkflowTelemetryEvent[],
): WarRoomSessionSummary[] {
  const bySession = new Map<string, WarRoomSessionSummary>();

  for (const event of events) {
    const parsedEvent = parseWarRoomEvent(event);
    if (!parsedEvent) {
      continue;
    }

    const existing = bySession.get(parsedEvent.sessionId);
    if (!existing) {
      bySession.set(parsedEvent.sessionId, createSessionSummary(parsedEvent));
      continue;
    }

    mergeSessionMetadata(existing, parsedEvent);
    if (!isLatestEvent(existing.updatedAt, parsedEvent.timestamp)) {
      continue;
    }
    applyLatestEvent(existing, parsedEvent);
  }

  return [...bySession.values()].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function parseWarRoomEvent(
  event: WorkflowTelemetryEvent,
): ParsedWarRoomEvent | null {
  if (!WAR_ROOM_EVENT_TYPES.has(event.event_type)) {
    return null;
  }
  const sessionId = firstString(event.payload, ["session_id", "sessionId"]);
  if (!sessionId) {
    return null;
  }

  return {
    sessionId,
    eventType: event.event_type,
    timestamp: event.timestamp,
    consensusState: firstString(event.payload, [
      "consensus_state",
      "consensusState",
    ]),
    resolutionType: firstString(event.payload, [
      "resolution_type",
      "resolutionType",
    ]),
    resolutionNote: firstString(event.payload, [
      "resolution_note",
      "resolutionNote",
      "note",
    ]),
  };
}

function createSessionSummary(
  parsedEvent: ParsedWarRoomEvent,
): WarRoomSessionSummary {
  return {
    sessionId: parsedEvent.sessionId,
    status: toStatus(parsedEvent.eventType),
    lastEventType: parsedEvent.eventType,
    updatedAt: parsedEvent.timestamp,
    consensusState: parsedEvent.consensusState,
    resolutionType: parsedEvent.resolutionType,
    resolutionNote: parsedEvent.resolutionNote,
  };
}

function mergeSessionMetadata(
  summary: WarRoomSessionSummary,
  parsedEvent: ParsedWarRoomEvent,
): void {
  summary.consensusState = summary.consensusState ?? parsedEvent.consensusState;
  summary.resolutionType = summary.resolutionType ?? parsedEvent.resolutionType;
  summary.resolutionNote = summary.resolutionNote ?? parsedEvent.resolutionNote;
}

function isLatestEvent(
  currentTimestamp: string,
  nextTimestamp: string,
): boolean {
  return (
    new Date(nextTimestamp).getTime() >= new Date(currentTimestamp).getTime()
  );
}

function applyLatestEvent(
  summary: WarRoomSessionSummary,
  parsedEvent: ParsedWarRoomEvent,
): void {
  summary.status = toStatus(parsedEvent.eventType);
  summary.lastEventType = parsedEvent.eventType;
  summary.updatedAt = parsedEvent.timestamp;
  if (parsedEvent.consensusState) {
    summary.consensusState = parsedEvent.consensusState;
  }
  if (parsedEvent.resolutionType) {
    summary.resolutionType = parsedEvent.resolutionType;
  }
  if (parsedEvent.resolutionNote) {
    summary.resolutionNote = parsedEvent.resolutionNote;
  }
}

export function WarRoomSessionPanel({
  events,
}: Readonly<WarRoomSessionPanelProps>) {
  const rows = useMemo(() => parseSessionSummaries(events), [events]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>War Room Sessions</CardTitle>
        <CardDescription>
          Read-only summary of multi-agent war-room lifecycle activity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No war-room sessions recorded for this run.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.sessionId} className="rounded-md border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {row.sessionId}
                    </Badge>
                    <Badge variant={getStatusVariant(row.status)}>
                      {row.status}
                    </Badge>
                    <Badge variant="secondary">{row.lastEventType}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateSafe(row.updatedAt, "MMM d, yyyy HH:mm:ss", "-")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Consensus state: {row.consensusState ?? "Unknown"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Resolution: {row.resolutionType ?? "n/a"}
                </p>
                {row.resolutionNote ? (
                  <p className="mt-1 text-sm">{row.resolutionNote}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
