import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FallbackChain, FallbackChainEntry } from "@nexus/core";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

export function useGlobalFallbackChain() {
  return useQuery<FallbackChain>({
    queryKey: queryKeys.fallbackChains.global(),
    queryFn: () => api.getGlobalFallbackChain(),
  });
}

export function useSetGlobalFallbackChain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries: FallbackChainEntry[]) =>
      api.setGlobalFallbackChain(entries),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.fallbackChains.global(),
      }),
  });
}
