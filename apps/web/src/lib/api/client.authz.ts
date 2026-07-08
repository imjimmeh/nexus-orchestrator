// apps/web/src/lib/api/client.authz.ts
import type { ApiClient } from "./client";
import type {
  ApiClientAuthzMethods,
  EnforcementMode,
  MyPermissionsResponse,
  ResourceEnforcementMode,
} from "./client.authz.types";

export type { ApiClientAuthzMethods };

export const authzApiMethods: ApiClientAuthzMethods = {
  async getEnforcementModes(
    this: ApiClient,
  ): Promise<ResourceEnforcementMode[]> {
    return this.get<ResourceEnforcementMode[]>("/authz/enforcement-mode");
  },

  async setEnforcementMode(
    this: ApiClient,
    resource: string,
    mode: EnforcementMode,
  ): Promise<ResourceEnforcementMode> {
    return this.put<ResourceEnforcementMode>(
      `/authz/enforcement-mode/${resource}`,
      { mode },
    );
  },

  async getMyPermissions(
    this: ApiClient,
    scopeNodeId?: string,
  ): Promise<MyPermissionsResponse> {
    const query = scopeNodeId
      ? `?scopeNodeId=${encodeURIComponent(scopeNodeId)}`
      : "";
    return this.get<MyPermissionsResponse>(`/me/permissions${query}`);
  },
};
