import { useMemo } from "react";
import { asRecord, readString } from "@/lib/deep-paths";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type {
  SubagentExecutionRecord,
  SubagentExecutionRow,
} from "./SubagentExecutionPanel.types";

export type {
  SubagentExecutionRecord,
  SubagentExecutionRow,
} from "./SubagentExecutionPanel.types";

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function firstDefinedString(values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const normalized = readString(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

interface ToolExecutionContext {
  toolName: "spawn_subagent_async" | "wait_for_subagents";
  event: WorkflowTelemetryEvent;
  args: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}

function parseToolExecutionContext(
  event: WorkflowTelemetryEvent,
): ToolExecutionContext | null {
  if (
    event.event_type !== "tool_execution_start" &&
    event.event_type !== "tool_execution_end"
  ) {
    return null;
  }

  const toolName = readString(event.payload.toolName);
  if (
    toolName !== "spawn_subagent_async" &&
    toolName !== "wait_for_subagents"
  ) {
    return null;
  }

  return {
    toolName,
    event,
    args: asRecord(event.payload.args),
    result: asRecord(event.payload.result),
  };
}

function ensureExecutionRecord(
  byId: Map<string, SubagentExecutionRecord>,
  executionId: string,
): SubagentExecutionRecord {
  const existing = byId.get(executionId);
  if (existing) {
    return existing;
  }

  const created: SubagentExecutionRecord = {
    executionId,
    status: "unknown",
    assignedFiles: [],
  };
  byId.set(executionId, created);
  return created;
}

function applyOverlapAndSummary(
  record: SubagentExecutionRecord,
  message: string | undefined,
): void {
  if (!message) {
    return;
  }

  if (message.includes("assigned_files overlap")) {
    record.overlapError = message;
    return;
  }

  if (!record.waitSummary) {
    record.waitSummary = message;
  }
}

function resolveSpawnExecutionId(
  context: ToolExecutionContext,
  syntheticIndex: number,
): { executionId: string; nextSyntheticIndex: number } {
  const explicitExecutionId = firstDefinedString([
    context.result?.execId,
    context.result?.execution_id,
    context.result?.executionId,
    context.args?.execution_id,
    context.args?.executionId,
  ]);

  if (explicitExecutionId) {
    return {
      executionId: explicitExecutionId,
      nextSyntheticIndex: syntheticIndex,
    };
  }

  return {
    executionId: `pending-${syntheticIndex}`,
    nextSyntheticIndex: syntheticIndex + 1,
  };
}

function resolveSpawnErrorMessage(
  context: ToolExecutionContext,
): string | undefined {
  return firstDefinedString([
    context.result?.message,
    context.result?.error,
    context.event.payload.result,
  ]);
}

function applySpawnEventStatus(
  record: SubagentExecutionRecord,
  context: ToolExecutionContext,
): void {
  if (context.event.payload.isError === true) {
    record.status = "rejected";
    applyOverlapAndSummary(record, resolveSpawnErrorMessage(context));
    return;
  }

  record.status =
    context.event.event_type === "tool_execution_end" ? "started" : "running";
}

function applySpawnSubagentEvent(params: {
  context: ToolExecutionContext;
  ensureRecord: (executionId: string) => SubagentExecutionRecord;
  syntheticIndex: number;
}): number {
  const { context, ensureRecord } = params;

  const { executionId, nextSyntheticIndex } = resolveSpawnExecutionId(
    context,
    params.syntheticIndex,
  );
  const record = ensureRecord(executionId);
  record.assignedFiles = readStringArray(context.args?.assigned_files);
  record.startedAt = record.startedAt ?? context.event.timestamp;

  applySpawnEventStatus(record, context);

  return nextSyntheticIndex;
}

function assignWaitStatus(
  record: SubagentExecutionRecord,
  resultRecord: Record<string, unknown> | null,
): void {
  const status = readString(resultRecord?.status);
  if (status) {
    record.status = status;
  }
}

function assignWaitTiming(
  record: SubagentExecutionRecord,
  resultRecord: Record<string, unknown> | null,
  fallbackTimestamp: string,
): void {
  record.completedAt = firstDefinedString([
    resultRecord?.completedAt,
    resultRecord?.completed_at,
    fallbackTimestamp,
  ]);

  if (!record.startedAt) {
    record.startedAt = firstDefinedString([
      resultRecord?.startedAt,
      resultRecord?.started_at,
    ]);
  }
}

function assignWaitAssignedFiles(
  record: SubagentExecutionRecord,
  resultRecord: Record<string, unknown> | null,
): void {
  if (record.assignedFiles.length === 0) {
    record.assignedFiles = readStringArray(resultRecord?.assigned_files);
  }
}

function resolveWaitMessage(
  resultRecord: Record<string, unknown> | null,
): string | undefined {
  return firstDefinedString([
    resultRecord?.failure_reason,
    resultRecord?.failureReason,
    resultRecord?.errorMessage,
    resultRecord?.error,
    resultRecord?.message,
  ]);
}

function applyWaitEntryToRecord(params: {
  record: SubagentExecutionRecord;
  resultRecord: Record<string, unknown> | null;
  fallbackTimestamp: string;
}): void {
  const { record, resultRecord, fallbackTimestamp } = params;

  assignWaitStatus(record, resultRecord);
  assignWaitTiming(record, resultRecord, fallbackTimestamp);
  assignWaitAssignedFiles(record, resultRecord);

  const message = resolveWaitMessage(resultRecord);
  applyOverlapAndSummary(record, message);
}

function applyWaitForSubagentsEvent(params: {
  context: ToolExecutionContext;
  ensureRecord: (executionId: string) => SubagentExecutionRecord;
}): void {
  const { context, ensureRecord } = params;
  if (!context.result) {
    return;
  }

  const nestedResults = asRecord(context.result.results);
  const hasToolEnvelope =
    context.result.ok !== undefined || context.result.action !== undefined;
  const resultMap = nestedResults ?? (hasToolEnvelope ? null : context.result);

  if (resultMap) {
    for (const [executionId, value] of Object.entries(resultMap)) {
      const record = ensureRecord(executionId);
      const resultRecord = asRecord(value);
      applyWaitEntryToRecord({
        record,
        resultRecord,
        fallbackTimestamp: context.event.timestamp,
      });
    }
  }

  const waitStatus = readString(context.result.status);
  if (waitStatus !== "timeout") {
    return;
  }

  const pendingExecutionIds = readStringArray(
    context.result.pending_execution_ids,
  );
  const timeoutSummary =
    firstDefinedString([context.result.error, context.result.message]) ??
    "Wait timed out before all subagents completed.";

  for (const pendingExecutionId of pendingExecutionIds) {
    const record = ensureRecord(pendingExecutionId);
    if (record.status === "unknown") {
      record.status = "running";
    }
    applyOverlapAndSummary(record, timeoutSummary);
  }
}

function parseSubagentExecutions(
  events: readonly WorkflowTelemetryEvent[],
): SubagentExecutionRecord[] {
  const byId = new Map<string, SubagentExecutionRecord>();
  let syntheticIndex = 0;

  const ensureRecord = (executionId: string): SubagentExecutionRecord =>
    ensureExecutionRecord(byId, executionId);

  for (const event of events) {
    const context = parseToolExecutionContext(event);
    if (!context) {
      continue;
    }

    if (context.toolName === "spawn_subagent_async") {
      syntheticIndex = applySpawnSubagentEvent({
        context,
        ensureRecord,
        syntheticIndex,
      });
      continue;
    }

    applyWaitForSubagentsEvent({ context, ensureRecord });
  }

  return [...byId.values()].sort((left, right) => {
    const leftTime = left.startedAt ? new Date(left.startedAt).getTime() : 0;
    const rightTime = right.startedAt ? new Date(right.startedAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

function toRow(record: SubagentExecutionRecord): SubagentExecutionRow {
  return {
    executionId: record.executionId,
    status: record.status,
    assignedFiles: record.assignedFiles,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    overlapError: record.overlapError,
    waitSummary: record.waitSummary,
  };
}

export function useSubagentExecutionRows(
  events: readonly WorkflowTelemetryEvent[],
): SubagentExecutionRow[] {
  return useMemo(
    () => parseSubagentExecutions(events).map(toRow),
    [events],
  );
}