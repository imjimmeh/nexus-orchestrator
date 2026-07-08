import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { ProjectOrchestrationStatus } from "@/lib/api/projects.types";

interface ProjectIdentity {
  id: string;
}

export function useProjectOrchestrationSummaries(projects: ProjectIdentity[]) {
  const orchestrationQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["project-orchestration", project.id, "state"] as const,
      queryFn: () => api.getProjectOrchestrationState(project.id),
      enabled: projects.length > 0,
      refetchInterval: 30_000,
      staleTime: 15_000,
    })),
  });

  const orchestrationByProjectId = useMemo(() => {
    const map = new Map<
      string,
      { status: ProjectOrchestrationStatus } | null
    >();

    for (let index = 0; index < projects.length; index += 1) {
      const project = projects[index];
      const query = orchestrationQueries[index];
      map.set(project.id, query?.data?.orchestration ?? null);
    }

    return map;
  }, [projects, orchestrationQueries]);

  return {
    orchestrationByProjectId,
    isLoading: orchestrationQueries.some((query) => query.isLoading),
  };
}
