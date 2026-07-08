import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { StartupRoutingHints, StartupRoutingReadinessContext, StartupRoutingSourceContext } from "@/lib/api/orchestration.types";
import { ProjectOrchestration, ProjectOrchestrationActionRequest, ProjectOrchestrationMode } from "@/lib/api/projects.types";

const PROJECT_ORCHESTRATION_QUERY_KEY = "project-orchestration";

function orchestrationStateKey(projectId?: string) {
  return [PROJECT_ORCHESTRATION_QUERY_KEY, projectId, "state"] as const;
}

export function useProjectOrchestrationState(projectId?: string) {
  return useQuery({
    queryKey: orchestrationStateKey(projectId),
    queryFn: () => {
      if (!projectId) {
        throw new Error("projectId is required");
      }

      return api.getProjectOrchestrationState(projectId);
    },
    enabled: !!projectId,
    refetchInterval: 10_000,
  });
}

function updateOrchestrationStateCache(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  orchestration: ProjectOrchestration,
) {
  queryClient.setQueryData(
    orchestrationStateKey(projectId),
    (
      current: {
        projectState?: {
          projectId: string;
          totalCount: number;
          activeCount: number;
          groupedByStatus: Record<string, unknown>;
        };
        pendingActionRequests?: ProjectOrchestrationActionRequest[];
      } | null,
    ) => ({
      orchestration,
      projectState: current?.projectState ?? {
        projectId,
        totalCount: 0,
        activeCount: 0,
        groupedByStatus: {},
      },
      pendingActionRequests: current?.pendingActionRequests ?? [],
    }),
  );
}

function orchestrationInvalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
) {
  return queryClient.invalidateQueries({
    queryKey: orchestrationStateKey(projectId),
  });
}

export function useStartProjectOrchestration(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      goals?: string;
      orchestrationMode?: ProjectOrchestrationMode;
      sourceContext?: StartupRoutingSourceContext;
      readinessContext?: StartupRoutingReadinessContext;
      startupHints?: StartupRoutingHints;
    }) => api.startProjectOrchestration(projectId, params),
    onSuccess: async (orchestration) => {
      updateOrchestrationStateCache(queryClient, projectId, orchestration);
      await orchestrationInvalidate(queryClient, projectId);
    },
  });
}

export function useUpdateProjectOrchestrationMode(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mode: ProjectOrchestrationMode) =>
      api.updateProjectOrchestrationMode(projectId, mode),
    onSuccess: async (orchestration) => {
      updateOrchestrationStateCache(queryClient, projectId, orchestration);
      await orchestrationInvalidate(queryClient, projectId);
    },
  });
}

export function useApproveProjectOrchestration(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.approveProjectOrchestration(projectId),
    onSuccess: async (orchestration) => {
      updateOrchestrationStateCache(queryClient, projectId, orchestration);
      await orchestrationInvalidate(queryClient, projectId);
    },
  });
}

export function useRejectProjectOrchestration(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (feedback: string) =>
      api.rejectProjectOrchestration(projectId, feedback),
    onSuccess: async (orchestration) => {
      updateOrchestrationStateCache(queryClient, projectId, orchestration);
      await orchestrationInvalidate(queryClient, projectId);
    },
  });
}

export function usePauseProjectOrchestration(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.pauseProjectOrchestration(projectId),
    onSuccess: async (orchestration) => {
      updateOrchestrationStateCache(queryClient, projectId, orchestration);
      await orchestrationInvalidate(queryClient, projectId);
    },
  });
}

export function useResumeProjectOrchestration(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.resumeProjectOrchestration(projectId),
    onSuccess: async (orchestration) => {
      updateOrchestrationStateCache(queryClient, projectId, orchestration);
      await orchestrationInvalidate(queryClient, projectId);
    },
  });
}

export function useRecoverImportedHydrationProjectOrchestration(
  projectId: string,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api.recoverImportedHydrationProjectOrchestration(projectId),
    onSuccess: async (orchestration) => {
      updateOrchestrationStateCache(queryClient, projectId, orchestration);
      await Promise.all([
        orchestrationInvalidate(queryClient, projectId),
        queryClient.invalidateQueries({
          queryKey: queryKeys.projectOrchestration.diagnostics(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRuns.list({ projectId }),
        }),
      ]);
    },
  });
}

export function useCompleteProjectOrchestration(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.completeProjectOrchestration(projectId),
    onSuccess: async (orchestration) => {
      updateOrchestrationStateCache(queryClient, projectId, orchestration);
      await orchestrationInvalidate(queryClient, projectId);
    },
  });
}

export function useApproveProjectOrchestrationAction(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { actionRequestId: string; approvedBy?: string }) =>
      api.approveProjectOrchestrationAction(
        projectId,
        params.actionRequestId,
        params.approvedBy,
      ),
    onSuccess: async (_actionRequest: ProjectOrchestrationActionRequest) => {
      await orchestrationInvalidate(queryClient, projectId);
    },
  });
}

export function useRejectProjectOrchestrationAction(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      actionRequestId: string;
      reason: string;
      rejectedBy?: string;
    }) => api.rejectProjectOrchestrationAction(projectId, params),
    onSuccess: async (_actionRequest: ProjectOrchestrationActionRequest) => {
      await orchestrationInvalidate(queryClient, projectId);
    },
  });
}

export function useResetProjectOrchestrationIntents(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.resetProjectOrchestrationIntents(projectId),
    onSuccess: async (result) => {
      await orchestrationInvalidate(queryClient, projectId);
      return result;
    },
  });
}
