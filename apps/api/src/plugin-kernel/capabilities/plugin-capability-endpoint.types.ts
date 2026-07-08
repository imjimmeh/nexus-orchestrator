import type {
  JsonSchemaObject,
  PluginCapabilityEndpointVisibility,
} from '@nexus/plugin-sdk';

export interface PluginCapabilityEndpoint {
  pluginId: string;
  version: string;
  contributionId: string;
  globalEndpointName: string;
  displayName: string;
  description?: string;
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  requiredPermissions: string[];
  operation: string;
  timeoutMs?: number;
  retryable: boolean;
  visibility: PluginCapabilityEndpointVisibility[];
}

export interface ListPluginCapabilityEndpointsOptions {
  visibility?: PluginCapabilityEndpointVisibility;
  pluginId?: string;
}
