export interface RepositoryWorkflowOverride {
  enabled: boolean;
}

/**
 * VCS-domain integration strategy. Re-declared kanban-contracts-locally (the
 * canonical API-side union lives in apps/api .../merge-provider.types.ts;
 * packages must not depend on apps). The literal sets are pinned by the resolver
 * spec so the two declarations cannot silently diverge.
 */
export type RepositoryIntegrationStrategy = "direct-push" | "pull-request";
export type RepositoryMergeMethod = "merge" | "squash" | "rebase";

export interface RepositoryIntegrationSettings {
  strategy: RepositoryIntegrationStrategy; // default 'direct-push'
  mergeMethod: RepositoryMergeMethod; // default 'merge'
  autoMerge: boolean; // default false
  preflightGate: boolean; // default true
}

export interface RepositoryWorkflowSettings {
  enabled: boolean;
  overrides: Record<string, RepositoryWorkflowOverride>;
  integration?: RepositoryIntegrationSettings; // absent ⇒ direct-push defaults
}
