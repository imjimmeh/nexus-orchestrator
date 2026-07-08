import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { EventLedgerRecord } from "@/lib/api/event-ledger.types";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { foldSubagentLifecycleEvents } from "./useWorkflowSubagentExecutions.lifecycle-pass";
import { applySubagentTelemetryPass } from "./useWorkflowSubagentExecutions.telemetry-pass";
import type { WorkflowSubagentExecutionSummary } from "./useWorkflowSubagentExecutions.types";

const SUBAGENT_EVENT_LIMIT = 500;

interface WorkflowSubagentExecutionData {
  lifecycleEvents: EventLedgerRecord[];
  telemetryEvents: WorkflowTelemetryEvent[];
}

export function summarizeWorkflowSubagentExecutions({
  lifecycleEvents,
  telemetryEvents = [],
}: Readonly<{
  lifecycleEvents: EventLedgerRecord[];
  telemetryEvents?: WorkflowTelemetryEvent[];
}>): WorkflowSubagentExecutionSummary[] {
  const byExecutionId = foldSubagentLifecycleEvents(lifecycleEvents);
  applySubagentTelemetryPass(telemetryEvents, byExecutionId);

  return Array.from(byExecutionId.values()).sort(
    (left, right) =>
      new Date(right.lastEventAt).getTime() -
      new Date(left.lastEventAt).getTime(),
  );
}

function normalizeQueryData(
  data: WorkflowSubagentExecutionData | EventLedgerRecord[] | undefined,
): WorkflowSubagentExecutionData {
  if (Array.isArray(data)) {
    return { lifecycleEvents: data, telemetryEvents: [] };
  }

  return {
    lifecycleEvents: data?.lifecycleEvents ?? [],
    telemetryEvents: data?.telemetryEvents ?? [],
  };
}

export function useWorkflowSubagentExecutions(workflowRunId?: string) {
  const query = useQuery({
    queryKey: queryKeys.workflowRuns.subagentExecutions(workflowRunId ?? ""),
    enabled: Boolean(workflowRunId),
    refetchInterval: workflowRunId ? 3000 : false,
    queryFn: async () => {
      if (!workflowRunId) {
        return { lifecycleEvents: [], telemetryEvents: [] };
      }

      const [page, telemetryEvents] = await Promise.all([
        api.getEventLedger({
          workflowRunId,
          domain: "subagent",
          limit: SUBAGENT_EVENT_LIMIT,
          offset: 0,
        }),
        api.getWorkflowRunEvents(workflowRunId),
      ]);

      return { lifecycleEvents: page.data, telemetryEvents };
    },
  });

  const executions = useMemo<WorkflowSubagentExecutionSummary[]>(() => {
    return summarizeWorkflowSubagentExecutions(normalizeQueryData(query.data));
  }, [query.data]);

  return {
    executions,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
