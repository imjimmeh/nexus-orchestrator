import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { CreateMcpServerRequest, UpdateMcpServerRequest } from "@/lib/api/mcp.types";

export function useMcpServers() {
  return useQuery({
    queryKey: queryKeys.mcp.servers(),
    queryFn: () => api.getMcpServers(),
  });
}

export function useCreateMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMcpServerRequest) => api.createMcpServer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers() });
    },
  });
}

export function useUpdateMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMcpServerRequest }) =>
      api.updateMcpServer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers() });
    },
  });
}

export function useDeleteMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteMcpServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers() });
    },
  });
}

export function useTestMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.testMcpServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers() });
    },
  });
}

export function useReloadMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.reloadMcpServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers() });
    },
  });
}

export function useReloadMcpServers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.reloadMcpServers(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers() });
    },
  });
}
