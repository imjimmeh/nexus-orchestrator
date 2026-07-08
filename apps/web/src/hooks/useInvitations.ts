// apps/web/src/hooks/useInvitations.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type { CreateInvitationDto } from "@/lib/api/client.invitations.types";

export function useInvitations(scopeNodeId: string) {
  return useQuery({
    queryKey: queryKeys.invitations.atNode(scopeNodeId),
    queryFn: () => api.getInvitations(scopeNodeId),
    enabled: !!scopeNodeId,
    staleTime: 30_000,
  });
}

export function useCreateInvitation(scopeNodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateInvitationDto) =>
      api.createInvitation(scopeNodeId, dto),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: queryKeys.invitations.atNode(scopeNodeId),
      }),
  });
}

export function useRevokeInvitation(scopeNodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: queryKeys.invitations.atNode(scopeNodeId),
      }),
  });
}
