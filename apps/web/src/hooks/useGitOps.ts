import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type {
  CreateGitOpsRepositoryBindingInput,
  GitOpsStatusResponse,
  UpdateGitOpsRepositoryBindingInput,
} from "@/lib/api/client.gitops.types";

interface BindingActionInput {
  scopeNodeId: string;
  bindingId: string;
}

interface UpdateBindingInput extends BindingActionInput {
  input: UpdateGitOpsRepositoryBindingInput;
}

function useInvalidateGitOpsQueries() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.gitops.status() });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.gitops.bindingsRoot(),
    });
  };
}

export function useGitOpsStatus() {
  return useQuery<GitOpsStatusResponse>({
    queryKey: queryKeys.gitops.status(),
    queryFn: () => api.getGitOpsStatus(),
    staleTime: 15_000,
  });
}

export function useGitOpsDrift() {
  return useQuery({
    queryKey: queryKeys.gitops.status(),
    queryFn: () => api.getGitOpsStatus(),
    select: (s) => s.drift,
    staleTime: 15_000,
  });
}

export function useGitOpsBindings(scopeNodeId?: string) {
  return useQuery({
    queryKey: queryKeys.gitops.bindings(scopeNodeId),
    queryFn: () => api.getGitOpsBindings(scopeNodeId),
    staleTime: 15_000,
  });
}

export function useCreateGitOpsBinding() {
  const invalidateGitOps = useInvalidateGitOpsQueries();
  return useMutation({
    mutationFn: (input: CreateGitOpsRepositoryBindingInput) =>
      api.createGitOpsBinding(input),
    onSuccess: invalidateGitOps,
  });
}

export function useUpdateGitOpsBinding() {
  const invalidateGitOps = useInvalidateGitOpsQueries();
  return useMutation({
    mutationFn: ({ scopeNodeId, bindingId, input }: UpdateBindingInput) =>
      api.updateGitOpsBinding(scopeNodeId, bindingId, input),
    onSuccess: invalidateGitOps,
  });
}

export function useDisableGitOpsBinding() {
  const invalidateGitOps = useInvalidateGitOpsQueries();
  return useMutation({
    mutationFn: ({ scopeNodeId, bindingId }: BindingActionInput) =>
      api.disableGitOpsBinding(scopeNodeId, bindingId),
    onSuccess: invalidateGitOps,
  });
}

export function usePlanGitOpsBinding() {
  return useMutation({
    mutationFn: ({ scopeNodeId, bindingId }: BindingActionInput) =>
      api.planGitOpsBinding(scopeNodeId, bindingId),
  });
}

export function useApplyGitOpsBinding() {
  const invalidateGitOps = useInvalidateGitOpsQueries();
  return useMutation({
    mutationFn: ({ scopeNodeId, bindingId }: BindingActionInput) =>
      api.applyGitOpsBinding(scopeNodeId, bindingId),
    onSuccess: invalidateGitOps,
  });
}

export function useOutboundSyncGitOpsBinding() {
  const invalidateGitOps = useInvalidateGitOpsQueries();
  return useMutation({
    mutationFn: ({ scopeNodeId, bindingId }: BindingActionInput) =>
      api.syncGitOpsBindingOutbound(scopeNodeId, bindingId),
    onSuccess: invalidateGitOps,
  });
}

export function useRunReconcile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dryRun: boolean) => api.runReconcile(dryRun),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gitops.status(),
      });
    },
  });
}
