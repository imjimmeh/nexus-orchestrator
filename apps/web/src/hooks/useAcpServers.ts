import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { CreateAcpServerRequest, UpdateAcpServerRequest } from "@/lib/api/acp.types";

export function useAcpServers() {
  return useQuery({
    queryKey: queryKeys.acp.servers(),
    queryFn: () => api.getAcpServers(),
  });
}

export function useCreateAcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateAcpServerRequest) => api.createAcpServer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.acp.servers() });
    },
  });
}

export function useUpdateAcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAcpServerRequest }) =>
      api.updateAcpServer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.acp.servers() });
    },
  });
}

export function useDeleteAcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteAcpServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.acp.servers() });
    },
  });
}

export function useTestAcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.testAcpServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.acp.servers() });
    },
  });
}

export function useReloadAcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.reloadAcpServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.acp.servers() });
    },
  });
}

export function useReloadAcpServers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.reloadAcpServers(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.acp.servers() });
    },
  });
}

export function useAcpDiscoveredAgents(serverId: string) {
  return useQuery({
    queryKey: queryKeys.acp.discoveredAgents(serverId),
    queryFn: () => api.listAcpDiscoveredAgents(serverId),
    enabled: !!serverId,
  });
}
