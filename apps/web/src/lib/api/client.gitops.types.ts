export type ManagedBy = "gitops" | "manual" | "seed";

export type GitOpsBindingSyncMode = "git_to_app" | "two_way";

export type GitOpsSyncableObjectType =
  | "scope_node"
  | "role"
  | "role_assignment"
  | "workflow"
  | "agent_profile"
  | "skill";

export interface GitOpsRepositoryBinding {
  id: string;
  scopeNodeId: string;
  name: string;
  repoUrl: string;
  defaultRef: string;
  rootPath: string;
  syncMode: GitOpsBindingSyncMode;
  credentialsSecretId: string | null;
  enabled: boolean;
  includedObjectTypes: GitOpsSyncableObjectType[];
  conflictPolicy: string;
  lastAppliedRevision: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGitOpsRepositoryBindingInput {
  scopeNodeId: string;
  name: string;
  repoUrl: string;
  defaultRef?: string;
  rootPath?: string;
  syncMode: GitOpsBindingSyncMode;
  credentialsSecretId?: string | null;
  includedObjectTypes: GitOpsSyncableObjectType[];
}

export interface UpdateGitOpsRepositoryBindingInput {
  name?: string;
  repoUrl?: string;
  defaultRef?: string;
  rootPath?: string;
  syncMode?: GitOpsBindingSyncMode;
  credentialsSecretId?: string | null;
  includedObjectTypes?: GitOpsSyncableObjectType[];
  enabled?: boolean;
}

export interface ReconcileSummary {
  id: string;
  finishedAt: string;
  result: "success" | "failure";
  summary: { create: number; update: number; prune: number; drift: number };
  dryRun: boolean;
  auditEventId: string;
}

export interface GitOpsRunSummary {
  id: string;
  bindingId: string;
  direction: string;
  status: string;
  revision: string;
  summary: string | null;
  finishedAt: string | null;
}

export interface GitOpsBindingStatus {
  bindingId: string;
  name: string;
  scopeNodeId: string;
  syncMode: "git_to_app" | "two_way";
  enabled: boolean;
  lastAppliedRevision: string | null;
  latestRun: GitOpsRunSummary | null;
  pendingChangeCount: number;
  driftCount: number;
}

export interface DriftSummary {
  kind: string;
  name: string;
  scopeNodeId: string;
  managedBy: ManagedBy;
  driftedFields: string[];
  auditEventId: string;
  category?: "git_only" | "db_only" | "field_divergence" | "conflict";
}

export interface GitOpsStatusResponse {
  bindings: GitOpsBindingStatus[];
  lastReconcile: ReconcileSummary | null;
  drift: DriftSummary[];
  managedByCounts: Record<ManagedBy, number>;
}

export interface RunReconcileRequest {
  dryRun: boolean;
  repoPath?: string;
}

export interface ApiClientGitOpsMethods {
  getGitOpsBindings(
    this: import("./client").ApiClient,
    scopeNodeId?: string,
  ): Promise<GitOpsRepositoryBinding[]>;
  createGitOpsBinding(
    this: import("./client").ApiClient,
    input: CreateGitOpsRepositoryBindingInput,
  ): Promise<GitOpsRepositoryBinding>;
  updateGitOpsBinding(
    this: import("./client").ApiClient,
    scopeNodeId: string,
    bindingId: string,
    input: UpdateGitOpsRepositoryBindingInput,
  ): Promise<GitOpsRepositoryBinding>;
  disableGitOpsBinding(
    this: import("./client").ApiClient,
    scopeNodeId: string,
    bindingId: string,
  ): Promise<GitOpsRepositoryBinding>;
  getGitOpsStatus(
    this: import("./client").ApiClient,
  ): Promise<GitOpsStatusResponse>;
  planGitOpsBinding(
    this: import("./client").ApiClient,
    scopeNodeId: string,
    bindingId: string,
  ): Promise<unknown>;
  applyGitOpsBinding(
    this: import("./client").ApiClient,
    scopeNodeId: string,
    bindingId: string,
  ): Promise<unknown>;
  syncGitOpsBindingOutbound(
    this: import("./client").ApiClient,
    scopeNodeId: string,
    bindingId: string,
  ): Promise<unknown>;
  runReconcile(
    this: import("./client").ApiClient,
    dryRun: boolean,
  ): Promise<unknown>;
}
