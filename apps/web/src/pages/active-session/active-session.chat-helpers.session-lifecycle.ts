import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";

type LifecycleMessage = {
  label: string;
  content: string;
};

function firstStringFromPayload(
  payload: Record<string, unknown>,
  fields: string[],
): string | undefined {
  for (const field of fields) {
    const value = payload[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

export function formatSessionCompletedLifecycleMessage(): LifecycleMessage {
  return {
    label: "Session",
    content: "Session completed",
  };
}

export function formatSessionFailedLifecycleMessage(
  event: WorkflowTelemetryEvent,
): LifecycleMessage {
  const reason = firstStringFromPayload(event.payload, [
    "message",
    "error",
    "reason",
  ]);

  return {
    label: "Session",
    content: reason ? `Session failed: ${reason}` : "Session failed",
  };
}

export function formatSessionCancelledLifecycleMessage(): LifecycleMessage {
  return {
    label: "Session",
    content: "Session cancelled",
  };
}
