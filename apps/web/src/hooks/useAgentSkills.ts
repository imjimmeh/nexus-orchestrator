import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { CreateAgentSkillRequest, UpdateAgentSkillRequest } from "@/lib/api/agents.types";

export function useAgentSkills(params?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: queryKeys.agentSkills.all(params?.includeInactive),
    queryFn: () => api.getAgentSkills(params),
  });
}

export function useCreateAgentSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAgentSkillRequest) => api.createAgentSkill(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
    },
  });
}

export function useUpdateAgentSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAgentSkillRequest }) =>
      api.updateAgentSkill(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
    },
  });
}

export function useDeleteAgentSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAgentSkill(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.agentSkills.profileSkillsRoot(),
      });
    },
  });
}

export function useAgentSkillFiles(skillId: string) {
  return useQuery({
    queryKey: queryKeys.agentSkills.files(skillId),
    queryFn: () => api.getAgentSkillFiles(skillId),
    enabled: skillId.length > 0,
  });
}

export function useUpsertAgentSkillFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillId,
      relativePath,
      content,
      contentBase64,
    }: {
      skillId: string;
      relativePath: string;
      content?: string;
      contentBase64?: string;
    }) =>
      api.upsertAgentSkillFile(skillId, {
        relative_path: relativePath,
        content,
        content_base64: contentBase64,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.agentSkills.files(variables.skillId),
      });
    },
  });
}

export function useDeleteAgentSkillFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillId,
      relativePath,
    }: {
      skillId: string;
      relativePath: string;
    }) => api.deleteAgentSkillFile(skillId, relativePath),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.agentSkills.files(variables.skillId),
      });
    },
  });
}

export function useAgentProfileSkills(profileId: string) {
  return useQuery({
    queryKey: queryKeys.agentSkills.profileSkills(profileId),
    queryFn: () => api.getAgentProfileSkills(profileId),
    enabled: profileId.length > 0,
  });
}

export function useReplaceAgentProfileSkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      profileId,
      skillIds,
    }: {
      profileId: string;
      skillIds: string[];
    }) => api.replaceAgentProfileSkills(profileId, skillIds),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.agentSkills.profileSkills(variables.profileId),
      });
    },
  });
}
