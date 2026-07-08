import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { WorkflowRunStatus } from "@/lib/api/common.types";
import { CreateWorkflowRequest, ExecuteWorkflowRequest, ListWorkflowsParams, UpdateWorkflowRequest } from "@/lib/api/workflow-launch.types";
import { WorkflowLifecycleResult, WorkflowLifecycleResultsQuery, WorkflowRunAutonomyDiagnostics, WorkflowRunRetrospectiveTrace } from "@/lib/api/workflow-lifecycle.types";
import { UpdateWorkflowRunTodoListRequest, WorkflowRunTodoList } from "@/lib/api/workflow-todos.types";
import { ExecutionSummary, WorkflowRun, WorkflowRunsQuery } from "@/lib/api/workflows.types";
import { queryKeys } from "@/lib/queryKeys";

export function getAutonomyDiagnosticsRefetchInterval(
  status: WorkflowRunStatus | undefined,
): 2000 | false {
  return status === "PENDING" || status === "RUNNING" || status === "FAILED"
    ? 2000
    : false;
}

export const WORKFLOW_NAME_CATALOG_QUERY = {
  limit: 100,
  includeInactive: true,
} satisfies ListWorkflowsParams;

export function useWorkflows(params?: ListWorkflowsParams) {
  return useQuery({
    queryKey: queryKeys.workflows.all(params),
    queryFn: async () => {
      return api.getWorkflows(params);
    },
  });
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: queryKeys.workflows.detail(id),
    queryFn: () => api.getWorkflow(id),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWorkflowRequest) => api.createWorkflow(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all() });
    },
  });
}

export function useUpdateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWorkflowRequest }) =>
      api.updateWorkflow(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.detail(variables.id),
      });
    },
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkflow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all() });
    },
  });
}

interface ExecuteWorkflowVariables {
  id: string;
  request?: ExecuteWorkflowRequest;
  projectId?: string;
}

export function useExecuteWorkflow() {
  const queryClient = useQueryClient();
  return useMutation<{ runId: string }, Error, ExecuteWorkflowVariables>({
    mutationFn: (variables: ExecuteWorkflowVariables) => {
      if (variables.projectId) {
        return api.executeProjectScopedWorkflow(
          variables.projectId,
          variables.id,
          variables.request,
        );
      }

      return api.executeWorkflow(variables.id, variables.request);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflowRuns.list(),
      });
    },
  });
}

export function useWorkflowRuns(query: WorkflowRunsQuery = {}) {
  return useQuery({
    queryKey: queryKeys.workflowRuns.list(query),
    queryFn: async (): Promise<WorkflowRun[]> => {
      const response = await api.getWorkflowRuns(query);
      if (Array.isArray(response)) {
        return response;
      }

      if (
        response &&
        typeof response === "object" &&
        "data" in response &&
        Array.isArray(response.data)
      ) {
        return response.data;
      }

      return [];
    },
    enabled: query.workflowId ? !!query.workflowId : true,
    refetchInterval:
      "refetchIntervalMs" in query &&
      typeof query.refetchIntervalMs === "number"
        ? query.refetchIntervalMs
        : false,
  });
}

export function useWorkflowRun(runId: string) {
  return useQuery<WorkflowRun, Error>({
    queryKey: queryKeys.workflowRuns.detail(runId),
    queryFn: () => api.getWorkflowRun(runId),
    enabled: !!runId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "RUNNING" || data?.status === "PENDING") {
        return 2000;
      }
      return false;
    },
  });
}

export function useWorkflowLifecycleResults(
  query: WorkflowLifecycleResultsQuery | null,
) {
  return useQuery<WorkflowLifecycleResult[], Error>({
    queryKey: queryKeys.workflowRuns.lifecycleResults(query ?? { scopeId: "" }),
    queryFn: () =>
      query ? api.getWorkflowLifecycleResults(query) : Promise.resolve([]),
    enabled: Boolean(query?.scopeId),
  });
}

export function useWorkflowRunExecutions(
  runId: string,
  status?: WorkflowRunStatus,
) {
  return useQuery<ExecutionSummary[], Error>({
    queryKey: queryKeys.workflowRuns.executions(runId),
    queryFn: () => api.listRunExecutions(runId),
    enabled: !!runId,
    refetchInterval: getAutonomyDiagnosticsRefetchInterval(status),
  });
}

export function useWorkflowRunAutonomyDiagnostics(
  runId: string,
  status?: WorkflowRunStatus,
) {
  return useQuery<WorkflowRunAutonomyDiagnostics, Error>({
    queryKey: queryKeys.workflowRuns.autonomyDiagnostics(runId),
    queryFn: () => api.getWorkflowRunAutonomyDiagnostics(runId),
    enabled: !!runId,
    refetchInterval: getAutonomyDiagnosticsRefetchInterval(status),
  });
}

export function useWorkflowRunRetrospectiveTrace(runId: string) {
  return useQuery<WorkflowRunRetrospectiveTrace, Error>({
    queryKey: queryKeys.workflowRuns.retrospectiveTrace(runId),
    queryFn: () => api.getWorkflowRunRetrospectiveTrace(runId),
    enabled: !!runId,
  });
}

export function useWorkflowRunTodoList(runId: string) {
  return useQuery<WorkflowRunTodoList, Error>({
    queryKey: queryKeys.workflowRuns.todoList(runId),
    queryFn: () => api.getWorkflowRunTodoList(runId),
    enabled: !!runId,
  });
}

export function useUpdateWorkflowRunTodoList(runId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateWorkflowRunTodoListRequest) =>
      api.updateWorkflowRunTodoList(runId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflowRuns.todoList(runId),
      });
    },
  });
}
