// apps/web/src/hooks/useRoleAssignments.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type { CreateRoleAssignmentDto } from "@/lib/api/client.scope.types";

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.scope.roles(),
    queryFn: () => api.getRoles(),
    staleTime: 60_000,
  });
}

export function useAssignRole(scopeNodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateRoleAssignmentDto) =>
      api.assignRole(scopeNodeId, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scope.members(scopeNodeId),
      });
    },
  });
}
