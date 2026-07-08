import { isTerminalWorkflowRunStatus } from "@nexus/core";
import type { CoreWorkflowEventEnvelopeV1Shape } from "@nexus/core";
import type { ContinuationTrigger } from "../orchestration/orchestration-continuation.types";

type RunEventContext = CoreWorkflowEventEnvelopeV1Shape["payload"]["context"];
import type {
  TerminalWorkflowStatus,
  TerminalWorkItemRunKind,
} from "./core-lifecycle-stream.types";

export type { TerminalWorkflowStatus, TerminalWorkItemRunKind };

export function isRealWorkItemId(value: string | undefined): value is string {
  return value !== undefined && value !== "__orchestration_lifecycle__";
}

export function readWorkItemId(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  if (typeof metadata?.work_item_id === "string") {
    return metadata.work_item_id;
  }

  return typeof metadata?.workItemId === "string"
    ? metadata.workItemId
    : undefined;
}

/**
 * Resolves the owning project id from a run lifecycle event context. Work-item
 * dispatch sets `scopeId` to the project id; orchestration-cycle runs fall back
 * to `contextId` when no scope is present.
 */
export function resolveProjectIdFromContext(
  context: RunEventContext,
): string | undefined {
  return context?.scopeId ?? context?.contextId ?? undefined;
}

/**
 * Resolves the work item id a run belongs to. The dispatch trigger conveys the
 * work item id via `contextId` (with `scopeId` = project id), while other call
 * sites carry it in `metadata.work_item_id`. Prefer the explicit metadata id and
 * fall back to `contextId` when it is distinct from the resolved project id.
 */
export function resolveWorkItemIdFromContext(
  context: RunEventContext,
): string | undefined {
  const metadataWorkItemId = readWorkItemId(context?.metadata);
  if (metadataWorkItemId) {
    return metadataWorkItemId;
  }

  const projectId = resolveProjectIdFromContext(context);
  return context?.contextId && context.contextId !== projectId
    ? context.contextId
    : undefined;
}

export function toFields(rawFields: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (let index = 0; index < rawFields.length; index += 2) {
    fields[rawFields[index]] = rawFields[index + 1];
  }
  return fields;
}

export function shouldStopAfterStaleLink(
  workItemRunKind: TerminalWorkItemRunKind,
  staleLinkCleared: boolean | undefined,
): boolean {
  return workItemRunKind === "other" && staleLinkCleared === false;
}

export function resolveContinuationTrigger(
  terminalStatus: TerminalWorkflowStatus,
  workItemRunKind: TerminalWorkItemRunKind,
): ContinuationTrigger {
  if (workItemRunKind === "completed_work_item") {
    return "work_item_completed";
  }

  return terminalStatus === "COMPLETED"
    ? "workflow_completed"
    : "workflow_failed";
}

export function classifyTerminalWorkItemRun(
  terminalStatus: TerminalWorkflowStatus,
  workItemId: string | undefined,
): TerminalWorkItemRunKind {
  if (!isRealWorkItemId(workItemId)) {
    return "other";
  }

  return terminalStatus === "COMPLETED"
    ? "completed_work_item"
    : "failed_work_item";
}

export function toTerminalWorkflowStatus(
  status: string,
): TerminalWorkflowStatus | undefined {
  return isTerminalWorkflowRunStatus(status)
    ? (status as TerminalWorkflowStatus)
    : undefined;
}

export function readPollIntervalMs(defaultMs: number): number {
  const value = Number(process.env.KANBAN_CORE_LIFECYCLE_POLL_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : defaultMs;
}
