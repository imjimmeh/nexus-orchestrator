import { api } from "@/lib/api/client";
import { createCrudHooks } from "./lib/createCrudHooks";
import { queryKeys } from "@/lib/queryKeys";
import { CreateSecretRequest, ListSecretsParams, Secret, UpdateSecretRequest } from "@/lib/api/secrets.types";

const { useList, useOne, useCreate, useUpdate, useRemove } = createCrudHooks<
  Secret,
  CreateSecretRequest,
  UpdateSecretRequest,
  ListSecretsParams
>(queryKeys.adminResources.secrets, {
  getAll: (params) => api.getSecrets(params),
  getOne: (id) => api.getSecret(id),
  create: (data) => api.createSecret(data),
  update: (id, data) => api.updateSecret(id, data),
  remove: (id) => api.deleteSecret(id),
});

export const useSecrets = useList;
export const useSecret = useOne;
export const useCreateSecret = useCreate;
export const useUpdateSecret = useUpdate;
export const useDeleteSecret = useRemove;
