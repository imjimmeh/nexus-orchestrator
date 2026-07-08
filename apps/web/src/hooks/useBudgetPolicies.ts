import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type {
  BudgetPolicy,
  CreateBudgetPolicyRequest,
  ListBudgetPoliciesParams,
  UpdateBudgetPolicyRequest,
} from "@/lib/api/client.budget.types";

export function useBudgetPolicies(params?: ListBudgetPoliciesParams) {
  return useQuery<BudgetPolicy[]>({
    queryKey: queryKeys.budget.policies.all(
      params as Record<string, unknown> | undefined,
    ),
    queryFn: () => api.fetchPolicies(params),
  });
}

export function useCreateBudgetPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateBudgetPolicyRequest) => api.createPolicy(data),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.budget.policies.all(),
      }),
  });
}

export function useUpdateBudgetPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateBudgetPolicyRequest;
    }) => api.updatePolicy(id, data),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.budget.policies.all(),
      }),
  });
}

export function useDisableBudgetPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.disablePolicy(id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.budget.policies.all(),
      }),
  });
}
