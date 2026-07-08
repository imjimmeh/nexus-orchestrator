import type { ApiClient } from "./client";
import type { ApiClientSecretsMethods } from "./client.secrets.types";

export type { ApiClientSecretsMethods };

function paramsToRecord(
  params?: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!params) return result;
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }
  return result;
}

export const secretsApiMethods: ApiClientSecretsMethods = {
  async getSecrets(this: ApiClient, params) {
    const query = paramsToRecord(params as Record<string, unknown> | undefined);
    return this.get("/ai-config/secrets", {
      params: Object.keys(query).length > 0 ? query : undefined,
    });
  },

  async getSecret(this: ApiClient, id) {
    return this.get(`/ai-config/secrets/${id}`);
  },

  async createSecret(this: ApiClient, data) {
    return this.post("/ai-config/secrets", data);
  },

  async updateSecret(this: ApiClient, id, data) {
    return this.patch(`/ai-config/secrets/${id}`, data);
  },

  async deleteSecret(this: ApiClient, id) {
    return this.delete(`/ai-config/secrets/${id}`);
  },
};
