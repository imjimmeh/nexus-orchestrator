// apps/web/src/hooks/useScopeMembers.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

export function useScopeMembers(scopeNodeId: string) {
  return useQuery({
    queryKey: queryKeys.scope.members(scopeNodeId),
    queryFn: () => api.getScopeMembers(scopeNodeId),
    enabled: !!scopeNodeId,
    staleTime: 30_000,
  });
}

export function useRevokeScopeMember(scopeNodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { userId: string; roleId: string }) =>
      api.revokeMemberRole(scopeNodeId, dto),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scope.members(scopeNodeId),
      }),
  });
}
