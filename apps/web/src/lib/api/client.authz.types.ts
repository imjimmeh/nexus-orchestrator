// apps/web/src/lib/api/client.authz.types.ts

export type EnforcementMode = "audit" | "warn" | "enforce";

export interface ResourceEnforcementMode {
  resource: string;
  mode: EnforcementMode;
}

export interface MyPermissionsResponse {
  permissions: string[];
  scopeNodeId: string;
}

export interface ApiClientAuthzMethods {
  getEnforcementModes(
    this: import("./client").ApiClient,
  ): Promise<ResourceEnforcementMode[]>;
  setEnforcementMode(
    this: import("./client").ApiClient,
    resource: string,
    mode: EnforcementMode,
  ): Promise<ResourceEnforcementMode>;
  getMyPermissions(
    this: import("./client").ApiClient,
    scopeNodeId?: string,
  ): Promise<MyPermissionsResponse>;
}
