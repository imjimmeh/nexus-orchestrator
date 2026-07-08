import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

export function useWorkItemCostSummary(params?: {
  limit?: number;
  projectId?: string;
}) {
  return useQuery({
    queryKey: queryKeys.budget.workItemCostSummary(params),
    queryFn: () => api.getWorkItemCostSummary(params),
  });
}
