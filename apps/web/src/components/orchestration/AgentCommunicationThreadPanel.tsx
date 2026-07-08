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

interface AgentCommunicationThreadPanelProps {
  events: WorkflowTelemetryEvent[];
}

interface AgentCommunicationThreadSummary {
  threadId: string;
  targetProfile: string | null;
  lastEventType: string;
  status: string;
  updatedAt: string;
  resolutionNote: string | null;
}

const MESH_EVENT_TYPES = new Set([
  "agent_mention_requested",
  "agent_mention_received",
  "agent_mention_responded",
  "agent_mention_timeout",
  "agent_thread_resolved",
  "agent_mention_denied",
]);

const STATUS_BY_EVENT_TYPE: Record<string, string> = {
  agent_mention_requested: "requested",
  agent_mention_received: "received",
  agent_mention_responded: "responded",
  agent_mention_timeout: "timeout",
  agent_thread_resolved: "resolved",
  agent_mention_denied: "denied",
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
  if (status === "timeout" || status === "denied") {
    return "destructive" as const;
  }
  if (status === "resolved" || status === "responded") {
    return "secondary" as const;
  }
  if (status === "requested" || status === "received") {
    return "default" as const;
  }
  return "outline" as const;
}

function parseThreadSummaries(
  events: WorkflowTelemetryEvent[],
): AgentCommunicationThreadSummary[] {
  const byThread = new Map<string, AgentCommunicationThreadSummary>();

  for (const event of events) {
    if (!MESH_EVENT_TYPES.has(event.event_type)) {
      continue;
    }

    const threadId = firstString(event.payload, ["thread_id", "threadId"]);
    if (!threadId) {
      continue;
    }

    const targetProfile = firstString(event.payload, [
      "target_profile",
      "target_agent_profile",
      "targetProfile",
      "recipient_profile",
    ]);
    const resolutionNote = firstString(event.payload, [
      "resolution_note",
      "resolutionNote",
      "note",
    ]);

    const existing = byThread.get(threadId);
    const nextTimestamp = new Date(event.timestamp).getTime();
    const currentTimestamp = existing
      ? new Date(existing.updatedAt).getTime()
      : Number.NEGATIVE_INFINITY;
    const isLatest = !existing || nextTimestamp >= currentTimestamp;

    if (!existing) {
      byThread.set(threadId, {
        threadId,
        targetProfile,
        lastEventType: event.event_type,
        status: toStatus(event.event_type),
        updatedAt: event.timestamp,
        resolutionNote,
      });
      continue;
    }

    existing.targetProfile = existing.targetProfile ?? targetProfile;
    existing.resolutionNote = existing.resolutionNote ?? resolutionNote;

    if (!isLatest) {
      continue;
    }

    existing.lastEventType = event.event_type;
    existing.status = toStatus(event.event_type);
    existing.updatedAt = event.timestamp;
    if (resolutionNote) {
      existing.resolutionNote = resolutionNote;
    }
  }

  return [...byThread.values()].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function AgentCommunicationThreadPanel({
  events,
}: Readonly<AgentCommunicationThreadPanelProps>) {
  const rows = useMemo(() => parseThreadSummaries(events), [events]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Communication Threads</CardTitle>
        <CardDescription>
          Read-only summary of mesh mention activity grouped by thread.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agent mesh threads recorded for this run.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.threadId} className="rounded-md border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {row.threadId}
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
                  Target profile: {row.targetProfile ?? "Unknown"}
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
