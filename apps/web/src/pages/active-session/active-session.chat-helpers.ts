import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function isTextStreamTelemetry(
  telemetryType: string | undefined,
): boolean {
  return (
    telemetryType === "text_delta" ||
    telemetryType === "text_end" ||
    telemetryType === "message_delta" ||
    telemetryType === "message_end"
  );
}

export function isStreamEndTelemetryType(
  telemetryType: string | undefined,
): boolean {
  return typeof telemetryType === "string" && telemetryType.endsWith("_end");
}

export function getTelemetryText(event: WorkflowTelemetryEvent): string {
  return (
    asString(event.payload.delta) ||
    asString(event.payload.content) ||
    asString(event.payload.text) ||
    asString(event.payload.message) ||
    ""
  );
}

export function getAgentStreamKey(event: WorkflowTelemetryEvent): string {
  return (
    asString(event.payload.messageId) ||
    asString(event.payload.responseId) ||
    asString(event.payload.stepId) ||
    "default"
  );
}

export function getToolName(payload: Record<string, unknown>): string {
  return (
    asString(payload.toolName) ||
    asString(payload.tool) ||
    asString(payload.name) ||
    "unknown"
  );
}

export function getNumberPayloadField(
  payload: Record<string, unknown>,
  field: string,
): number | null {
  const value = payload[field];
  return typeof value === "number" ? value : null;
}

export function firstStringFromPayload(
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

export function formatMeshThreadContext(event: WorkflowTelemetryEvent): string {
  const threadId = firstStringFromPayload(event.payload, [
    "thread_id",
    "threadId",
  ]);
  return threadId ? ` (thread: ${threadId})` : "";
}

export function formatMeshTargetContext(event: WorkflowTelemetryEvent): string {
  const targetProfile = firstStringFromPayload(event.payload, [
    "target_profile",
    "target_agent_profile",
    "targetProfile",
    "recipient_profile",
  ]);
  return targetProfile ? ` ${targetProfile}` : " peer agent";
}

export function getTurnEndResponse(
  event: WorkflowTelemetryEvent,
): string | null {
  if (!event.payload || typeof event.payload !== "object") {
    return null;
  }

  const output = event.payload.output;
  if (!output || typeof output !== "object") {
    return null;
  }

  return asString((output as Record<string, unknown>).response) || null;
}

export function getOrchestrationSkipMessage(
  event: WorkflowTelemetryEvent,
): string | null {
  const output = event.payload.output;
  if (!output || typeof output !== "object") {
    return null;
  }

  const outputRecord = output as Record<string, unknown>;
  const stdout = asString(outputRecord.stdout);
  if (stdout === "skip_project_orchestration_cycle_not_orchestrating") {
    return "Orchestration cycle skipped because project orchestration is not currently in orchestrating state.";
  }

  const reason = asString(outputRecord.reason);
  if (reason !== "status_mismatch") {
    return null;
  }

  const requiredStatus = asString(outputRecord.required_status);
  const actualStatus = asString(outputRecord.actual_status);
  if (requiredStatus && actualStatus) {
    return `Orchestration cycle skipped: required status ${requiredStatus}, current status ${actualStatus}.`;
  }

  return "Orchestration cycle skipped because orchestration status no longer matches the run gate.";
}
