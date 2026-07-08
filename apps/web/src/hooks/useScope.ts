// apps/web/src/hooks/useScope.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type {
  CreateScopeNodeDto,
  MoveScopeNodeDto,
  UpdateScopeNodeDto,
} from "@/lib/api/client.scope.types";

export function useScopeTree() {
  return useQuery({
    queryKey: queryKeys.scope.tree(),
    queryFn: () => api.getScopeTree(),
    staleTime: 30_000,
  });
}

export function useScopeNode(id: string) {
  return useQuery({
    queryKey: queryKeys.scope.node(id),
    queryFn: () => api.getScopeNode(id),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useCreateScopeNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateScopeNodeDto) => api.createScopeNode(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scope.tree() });
    },
  });
}

export function useUpdateScopeNode(scopeNodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateScopeNodeDto) =>
      api.updateScopeNode(scopeNodeId, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scope.tree() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scope.node(scopeNodeId),
      });
    },
  });
}

export function useMoveScopeNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: string } & MoveScopeNodeDto) =>
      api.moveScopeNode(id, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scope.tree() });
    },
  });
}

export function useArchiveScopeNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveScopeNode(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scope.tree() });
    },
  });
}

export function useAllowedChildTypes(scopeNodeId: string) {
  return useQuery({
    queryKey: queryKeys.scope.allowedChildTypes(scopeNodeId),
    queryFn: () => api.getAllowedChildTypes(scopeNodeId),
    enabled: !!scopeNodeId,
  });
}
