import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { WorkflowRunGraph } from "@/lib/api/workflows.types";
import { queryKeys } from "@/lib/queryKeys";

interface UseWorkflowRunGraphParams {
  workflowId: string;
  runId?: string;
}

const ACTIVE_RUN_STATUSES = new Set(["RUNNING", "PENDING"]);

export function useWorkflowRunGraph({
  workflowId,
  runId,
}: UseWorkflowRunGraphParams) {
  const runGraphQuery = useQuery<WorkflowRunGraph, Error>({
    queryKey: queryKeys.workflowRuns.graph(runId ?? ""),
    queryFn: () => api.getWorkflowRunGraph(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.runStatus;
      if (status && ACTIVE_RUN_STATUSES.has(status)) {
        return 2000;
      }

      return false;
    },
  });

  const staticGraphQuery = useQuery<WorkflowRunGraph, Error>({
    queryKey: queryKeys.workflowGraphs.workflow(workflowId),
    queryFn: () => api.getWorkflowGraph(workflowId),
    enabled: Boolean(workflowId) && !runId,
  });

  if (runId) {
    return runGraphQuery;
  }

  return staticGraphQuery;
}
