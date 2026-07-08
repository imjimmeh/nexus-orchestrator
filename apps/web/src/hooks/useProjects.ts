import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

const PROJECTS_QUERY_KEY = "projects";

export function useProjectList() {
  return useQuery({
    queryKey: [PROJECTS_QUERY_KEY],
    queryFn: () => api.getProjects(),
  });
}

export function useProject(projectId?: string) {
  return useQuery({
    queryKey: [PROJECTS_QUERY_KEY, projectId],
    queryFn: () => {
      if (!projectId) {
        throw new Error("projectId is required");
      }
      return api.getProject(projectId);
    },
    enabled: !!projectId,
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => api.deleteProject(projectId),
    onSuccess: (_data, projectId) => {
      queryClient.invalidateQueries({ queryKey: [PROJECTS_QUERY_KEY] });
      queryClient.removeQueries({ queryKey: [PROJECTS_QUERY_KEY, projectId] });
    },
  });
}
