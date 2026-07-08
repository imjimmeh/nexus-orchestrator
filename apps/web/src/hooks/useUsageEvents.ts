import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type { BudgetQueryParams } from "@/lib/api/client.budget.types";

export function useUsageEvents(params?: BudgetQueryParams) {
  return useQuery({
    queryKey: queryKeys.budget.usageEvents(params),
    queryFn: () => api.fetchUsageEvents(params),
  });
}
