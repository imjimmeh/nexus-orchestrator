import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { AgentProfile, UpdateAgentProfileRequest } from "@/lib/api/agents.types";
import { Workflow } from "@/lib/api/workflows.types";

export function useResolvedAgentProfile(name: string, scopeNodeId?: string) {
  return useQuery({
    queryKey: queryKeys.resolvedConfig.agentProfile(name, scopeNodeId),
    queryFn: () => api.resolveAgentProfile(name, scopeNodeId),
    enabled: !!name,
  });
}

export function useResolvedWorkflow(name: string, scopeNodeId?: string) {
  return useQuery({
    queryKey: queryKeys.resolvedConfig.workflow(name, scopeNodeId),
    queryFn: () => api.resolveWorkflow(name, scopeNodeId),
    enabled: !!name,
  });
}

export function useForkAgentForScope() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      baseProfileId,
      scopeNodeId,
      data,
    }: {
      baseProfileId: string;
      scopeNodeId: string;
      data: Partial<UpdateAgentProfileRequest>;
    }) => api.forkAgentForScope(baseProfileId, scopeNodeId, data),
    onSuccess: (_data, { scopeNodeId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.resolvedConfig.agentProfile("", scopeNodeId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminResources.agentProfiles.all(),
      });
    },
  });
}

export function useForkWorkflowForScope() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      baseWorkflowId,
      scopeNodeId,
      yamlDefinition,
    }: {
      baseWorkflowId: string;
      scopeNodeId: string;
      yamlDefinition: string;
    }) => api.forkWorkflowForScope(baseWorkflowId, scopeNodeId, yamlDefinition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all() });
    },
  });
}

// Future: skill resolve/fork hooks will be added here when skill scoped-config endpoints are available.
export type { AgentProfile, Workflow };
