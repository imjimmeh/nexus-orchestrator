import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ToolsQueryParams } from "@nexus/core";
import { api } from "@/lib/api/client";
import { createCrudHooks } from "./lib/createCrudHooks";
import { queryKeys } from "@/lib/queryKeys";
import { CreateToolCandidateRequest, CreateToolRequest, Tool, UpdateToolRequest } from "@/lib/api/tools.types";

export type { ToolsQueryParams } from "@nexus/core";

// CRUD hooks via factory
// Note: getAll is a dummy — useTools/useToolsPaged have custom list logic
const crud = createCrudHooks<Tool, CreateToolRequest, UpdateToolRequest>(
  queryKeys.adminResources.tools,
  {
    getAll: async () => {
      const result = await api.getTools({ limit: 500 });
      return result.data;
    },
    getOne: (id) => api.getTool(id),
    create: (data) => api.createTool(data),
    update: (id, data) => api.updateTool(id, data),
    remove: (id) => api.deleteTool(id),
  },
);

// Custom list hooks (non-standard — need params wrapping)
export function useTools(params?: ToolsQueryParams) {
  return useQuery({
    queryKey: queryKeys.adminResources.tools.all(params),
    queryFn: () =>
      api.getTools(params ? { limit: 500, ...params } : { limit: 500 }),
  });
}

export function useToolsPaged(params: ToolsQueryParams) {
  return useQuery({
    queryKey: queryKeys.adminResources.tools.paged(params),
    queryFn: () => api.getTools(params),
  });
}

export const useTool = crud.useOne;
export const useCreateTool = crud.useCreate;
export const useUpdateTool = crud.useUpdate;
export const useDeleteTool = crud.useRemove;

// Tool candidate hooks (non-CRUD — kept as-is)
export function useToolCandidates(params?: {
  limit?: number;
  offset?: number;
  status?: "draft" | "validated" | "published" | "failed";
  tool_name?: string;
}) {
  return useQuery({
    queryKey: queryKeys.adminResources.tools.candidates(params),
    queryFn: () => api.getToolCandidates(params),
  });
}

export function useToolCandidate(id?: string) {
  return useQuery({
    queryKey: queryKeys.adminResources.tools.candidates({ id }),
    queryFn: () => {
      if (!id) {
        throw new Error("Tool candidate id is required");
      }
      return api.getToolCandidate(id);
    },
    enabled: !!id,
  });
}

export function useToolCandidateValidationRuns(
  id?: string,
  params?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: queryKeys.adminResources.tools.candidateValidationRuns(id ?? ""),
    queryFn: () => {
      if (!id) {
        throw new Error("Tool candidate id is required");
      }
      return api.getToolCandidateValidationRuns(id, params);
    },
    enabled: !!id,
  });
}

export function useCreateToolCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateToolCandidateRequest) =>
      api.createToolCandidate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.tools.candidates(),
      });
    },
  });
}

export function useValidateToolCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.validateToolCandidate(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.tools.candidates(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.tools.candidates({ id }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.tools.candidateValidationRuns(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.tools.all(),
      });
    },
  });
}

export function usePublishToolCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.publishToolCandidate(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.tools.candidates(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.tools.candidates({ id }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.tools.all(),
      });
    },
  });
}
