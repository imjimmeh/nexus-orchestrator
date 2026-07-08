// apps/web/src/hooks/useEnforcementMode.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type { EnforcementMode } from "@/lib/api/client.authz.types";

export function useEnforcementModes() {
  return useQuery({
    queryKey: queryKeys.authz.enforcementModes(),
    queryFn: () => api.getEnforcementModes(),
    staleTime: 60_000,
  });
}

export function useSetEnforcementMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      resource,
      mode,
    }: {
      resource: string;
      mode: EnforcementMode;
    }) => api.setEnforcementMode(resource, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.authz.enforcementModes(),
      });
    },
  });
}
