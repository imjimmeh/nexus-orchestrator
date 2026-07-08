import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type { WorkflowSubagentExecutionSummary } from "./useWorkflowSubagentExecutions.types";
import { asRecord } from "@/lib/deep-paths";
import {
  asString,
  isActiveStatus,
  isBefore,
  isTerminalStatus,
  normalizeStatusFromTelemetry,
} from "./useWorkflowSubagentExecutions.status";

export function applySubagentTelemetryPass(
  telemetryEvents: WorkflowTelemetryEvent[],
  byExecutionId: Map<string, WorkflowSubagentExecutionSummary>,
): void {
  const sortedTelemetryEvents = [...telemetryEvents].sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );

  for (const event of sortedTelemetryEvents) {
    applyWaitTelemetryEvent(event, byExecutionId);
  }
}

function applyWaitTelemetryEvent(
  event: WorkflowTelemetryEvent,
  byExecutionId: Map<string, WorkflowSubagentExecutionSummary>,
): void {
  const action = getRuntimeAction(event.payload);
  const results = getWaitTelemetryResults(event, action);
  if (!results || action !== "wait_for_subagents") {
    return;
  }

  for (const [executionId, value] of Object.entries(results)) {
    byExecutionId.set(
      executionId,
      buildWaitTelemetrySummary(
        executionId,
        action,
        value,
        event.timestamp,
        byExecutionId.get(executionId),
      ),
    );
  }
}

function getRuntimeAction(payload: Record<string, unknown>): string | null {
  const args = asRecord(payload.args);
  const action = asString(args?.action);
  if (action) {
    return action;
  }

  const toolName = asString(payload.toolName) ?? asString(payload.tool_name);
  if (
    toolName === "spawn_subagent_async" ||
    toolName === "wait_for_subagents"
  ) {
    return toolName;
  }

  return null;
}

function getTelemetryResult(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const result = asRecord(payload.result);
  return asRecord(result?.details) ?? result;
}

function getWaitTelemetryResults(
  event: WorkflowTelemetryEvent,
  action: string | null,
): Record<string, unknown> | null {
  if (event.event_type !== "tool_execution_end") {
    return null;
  }
  if (action !== "wait_for_subagents") {
    return null;
  }
  return asRecord(getTelemetryResult(event.payload)?.results);
}

function buildWaitTelemetrySummary(
  executionId: string,
  action: string,
  value: unknown,
  eventTimestamp: string,
  current: WorkflowSubagentExecutionSummary | undefined,
): WorkflowSubagentExecutionSummary {
  const resultRecord = asRecord(value);
  const nextStatus = normalizeStatusFromTelemetry(resultRecord?.status);
  const nextLastEventAt = getWaitTelemetryTimestamp(
    resultRecord,
    eventTimestamp,
  );

  if (current && isBefore(nextLastEventAt, current.lastEventAt)) {
    return current;
  }

  if (
    current &&
    isTerminalStatus(current.status) &&
    isActiveStatus(nextStatus)
  ) {
    return current;
  }

  return {
    id: executionId,
    status:
      nextStatus === "unknown" ? (current?.status ?? "unknown") : nextStatus,
    lastEventName: action,
    lastEventAt: nextLastEventAt,
    childContainerId: current?.childContainerId ?? null,
    ...(current?.subagentChatSessionId
      ? { subagentChatSessionId: current.subagentChatSessionId }
      : {}),
  };
}

function getWaitTelemetryTimestamp(
  resultRecord: Record<string, unknown> | null,
  eventTimestamp: string,
): string {
  return (
    asString(resultRecord?.completed_at) ??
    asString(resultRecord?.completedAt) ??
    asString(resultRecord?.latest_turn_at) ??
    eventTimestamp
  );
}
