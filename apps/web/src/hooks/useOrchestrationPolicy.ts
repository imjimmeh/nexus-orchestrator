import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  applyOrchestrationPreset,
  getOrchestrationPolicy,
  updateOrchestrationPolicy,
  type OrchestrationMode,
} from "@/lib/api/client.orchestration-policy";

export function useOrchestrationPolicy(projectId: string) {
  return useQuery({
    queryKey: queryKeys.orchestrationPolicy.detail(projectId),
    queryFn: () => getOrchestrationPolicy(projectId),
    enabled: !!projectId,
  });
}

export function useUpdateOrchestrationPolicy(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries: Array<{ key: string; value: unknown }>) =>
      updateOrchestrationPolicy(projectId, entries),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.orchestrationPolicy.detail(projectId),
      }),
  });
}

export function useApplyOrchestrationPreset(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: OrchestrationMode) =>
      applyOrchestrationPreset(projectId, mode),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.orchestrationPolicy.detail(projectId),
      }),
  });
}
