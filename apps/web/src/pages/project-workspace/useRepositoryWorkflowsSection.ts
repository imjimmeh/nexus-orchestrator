import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type { RepositoryWorkflowsState } from "./SettingsTab.hooks.types";

export function useRepositoryWorkflowsSection(
  projectId: string,
): RepositoryWorkflowsState {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: queryKeys.projects.repositoryWorkflowSettings(projectId),
    queryFn: () => api.getProjectRepositoryWorkflowSettings(projectId),
  });

  const updateMutation = useMutation({
    mutationFn: (data: {
      enabled?: boolean;
      overrides?: Record<string, { enabled: boolean }>;
    }) => api.updateProjectRepositoryWorkflowSettings(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.repositoryWorkflowSettings(projectId),
      });
    },
  });

  return {
    enabled: settingsQuery.data?.enabled ?? false,
    overrides: settingsQuery.data?.overrides ?? {},
    isLoading: settingsQuery.isLoading,
    toggleEnabled: (value) => updateMutation.mutate({ enabled: value }),
    toggleOverride: (workflowId, enabled) =>
      updateMutation.mutate({
        overrides: { [workflowId]: { enabled } },
      }),
  };
}
