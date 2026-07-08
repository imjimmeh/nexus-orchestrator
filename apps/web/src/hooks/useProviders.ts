import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { createCrudHooks } from "./lib/createCrudHooks";
import { queryKeys } from "@/lib/queryKeys";
import { PaginatedResponse, ProviderOAuthAuthorizeRequest, ProviderOAuthCallbackRequest, ProviderOAuthStatus } from "@/lib/api/common.types";
import { ProviderPreset } from "@/lib/api/presets.types";
import { CreateProviderRequest, LLMProvider, ListProvidersParams, UpdateProviderRequest } from "@/lib/api/providers.types";

const { useList, useOne, useCreate, useUpdate, useRemove } = createCrudHooks<
  LLMProvider,
  CreateProviderRequest,
  UpdateProviderRequest,
  ListProvidersParams
>(queryKeys.adminResources.providers, {
  getAll: (params) => api.getProviders(params),
  getOne: (id) => api.getProvider(id),
  create: (data) => api.createProvider(data),
  update: (id, data) => api.updateProvider(id, data),
  remove: (id) => api.deleteProvider(id),
});

export const useProviders = useList;
export const useProvider = useOne;
export const useCreateProvider = useCreate;
export const useUpdateProvider = useUpdate;
export const useDeleteProvider = useRemove;

export function useProviderPresets() {
  return useQuery<ProviderPreset[]>({
    queryKey: [...queryKeys.adminResources.providers.all(), "presets"],
    queryFn: () => api.getProviderPresets(),
    staleTime: 300_000,
  });
}

export function useProvidersPaginated(params: ListProvidersParams = {}) {
  return useQuery<PaginatedResponse<LLMProvider>>({
    queryKey: queryKeys.adminResources.providers.all(
      params as Record<string, unknown>,
    ),
    queryFn: () => api.getProvidersPage(params),
    staleTime: 30_000,
  });
}

export function useProviderOAuthStatus(providerId: string) {
  return useQuery<ProviderOAuthStatus>({
    queryKey: queryKeys.adminResources.providers.oauthStatus(providerId),
    queryFn: () => api.getProviderOAuthStatus(providerId),
    enabled: !!providerId,
  });
}

export function useInitiateProviderOAuth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      providerId,
      data,
    }: {
      providerId: string;
      data: ProviderOAuthAuthorizeRequest;
    }) => api.initiateProviderOAuth(providerId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.providers.all(),
      });
    },
  });
}

export function useCompleteProviderOAuthCallback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProviderOAuthCallbackRequest) =>
      api.completeProviderOAuthCallback(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.providers.all(),
      });
    },
  });
}
