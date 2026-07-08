import type { AcpAgentManifest } from '@nexus/core';

export enum AcpAuthType {
  NONE = 'none',
  BEARER = 'bearer',
  API_KEY = 'api_key',
}

export interface AcpHttpClientConfig {
  baseUrl: string;
  authType: AcpAuthType;
  authToken?: string | null;
  headers?: Record<string, string> | null;
  timeoutMs: number;
  connectTimeoutMs: number;
}

export interface ListAgentsResult {
  agents: AcpAgentManifest[];
  total?: number;
}
