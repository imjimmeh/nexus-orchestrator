import { api } from "@/lib/api/client";
import { useQuery } from "@tanstack/react-query";
import { createCrudHooks } from "./lib/createCrudHooks";
import { queryKeys } from "@/lib/queryKeys";
import { PaginatedResponse } from "@/lib/api/common.types";
import { CreateModelRequest, LLMModel, ListModelsParams, UpdateModelRequest } from "@/lib/api/models.types";
import { ModelPreset } from "@/lib/api/presets.types";

const { useList, useOne, useCreate, useUpdate, useRemove } = createCrudHooks<
  LLMModel,
  CreateModelRequest,
  UpdateModelRequest
>(queryKeys.adminResources.models, {
  getAll: () => api.getModels(),
  getOne: (id) => api.getModel(id),
  create: (data) => api.createModel(data),
  update: (id, data) => api.updateModel(id, data),
  remove: (id) => api.deleteModel(id),
});

export const useModels = useList;
export const useModel = useOne;
export const useCreateModel = useCreate;
export const useUpdateModel = useUpdate;
export const useDeleteModel = useRemove;

export function useModelPresets() {
  return useQuery<ModelPreset[]>({
    queryKey: [...queryKeys.adminResources.models.all(), "presets"],
    queryFn: () => api.getModelPresets(),
    staleTime: 300_000,
  });
}

export function useModelsPaginated(params: ListModelsParams = {}) {
  return useQuery<PaginatedResponse<LLMModel>>({
    queryKey: queryKeys.adminResources.models.all(
      params as Record<string, unknown>,
    ),
    queryFn: () => api.getModelsPage(params),
    staleTime: 30_000,
  });
}
