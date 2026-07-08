import { api } from "@/lib/api/client";
import { createCrudHooks } from "./lib/createCrudHooks";
import { queryKeys } from "@/lib/queryKeys";
import { AgentProfile, CreateAgentProfileRequest, UpdateAgentProfileRequest } from "@/lib/api/agents.types";
import { ListAgentProfilesParams } from "@/lib/api/agents.types";

const { useList, useOne, useCreate, useUpdate, useRemove } = createCrudHooks<
  AgentProfile,
  CreateAgentProfileRequest,
  UpdateAgentProfileRequest,
  ListAgentProfilesParams
>(queryKeys.adminResources.agentProfiles, {
  getAll: (params) => api.getAgentProfiles(params),
  getOne: (id) => api.getAgentProfile(id),
  create: (data) => api.createAgentProfile(data),
  update: (id, data) => api.updateAgentProfile(id, data),
  remove: (id) => api.deleteAgentProfile(id),
});

export const useAgentProfiles = useList;
export const useAgentProfile = useOne;
export const useCreateAgentProfile = useCreate;
export const useUpdateAgentProfile = useUpdate;
export const useDeleteAgentProfile = useRemove;
