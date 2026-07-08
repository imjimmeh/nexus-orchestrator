import { EventLedgerRecord } from "@/lib/api/event-ledger.types";
import type { WorkflowSubagentExecutionSummary } from "./useWorkflowSubagentExecutions.types";
import { asRecord } from "@/lib/deep-paths";
import {
  asString,
  normalizeStatusFromEvent,
} from "./useWorkflowSubagentExecutions.status";

export function foldSubagentLifecycleEvents(
  lifecycleEvents: EventLedgerRecord[],
): Map<string, WorkflowSubagentExecutionSummary> {
  const byExecutionId = new Map<string, WorkflowSubagentExecutionSummary>();

  // The event ledger API returns newest first (DESC).
  // Process oldest first (ASC) so newer events overwrite older ones in the map.
  const events = [...lifecycleEvents].reverse();

  for (const event of events) {
    const executionId = asString(event.subagent_execution_id);
    if (!executionId) {
      continue;
    }

    const payload = asRecord(event.payload);
    const current = byExecutionId.get(executionId);
    const nextStatus = normalizeStatusFromEvent(event, payload);
    const nextChildContainerId =
      asString(payload?.child_container_id) ??
      current?.childContainerId ??
      null;
    const nextSubagentChatSessionId =
      asString(payload?.subagent_chat_session_id) ??
      asString(payload?.subagentChatSessionId) ??
      current?.subagentChatSessionId ??
      null;

    byExecutionId.set(executionId, {
      id: executionId,
      status: nextStatus,
      lastEventName: event.event_name,
      lastEventAt: event.occurred_at,
      childContainerId: nextChildContainerId,
      ...(nextSubagentChatSessionId
        ? { subagentChatSessionId: nextSubagentChatSessionId }
        : {}),
    });
  }

  return byExecutionId;
}
