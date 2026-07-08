import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import {
  getScopedDefault,
  setScopedDefault,
} from "@/lib/api/harness-credentials-api";
import type {
  ScopedAiDefault,
  SetScopedDefaultRequest,
} from "@/lib/api/harness-credentials-api.types";

export function useScopedAiDefault(scopeNodeId?: string) {
  return useQuery<ScopedAiDefault>({
    queryKey: queryKeys.scopedAiDefaults.detail(scopeNodeId),
    queryFn: () => getScopedDefault(api, scopeNodeId),
  });
}

export function useSetScopedAiDefault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      scopeNodeId,
      body,
    }: {
      scopeNodeId: string;
      body: SetScopedDefaultRequest;
    }) => setScopedDefault(api, scopeNodeId, body),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scopedAiDefaults.detail(variables.scopeNodeId),
      });
    },
  });
}
