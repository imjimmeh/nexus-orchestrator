import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

export function useWorkItemCostEstimate(
  projectId: string | undefined,
  workItemId: string | undefined,
) {
  const enabled = Boolean(projectId) && Boolean(workItemId);

  return useQuery({
    queryKey: queryKeys.budget.workItemCostEstimate(
      projectId ?? "",
      workItemId ?? "",
    ),
    queryFn: () => {
      if (!projectId || !workItemId) {
        throw new Error("Project and work item ids are required.");
      }

      return api.getWorkItemCostEstimate(projectId, workItemId);
    },
    enabled,
  });
}
