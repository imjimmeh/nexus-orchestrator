import { useQuery } from "@tanstack/react-query";
import type { ProviderCooldownStatus } from "@nexus/core";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

export function useProviderCooldownStatus() {
  return useQuery<ProviderCooldownStatus[]>({
    queryKey: queryKeys.providerCooldownStatus(),
    queryFn: () => api.getProviderCooldowns(),
    refetchInterval: 30_000,
  });
}
