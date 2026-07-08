import { EventLedgerRecord } from "@/lib/api/event-ledger.types";
import type { SubagentExecutionStatus } from "./useWorkflowSubagentExecutions.types";

const PAYLOAD_STATUS_MAP: Partial<Record<string, SubagentExecutionStatus>> = {
  completed: "completed",
  error: "failed",
  exited: "failed",
  failed: "failed",
  running: "running",
  success: "completed",
};

const EVENT_STATUS_MAP: Partial<Record<string, SubagentExecutionStatus>> = {
  cancelled: "failed",
  "cancel.failed": "failed",
  "completion.failed": "failed",
  "completion.succeeded": "completed",
  reaped: "failed",
  "spawn.execution_failed": "failed",
  "spawn.failed": "failed",
  "spawn.requested": "spawning",
  "spawn.succeeded": "running",
};

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function normalizeStatusFromEvent(
  event: EventLedgerRecord,
  payload: Record<string, unknown> | null,
): SubagentExecutionStatus {
  const payloadStatus = asString(payload?.status)?.toLowerCase();
  return (
    (payloadStatus ? PAYLOAD_STATUS_MAP[payloadStatus] : undefined) ??
    EVENT_STATUS_MAP[event.event_name] ??
    "unknown"
  );
}

export function normalizeStatusFromTelemetry(
  value: unknown,
): SubagentExecutionStatus {
  const status = asString(value)?.toLowerCase();
  if (!status) {
    return "unknown";
  }

  if (status === "completed" || status === "success") {
    return "completed";
  }
  if (status === "failed" || status === "error" || status === "exited") {
    return "failed";
  }
  if (status === "running" || status === "started") {
    return "running";
  }
  if (status === "spawning" || status === "pending") {
    return "spawning";
  }

  return "unknown";
}

export function isTerminalStatus(status: SubagentExecutionStatus): boolean {
  return status === "completed" || status === "failed";
}

export function isActiveStatus(status: SubagentExecutionStatus): boolean {
  return status === "running" || status === "spawning";
}

export function isBefore(left: string, right: string): boolean {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return false;
  }

  return leftTime < rightTime;
}
