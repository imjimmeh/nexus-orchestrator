import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type { BudgetSummaryParams } from "@/lib/api/client.budget.types";

export function useBudgetTimeline(params?: BudgetSummaryParams) {
  return useQuery({
    queryKey: queryKeys.budget.timeline(params),
    queryFn: () => api.fetchBudgetTimeline(params),
  });
}
