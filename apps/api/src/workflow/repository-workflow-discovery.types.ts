export interface RepositoryWorkflowDiscoveryRequest {
  scopeId: string;
  rootPath: string;
  sourceRef?: string;
}

export interface RepositoryWorkflowDiscoveryResult {
  discovered: number;
  upserted: number;
  disabled: number;
}
