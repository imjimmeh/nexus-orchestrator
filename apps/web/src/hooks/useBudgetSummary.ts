import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type { BudgetSummaryParams } from "@/lib/api/client.budget.types";

export function useBudgetSummary(params?: BudgetSummaryParams) {
  return useQuery({
    queryKey: queryKeys.budget.summary(params),
    queryFn: () => api.fetchBudgetSummary(params),
  });
}
