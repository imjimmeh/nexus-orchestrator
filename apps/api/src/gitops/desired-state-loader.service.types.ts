export interface LoadDesiredStateInput {
  repoUrl: string;
  ref: string;
  workspacePath?: string;
  rootPath?: string;
  /**
   * Optional binding metadata. When present, the loader
   * resolves credentials via `GitOpsCredentialsResolver` and
   * routes them through `GitOpsInvocationBuilder` to the
   * underlying git fetch/clone invocations. When absent, the
   * loader falls back to the historical anonymous-fetch
   * path (used by the deprecated `ReconciliationService`
   * adapter which sources repo config from `GITOPS_REPO_URL`).
   */
  binding?: LoadDesiredStateBindingMeta;
}

export interface LoadDesiredStateBindingMeta {
  id: string;
  credentialsSecretId: string | null;
}
