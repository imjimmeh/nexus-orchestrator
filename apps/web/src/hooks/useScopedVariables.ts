import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  deleteVariable,
  getEffectiveVariables,
  listVariables,
  upsertVariable,
  type UpsertVariableBody,
} from "@/lib/api/client.variables";

export function useScopedVariables(scopeId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.variables.list(scopeId ?? null),
    queryFn: () => listVariables(scopeId),
    enabled: scopeId !== undefined,
  });
}

export function useEffectiveVariables(scopeId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.variables.effective(scopeId ?? null),
    queryFn: () => getEffectiveVariables(scopeId),
    enabled: scopeId !== undefined,
  });
}

export function useUpsertVariable(scopeId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertVariableBody) => upsertVariable(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.variables.list(scopeId ?? null),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.variables.effective(scopeId ?? null),
      });
    },
  });
}

export function useDeleteVariable(scopeId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deleteVariable(key, scopeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.variables.list(scopeId ?? null),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.variables.effective(scopeId ?? null),
      });
    },
  });
}
